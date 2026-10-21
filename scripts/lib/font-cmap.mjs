import { brotliDecompressSync } from "node:zlib";

/**
 * Minimal, dependency-free font cmap readers.
 *
 * The slice pipeline has to know which code points each generated WOFF2 slice
 * really contains (cn-font-split's own `unicode-range` output can be narrower
 * than the slice's cmap), so we parse the tables ourselves:
 *   - `readTtfCmap`   – source TTF/OTF cmap
 *   - `readWoff2Cmap` – WOFF2 slice cmap (Brotli-compressed table stream)
 *
 * Only the cmap table is decoded, which keeps this fast enough to run over a
 * few hundred slices.
 */

// WOFF2 known table tags, see the WOFF2 spec (table "Known Table Tags").
const WOFF2_KNOWN_TAGS = [
	"cmap",
	"head",
	"hhea",
	"hmtx",
	"maxp",
	"name",
	"OS/2",
	"post",
	"cvt ",
	"fpgm",
	"glyf",
	"loca",
	"prep",
	"CFF ",
	"VORG",
	"EBDT",
	"EBLC",
	"gasp",
	"hdmx",
	"kern",
	"LTSH",
	"PCLT",
	"VDMX",
	"vhea",
	"vmtx",
	"BASE",
	"GDEF",
	"GPOS",
	"GSUB",
	"EBSC",
	"JSTF",
	"MATH",
	"CBDT",
	"CBLC",
	"COLR",
	"CPAL",
	"SVG ",
	"sbix",
	"acnt",
	"avar",
	"bdat",
	"bloc",
	"bsln",
	"cvar",
	"fdsc",
	"feat",
	"fmtx",
	"fvar",
	"gvar",
	"hsty",
	"just",
	"lcar",
	"mort",
	"morx",
	"opbd",
	"prop",
	"trak",
	"Zapf",
	"Silf",
	"Glat",
	"Gloc",
	"Feat",
	"Sill",
];

function asBuffer(value) {
	return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function readUIntBase128(buf, offset) {
	let value = 0;
	for (let index = 0; index < 5; index += 1) {
		const byte = buf[offset + index];
		if (byte === undefined) {
			throw new Error("unexpected end of WOFF2 table directory");
		}
		if (index === 0 && byte === 0x80) {
			throw new Error("invalid UIntBase128 value (leading zero)");
		}
		if (value & 0xfe000000) {
			throw new Error("UIntBase128 overflow");
		}
		value = (value << 7) | (byte & 0x7f);
		if ((byte & 0x80) === 0) {
			return { value: value >>> 0, offset: offset + index + 1 };
		}
	}
	throw new Error("invalid UIntBase128 value (more than 5 bytes)");
}

function readFormat0(buf, offset, codepoints) {
	const glyphIdArray = offset + 6;
	for (let code = 0; code < 256; code += 1) {
		if (glyphIdArray + code >= buf.length) return;
		if (buf[glyphIdArray + code] !== 0) codepoints.add(code);
	}
}

function readFormat4(buf, offset, codepoints) {
	const segCountX2 = buf.readUInt16BE(offset + 6);
	const segCount = segCountX2 / 2;
	const endCodes = offset + 14;
	const startCodes = endCodes + segCountX2 + 2;
	const idDeltas = startCodes + segCountX2;
	const idRangeOffsets = idDeltas + segCountX2;

	for (let segment = 0; segment < segCount; segment += 1) {
		const endCode = buf.readUInt16BE(endCodes + segment * 2);
		const startCode = buf.readUInt16BE(startCodes + segment * 2);
		const idDelta = buf.readInt16BE(idDeltas + segment * 2);
		const idRangeOffset = buf.readUInt16BE(idRangeOffsets + segment * 2);

		for (let code = startCode; code <= endCode; code += 1) {
			if (code === 0xffff) break;
			let glyphId;
			if (idRangeOffset === 0) {
				glyphId = (code + idDelta) & 0xffff;
			} else {
				const glyphOffset =
					idRangeOffsets +
					segment * 2 +
					idRangeOffset +
					(code - startCode) * 2;
				if (glyphOffset + 2 > buf.length) continue;
				glyphId = buf.readUInt16BE(glyphOffset);
				if (glyphId !== 0) glyphId = (glyphId + idDelta) & 0xffff;
			}
			if (glyphId !== 0) codepoints.add(code);
		}
	}
}

function readFormat6(buf, offset, codepoints) {
	const firstCode = buf.readUInt16BE(offset + 6);
	const entryCount = buf.readUInt16BE(offset + 8);
	const glyphIdArray = offset + 10;
	for (let index = 0; index < entryCount; index += 1) {
		if (glyphIdArray + index * 2 + 2 > buf.length) return;
		if (buf.readUInt16BE(glyphIdArray + index * 2) !== 0) {
			codepoints.add(firstCode + index);
		}
	}
}

function readFormat12(buf, offset, codepoints) {
	const groupCount = buf.readUInt32BE(offset + 12);
	for (let group = 0; group < groupCount; group += 1) {
		const groupOffset = offset + 16 + group * 12;
		if (groupOffset + 12 > buf.length) return;
		const startCharCode = buf.readUInt32BE(groupOffset);
		const endCharCode = buf.readUInt32BE(groupOffset + 4);
		for (let code = startCharCode; code <= endCharCode; code += 1) {
			codepoints.add(code);
		}
	}
}

export function parseCmapTable(buf, tableOffset) {
	const codepoints = new Set();
	const numTables = buf.readUInt16BE(tableOffset + 2);

	for (let index = 0; index < numTables; index += 1) {
		const record = tableOffset + 4 + index * 8;
		if (record + 8 > buf.length) break;
		const platformId = buf.readUInt16BE(record);
		const encodingId = buf.readUInt16BE(record + 2);
		const isUnicode =
			platformId === 0 ||
			(platformId === 3 && (encodingId === 1 || encodingId === 10));
		if (!isUnicode) continue;

		const subtableOffset = tableOffset + buf.readUInt32BE(record + 4);
		if (subtableOffset + 2 > buf.length) continue;
		const format = buf.readUInt16BE(subtableOffset);

		if (format === 0) readFormat0(buf, subtableOffset, codepoints);
		else if (format === 4) readFormat4(buf, subtableOffset, codepoints);
		else if (format === 6) readFormat6(buf, subtableOffset, codepoints);
		else if (format === 12) readFormat12(buf, subtableOffset, codepoints);
	}

	if (codepoints.size === 0) {
		throw new Error("cmap table has no supported unicode subtable");
	}

	return codepoints;
}

export function readTtfCmap(source) {
	const buf = asBuffer(source);
	if (buf.length < 12) throw new Error("font file is too small to be an sfnt");
	const signature = buf.toString("latin1", 0, 4);
	if (
		signature !== "\u0000\u0001\u0000\u0000" &&
		signature !== "true" &&
		signature !== "OTTO"
	) {
		throw new Error(`unsupported sfnt signature ${JSON.stringify(signature)}`);
	}

	const numTables = buf.readUInt16BE(4);
	let cmapOffset;
	for (let index = 0; index < numTables; index += 1) {
		const record = 12 + index * 16;
		if (record + 16 > buf.length) break;
		if (buf.toString("latin1", record, record + 4) === "cmap") {
			cmapOffset = buf.readUInt32BE(record + 8);
			break;
		}
	}
	if (cmapOffset === undefined) throw new Error("font has no cmap table");

	return parseCmapTable(buf, cmapOffset);
}

export function readWoff2Cmap(source) {
	const buf = asBuffer(source);
	if (buf.length < 48) throw new Error("woff2 file is too small");
	if (buf.toString("latin1", 0, 4) !== "wOF2") {
		throw new Error("missing WOFF2 signature");
	}

	const numTables = buf.readUInt16BE(12);
	const totalCompressedSize = buf.readUInt32BE(20);
	let offset = 48;
	const entries = [];

	for (let index = 0; index < numTables; index += 1) {
		const flags = buf[offset];
		if (flags === undefined) throw new Error("truncated WOFF2 table directory");
		offset += 1;

		const tagIndex = flags & 0x3f;
		let tag;
		if (tagIndex === 0x3f) {
			tag = buf.toString("latin1", offset, offset + 4);
			offset += 4;
		} else {
			tag = WOFF2_KNOWN_TAGS[tagIndex];
		}
		if (!tag) throw new Error(`unknown WOFF2 table tag index ${tagIndex}`);

		const originalLength = readUIntBase128(buf, offset);
		offset = originalLength.offset;

		const transformVersion = (flags >> 6) & 0x03;
		const isGlyfOrLoca = tag === "glyf" || tag === "loca";
		// glyf/loca use transform version 3 for "no transform"; every other
		// table uses transform version 0 for "no transform".
		const transformed = isGlyfOrLoca
			? transformVersion !== 3
			: transformVersion !== 0;

		let storedLength = originalLength.value;
		if (transformed) {
			const transformedLength = readUIntBase128(buf, offset);
			offset = transformedLength.offset;
			storedLength = transformedLength.value;
		}

		entries.push({ tag, storedLength });
	}

	const compressed = buf.subarray(offset, offset + totalCompressedSize);
	if (compressed.length !== totalCompressedSize) {
		throw new Error("truncated WOFF2 compressed data");
	}
	const tables = brotliDecompressSync(compressed);

	let cursor = 0;
	for (const entry of entries) {
		if (entry.tag === "cmap") {
			if (cursor + entry.storedLength > tables.length) {
				throw new Error("WOFF2 cmap table exceeds decompressed stream");
			}
			return parseCmapTable(
				tables.subarray(cursor, cursor + entry.storedLength),
				0,
			);
		}
		cursor += entry.storedLength;
	}

	throw new Error("WOFF2 font has no cmap table");
}

/** Collapse a set of code points into sorted, merged [start, end] ranges. */
export function codepointsToRanges(codepoints) {
	const sorted = [...codepoints].sort((left, right) => left - right);
	const ranges = [];
	for (const code of sorted) {
		const last = ranges[ranges.length - 1];
		if (last && code === last[1] + 1) {
			last[1] = code;
		} else {
			ranges.push([code, code]);
		}
	}
	return ranges;
}

/** Serialise ranges into a CSS `unicode-range` value. */
export function formatUnicodeRange(ranges) {
	return ranges
		.map(([start, end]) =>
			start === end
				? `U+${start.toString(16).toUpperCase()}`
				: `U+${start.toString(16).toUpperCase()}-${end.toString(16).toUpperCase()}`,
		)
		.join(",");
}

/** Parse a CSS `unicode-range` value into [start, end] ranges. */
export function parseUnicodeRange(value) {
	return value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const [start, end] = part.replace(/^U\+/i, "").split("-");
			const startCode = Number.parseInt(start, 16);
			const endCode = end === undefined ? startCode : Number.parseInt(end, 16);
			return [startCode, endCode];
		});
}

export function rangesContainCode(ranges, code) {
	return ranges.some(([start, end]) => code >= start && code <= end);
}

export function rangeListsIntersect(left, right) {
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < left.length && rightIndex < right.length) {
		const [leftStart, leftEnd] = left[leftIndex];
		const [rightStart, rightEnd] = right[rightIndex];
		if (leftEnd < rightStart) leftIndex += 1;
		else if (rightEnd < leftStart) rightIndex += 1;
		else return true;
	}
	return false;
}
