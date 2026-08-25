import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Font, ttftowoff2, woff2 } from "fonteditor-core";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fonts = [
	["ZenMaruGothic-Medium.ttf", "ZenMaruGothic-Medium.woff2"],
	["loli.ttf", "loli.woff2"],
];

// 扫描这些目录里的文本，提取实际用到的字符；同时固定包含 ASCII、常用标点与假名。
const SCAN_DIRS = ["src", "content", "public"];
const SCAN_EXTS = new Set([
	".astro", ".svelte", ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs",
	".jsx", ".tsx", ".css", ".styl", ".html", ".htm", ".json", ".yml",
	".yaml", ".txt", ".xml", ".svg",
]);
const IGNORE_DIRS = new Set([
	".git", "node_modules", "dist", ".astro", ".vite", ".dsh", ".devin",
	".pnpm-store", ".github", ".next", ".nuxt", "coverage",
]);

function codepointsInRange(start, end) {
	const points = [];
	for (let cp = start; cp <= end; cp++) points.push(cp);
	return points;
}

// 始终保留的基础字符集：ASCII 可打印字符、CJK 标点与常用符号。
// 日文假名、全角字符等由扫描到的实际内容决定，不再无条件全部保留。
const alwaysInclude = new Set([
	...codepointsInRange(0x20, 0x7e),
	...codepointsInRange(0x3000, 0x303f),
	0x00b7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026,
	0x2022, 0x203b,
]);

async function collectUsedChars() {
	const chars = new Set(alwaysInclude);

	async function walk(dir) {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!IGNORE_DIRS.has(entry.name)) await walk(fullPath);
				continue;
			}
			if (!SCAN_EXTS.has(extname(entry.name).toLowerCase())) continue;

			try {
				const text = await readFile(fullPath, "utf8");
				for (const ch of text) {
					const cp = ch.codePointAt(0);
					if (cp !== undefined) chars.add(cp);
				}
			} catch {
				// 忽略无法按 UTF-8 读取的文本文件
			}
		}
	}

	for (const dir of SCAN_DIRS) {
		const fullPath = resolve(projectRoot, dir);
		try {
			await walk(fullPath);
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}

	return [...chars].sort((a, b) => a - b);
}

function exactArrayBuffer(buffer) {
	return buffer.buffer.slice(
		buffer.byteOffset,
		buffer.byteOffset + buffer.byteLength,
	);
}

function glyphDigest(font) {
	const hash = createHash("sha256");
	for (const glyph of font.glyf) hash.update(JSON.stringify(glyph));
	return hash.digest("hex");
}

function assertEquivalentFont(source, output, targetName) {
	const readOptions = { hinting: true, kerning: true };
	const original = Font.create(source, { ...readOptions, type: "ttf" }).get();
	const compressed = Font.create(output, {
		...readOptions,
		type: "woff2",
	}).get();

	if (
		original.glyf.length !== compressed.glyf.length ||
		original.head.unitsPerEm !== compressed.head.unitsPerEm ||
		JSON.stringify(original.name) !== JSON.stringify(compressed.name) ||
		glyphDigest(original) !== glyphDigest(compressed)
	) {
		throw new Error(`${targetName} changed font names, metrics, or glyph data`);
	}
}

await woff2.init();
const subset = await collectUsedChars();
console.log(`Subsetting fonts with ${subset.length} unique code points`);

for (const [sourceName, targetName] of fonts) {
	const sourcePath = resolve(projectRoot, "src", "assets", "fonts", sourceName);
	const targetPath = resolve(projectRoot, "src", "assets", "fonts", targetName);
	const source = await readFile(sourcePath);

	const subsetFont = Font.create(exactArrayBuffer(source), {
		type: "ttf",
		subset,
		hinting: true,
		kerning: true,
	});
	const subsetTtf = Buffer.from(
		subsetFont.write({ type: "ttf", hinting: false, kerning: false }),
	);
	const output = Buffer.from(ttftowoff2(exactArrayBuffer(subsetTtf)));

	if (output.subarray(0, 4).toString("ascii") !== "wOF2") {
		throw new Error(`${targetName} does not have a valid WOFF2 signature`);
	}
	if (output.length >= source.length) {
		throw new Error(`${targetName} is not smaller than its TTF source`);
	}

	assertEquivalentFont(subsetTtf, output, targetName);

	await writeFile(targetPath, output);
	console.log(
		`${sourceName} -> ${targetName}: ${source.length} -> ${output.length} bytes`,
	);
}
