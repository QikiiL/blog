import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard the custom font budget of the built site.
 *
 * The two display fonts are shipped as unicode-range slices, so the numbers
 * that matter are:
 *   - how many font bytes a single page preloads (first paint cost)
 *   - how many bytes all slices take on disk (CDN / repo cost)
 * Everything the HTML or CSS references must also exist in `dist`.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(projectRoot, "dist");
const slicesDir = join(distDir, "fonts", "slices");

// Per page: the preload injector targets ~0.85 MB for the home page.
const MAX_PAGE_PRELOAD_BYTES = 1.5 * 1024 * 1024;
// All slices together (both fonts, full coverage, no missing glyphs).
const MAX_TOTAL_SLICE_BYTES = 12 * 1024 * 1024;

const FONT_REFERENCE_PATTERN =
	/[^\s"'()<>]+?\.(?:woff2?|ttf|otf)(?:[?#][^\s"'()<>]*)?/gi;
const CUSTOM_FONT_VARIABLE_PATTERN = /--font-(?:body|cjk)\s*:/;
const STYLE_BLOCK_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const PRELOAD_FONT_LINK_PATTERN =
	/<link\b[^>]*\brel=["']preload["'][^>]*\bas=["']font["'][^>]*>/gi;
const HREF_PATTERN = /\bhref\s*=\s*["']([^"']+)["']/i;
// cdn.jsdmirror.com serves the pages branch as
// /gh/<owner>/<repo>@<branch>/<path>; strip that prefix to get the dist path.
const CDN_PATH_PREFIX = /^\/gh\/[^/]+\/[^/]+@[^/]+/;

async function collectFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(path)));
		} else {
			files.push(path);
		}
	}

	return files;
}

function resolveDistPath(reference) {
	let pathname = reference.trim();
	if (!pathname) return undefined;

	if (/^(?:https?:)?\/\//i.test(pathname)) {
		try {
			pathname = new URL(pathname, "https://assets.invalid").pathname;
		} catch {
			return undefined;
		}
		pathname = pathname.replace(CDN_PATH_PREFIX, "");
	} else {
		pathname = pathname.split(/[?#]/, 1)[0];
	}

	try {
		pathname = decodeURIComponent(pathname).replace(/\\/g, "/");
	} catch {
		return undefined;
	}

	if (!pathname.startsWith("/")) return undefined;
	return join(distDir, ...pathname.split("/").filter(Boolean));
}

function getCustomFontBlocks(path, content) {
	if (extname(path) === ".css") {
		return CUSTOM_FONT_VARIABLE_PATTERN.test(content) ? [content] : [];
	}

	return [...content.matchAll(STYLE_BLOCK_PATTERN)]
		.map((match) => match[1])
		.filter((block) => CUSTOM_FONT_VARIABLE_PATTERN.test(block));
}

if (!existsSync(distDir)) {
	throw new Error(
		`dist directory not found at ${distDir}; run the build first.`,
	);
}

const outputFiles = await collectFiles(distDir);
const searchableFiles = outputFiles.filter((path) =>
	[".html", ".css"].includes(extname(path)),
);

const referencedFontFiles = new Map();
const preloadReferences = [];
const pagesWithPreloads = [];
let customFontBlocks = 0;
let unicodeRangeRules = 0;

for (const path of searchableFiles) {
	const content = await readFile(path, "utf8");

	for (const block of getCustomFontBlocks(path, content)) {
		customFontBlocks += 1;
		for (const match of block.matchAll(FONT_REFERENCE_PATTERN)) {
			const assetPath = resolveDistPath(match[0]);
			if (assetPath) referencedFontFiles.set(assetPath, match[0]);
		}
	}

	if (extname(path) === ".css") {
		unicodeRangeRules += (
			content.match(/@font-face\s*\{[^}]*unicode-range\s*:/g) ?? []
		).length;
	}

	if (extname(path) !== ".html") continue;

	const pagePreloads = [];
	for (const match of content.matchAll(PRELOAD_FONT_LINK_PATTERN)) {
		const href = match[0].match(HREF_PATTERN)?.[1];
		if (!href) continue;
		const assetPath = resolveDistPath(href);
		if (!assetPath) continue;
		pagePreloads.push({ url: href, assetPath });
		preloadReferences.push({ path, url: href, assetPath });
	}
	if (pagePreloads.length > 0) {
		pagesWithPreloads.push({ path, preloads: pagePreloads });
	}
}

const ttfReferences = [...referencedFontFiles.values()].filter((url) =>
	/\.ttf(?:$|[?#])/i.test(url),
);
if (ttfReferences.length > 0) {
	throw new Error(
		`Custom TTF references are not allowed:\n${ttfReferences
			.map((url) => `- ${url}`)
			.join("\n")}`,
	);
}

let referencedFontBytes = 0;
for (const [path, url] of referencedFontFiles) {
	try {
		const file = await stat(path);
		if (!file.isFile()) {
			throw new Error(`Referenced custom font is not a file: ${url}`);
		}
		referencedFontBytes += file.size;
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new Error(`Referenced custom font asset was not emitted: ${url}`);
		}
		throw error;
	}
}

// Every preload must point at a file that really exists in dist.
const preloadedFiles = new Map();
for (const reference of preloadReferences) {
	if (preloadedFiles.has(reference.assetPath)) continue;
	try {
		const file = await stat(reference.assetPath);
		if (!file.isFile()) {
			throw new Error(`Preloaded font is not a file: ${reference.url}`);
		}
		preloadedFiles.set(reference.assetPath, file.size);
	} catch (error) {
		if (error?.code === "ENOENT") {
			throw new Error(
				`Preloaded font was not emitted: ${reference.url} (in ${reference.path})`,
			);
		}
		throw error;
	}
}

let maxPagePreloadBytes = 0;
let maxPagePath = "";
let indexPreloadBytes = 0;
let indexPreloadCount = 0;
for (const page of pagesWithPreloads) {
	let pageBytes = 0;
	const unique = new Set();
	for (const preload of page.preloads) {
		if (unique.has(preload.assetPath)) continue;
		unique.add(preload.assetPath);
		pageBytes += preloadedFiles.get(preload.assetPath) ?? 0;
	}
	if (pageBytes > maxPagePreloadBytes) {
		maxPagePreloadBytes = pageBytes;
		maxPagePath = page.path;
	}
	if (page.path === join(distDir, "index.html")) {
		indexPreloadBytes = pageBytes;
		indexPreloadCount = unique.size;
	}
}

if (maxPagePreloadBytes > MAX_PAGE_PRELOAD_BYTES) {
	throw new Error(
		`A page preloads ${maxPagePreloadBytes} font bytes ` +
			`(${maxPagePath.slice(distDir.length + 1)}); ` +
			`budget is ${MAX_PAGE_PRELOAD_BYTES} bytes.`,
	);
}

// Total slice payload on disk.
let totalSliceBytes = 0;
let sliceFiles = 0;
if (existsSync(slicesDir)) {
	const slicePaths = (await collectFiles(slicesDir)).filter((path) =>
		path.endsWith(".woff2"),
	);
	sliceFiles = slicePaths.length;
	for (const path of slicePaths) {
		totalSliceBytes += (await stat(path)).size;
	}
}

if (sliceFiles === 0) {
	throw new Error(
		"No font slices found in dist/fonts/slices; did prepare-font-slices run?",
	);
}
if (totalSliceBytes > MAX_TOTAL_SLICE_BYTES) {
	throw new Error(
		`Font slices take ${totalSliceBytes} bytes; budget is ${MAX_TOTAL_SLICE_BYTES} bytes.`,
	);
}
if (unicodeRangeRules === 0) {
	throw new Error(
		"No @font-face rule with unicode-range found in dist CSS; slicing is broken.",
	);
}

if (
	process.env.MIZUKI_FONT_MODE === "system" &&
	(customFontBlocks > 0 || preloadReferences.length > 0 || sliceFiles > 0)
) {
	throw new Error(
		"System font mode must not emit Astro custom font references.",
	);
}

console.log(
	`Font loading check passed: ${sliceFiles} slices / ` +
		`${(totalSliceBytes / 1024 / 1024).toFixed(2)} MB total, ` +
		`${preloadReferences.length} preload link(s) on ${pagesWithPreloads.length} page(s), ` +
		`index.html ${indexPreloadCount} link(s) / ${(indexPreloadBytes / 1024).toFixed(0)} KB, ` +
		`max page ${(maxPagePreloadBytes / 1024).toFixed(0)} KB, ` +
		`${unicodeRangeRules} unicode-range rule(s), ` +
		`${referencedFontFiles.size} referenced file(s) / ${referencedFontBytes} bytes.`,
);
