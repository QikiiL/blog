import { existsSync } from "node:fs";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codepointsToRanges, rangeListsIntersect } from "./lib/font-cmap.mjs";

/**
 * Inject `<link rel="preload" as="font">` tags for the font slices a page
 * actually needs.
 *
 * Runs after `astro build` and before `scripts/prefix-public-images.mjs`, so the
 * injected URLs are rewritten to the CDN host like every other font reference.
 * The page's own text is the only signal we use: every slice whose unicode-range
 * intersects the page text is a candidate, and we greedily take the slices that
 * cover the most characters until the per-page budget is exhausted.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(projectRoot, "dist");
const manifestPath = join(distDir, "fonts", "slices", "manifest.json");

// Hard ceiling for the preloaded font bytes of a single page.
const PER_PAGE_BUDGET = 1024 * 1024;
const FONT_LINK_PATTERN =
	/<link\b[^>]*\brel=["']preload["'][^>]*\bas=["']font["'][^>]*>/gi;
const SLICE_URL_PATTERN = /\/fonts\/slices\//;

async function collectHtmlFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectHtmlFiles(path)));
		} else if (entry.name.endsWith(".html")) {
			files.push(path);
		}
	}
	return files;
}

const NAMED_ENTITIES = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

function decodeEntities(text) {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
		if (entity[0] === "#") {
			const isHex = entity[1] === "x" || entity[1] === "X";
			const code = Number.parseInt(
				isHex ? entity.slice(2) : entity.slice(1),
				isHex ? 16 : 10,
			);
			if (Number.isFinite(code) && code > 0) return String.fromCodePoint(code);
			return match;
		}
		return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
	});
}

/** Text a reader can actually see on the page (no scripts, styles or tags). */
function extractVisibleText(html) {
	const withoutHeadContent = html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[\s\S]*?<\/style>/gi, " ");
	return decodeEntities(withoutHeadContent.replace(/<[^>]*>/g, " "));
}

function collectCodepoints(text) {
	const codepoints = new Set();
	for (const char of text) {
		const code = char.codePointAt(0);
		if (code !== undefined && code > 0x1f) codepoints.add(code);
	}
	return codepoints;
}

function countCovered(ranges, pageRanges) {
	let covered = 0;
	let pageIndex = 0;
	for (const [start, end] of ranges) {
		while (pageIndex < pageRanges.length && pageRanges[pageIndex][1] < start) {
			pageIndex += 1;
		}
		for (
			let index = pageIndex;
			index < pageRanges.length && pageRanges[index][0] <= end;
			index += 1
		) {
			const pageStart = Math.max(start, pageRanges[index][0]);
			const pageEnd = Math.min(end, pageRanges[index][1]);
			if (pageEnd >= pageStart) covered += pageEnd - pageStart + 1;
		}
	}
	return covered;
}

function selectSlices(manifest, pageRanges, budget) {
	const candidates = [];
	for (const font of manifest.fonts) {
		for (const slice of font.slices) {
			if (!rangeListsIntersect(slice.ranges, pageRanges)) continue;
			const covered = countCovered(slice.ranges, pageRanges);
			if (covered === 0) continue;
			candidates.push({ font, slice, covered });
		}
	}

	candidates.sort(
		(left, right) =>
			right.covered - left.covered ||
			right.slice.bytes - left.slice.bytes ||
			left.slice.file.localeCompare(right.slice.file),
	);

	const selected = [];
	let totalBytes = 0;
	for (const candidate of candidates) {
		if (totalBytes + candidate.slice.bytes > budget) continue;
		selected.push(candidate);
		totalBytes += candidate.slice.bytes;
	}
	return { selected, totalBytes };
}

function buildLinks(selected) {
	return selected
		.map(
			({ font, slice }) =>
				`<link rel="preload" href="${font.urlPrefix}/${slice.file}" ` +
				`as="font" type="font/woff2" crossorigin>`,
		)
		.join("");
}

if (!existsSync(manifestPath)) {
	throw new Error(
		`Font slice manifest not found at ${manifestPath}. ` +
			"Run `node scripts/prepare-font-slices.mjs` before building.",
	);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sliceCount = manifest.fonts.reduce(
	(sum, font) => sum + font.slices.length,
	0,
);
if (sliceCount === 0) {
	console.log("Font preload injection skipped: manifest has no slices.");
	await rm(manifestPath, { force: true });
	process.exit(0);
}

const sliceFiles = new Set();
for (const font of manifest.fonts) {
	for (const slice of font.slices) {
		const path = join(
			distDir,
			...`${font.urlPrefix}/${slice.file}`.split("/").filter(Boolean),
		);
		if (!existsSync(path)) {
			throw new Error(`Manifest slice is missing from dist: ${path}`);
		}
		sliceFiles.add(`${font.urlPrefix}/${slice.file}`);
	}
}

const htmlFiles = await collectHtmlFiles(distDir);
let injectedPages = 0;
let injectedLinks = 0;
let maxPageBytes = 0;
let maxPagePath = "";
let indexBytes = 0;
let indexLinks = 0;

for (const path of htmlFiles) {
	const html = await readFile(path, "utf8");

	const existing = [...html.matchAll(FONT_LINK_PATTERN)].filter((match) =>
		SLICE_URL_PATTERN.test(match[0]),
	);
	if (existing.length > 0) continue;

	const pageCodepoints = collectCodepoints(extractVisibleText(html));
	if (pageCodepoints.size === 0) continue;

	const { selected, totalBytes } = selectSlices(
		manifest,
		codepointsToRanges(pageCodepoints),
		PER_PAGE_BUDGET,
	);
	if (selected.length === 0) continue;

	const links = buildLinks(selected);
	const headIndex = html.search(/<\/head>/i);
	if (headIndex < 0) continue;

	const updated =
		html.slice(0, headIndex) + links + html.slice(headIndex);
	await writeFile(path, updated);

	injectedPages += 1;
	injectedLinks += selected.length;
	if (totalBytes > maxPageBytes) {
		maxPageBytes = totalBytes;
		maxPagePath = path;
	}
	if (path === join(distDir, "index.html")) {
		indexBytes = totalBytes;
		indexLinks = selected.length;
	}
}

// The manifest is build-time metadata only; do not ship ~1 MB of JSON.
await rm(manifestPath, { force: true });

console.log(
	`Font preloads injected: ${injectedLinks} link(s) on ${injectedPages} page(s); ` +
		`index.html ${indexLinks} link(s) / ${(indexBytes / 1024).toFixed(0)} KB; ` +
		`max page ${(maxPageBytes / 1024).toFixed(0)} KB${
			maxPagePath ? ` (${maxPagePath.slice(distDir.length + 1)})` : ""
		}.`,
);

const sliceBytes = await Promise.all(
	[...sliceFiles].map(async (url) => {
		const path = join(distDir, ...url.split("/").filter(Boolean));
		return (await stat(path)).size;
	}),
);
console.log(
	`Font slices on disk: ${sliceFiles.size} files, ` +
		`${(sliceBytes.reduce((sum, bytes) => sum + bytes, 0) / 1024 / 1024).toFixed(2)} MB.`,
);
