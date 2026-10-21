import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	codepointsToRanges,
	formatUnicodeRange,
	parseUnicodeRange,
	readTtfCmap,
	readWoff2Cmap,
} from "./lib/font-cmap.mjs";

/**
 * Split the two custom display fonts into unicode-range slices.
 *
 * Output (all generated at build time, git-ignored):
 *   public/fonts/slices/<id>/*.woff2        – slices served to the browser
 *   public/fonts/slices/<id>/slices.json    – per-font slice metadata
 *   public/fonts/slices/manifest.json       – everything the preload injector needs
 *   src/styles/fonts.generated.css          – @font-face rules + :root variables
 *
 * The `unicode-range` of every slice is recomputed from the slice's real cmap:
 * cn-font-split can emit a handful of glyphs outside the range it declares, and
 * a wrong range would mean a missing glyph in the browser.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slicesRoot = resolve(projectRoot, "public", "fonts", "slices");
const generatedCssPath = resolve(
	projectRoot,
	"src",
	"styles",
	"fonts.generated.css",
);
const manifestPath = join(slicesRoot, "manifest.json");

// ~200KB slices: few enough slices to keep the generated CSS small, small
// enough that a first screen only pulls a couple hundred KB of glyphs.
const CHUNK_SIZE = 204800;
// Pinned cn-font-split wasm core; keep in sync with the dependency version
// whose output was validated for this pipeline.
const CN_FONT_SPLIT_CORE_VERSION = "7.6.8";

const FONTS = [
	{
		id: "loli",
		source: resolve(projectRoot, "src", "assets", "fonts", "loli.ttf"),
		family: "Loli",
		weight: "400",
		cssVariable: "--font-cjk",
	},
	{
		id: "zenmaru",
		source: resolve(
			projectRoot,
			"src",
			"assets",
			"fonts",
			"ZenMaruGothic-Medium.ttf",
		),
		family: "ZenMaruGothic-Medium",
		weight: "500",
		cssVariable: "--font-body",
	},
];

function formatCode(code) {
	return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function resolveFontMode() {
	const mode = process.env.MIZUKI_FONT_MODE ?? "custom";
	if (mode !== "custom" && mode !== "system") {
		throw new Error(
			`Invalid font mode "${mode}". Expected "custom" or "system".`,
		);
	}
	return mode;
}

async function ensureFontSplitCore() {
	const distDir = resolve(projectRoot, "node_modules", "cn-font-split", "dist");
	if (!existsSync(distDir)) {
		throw new Error(
			"cn-font-split is not installed. Run `pnpm install` before building.",
		);
	}

	const corePattern = /^libffi-.*\.(?:so|dylib|dll|wasm)$/;
	const installed = (await readdir(distDir)).find((name) =>
		corePattern.test(name),
	);
	if (installed) return installed;

	console.log(
		`cn-font-split core missing, installing pinned ${CN_FONT_SPLIT_CORE_VERSION} …`,
	);
	const cli = join(distDir, "cli.js");
	const result = spawnSync(
		process.execPath,
		[cli, "i", `default@${CN_FONT_SPLIT_CORE_VERSION}`],
		{ stdio: "inherit" },
	);
	if (result.status !== 0) {
		throw new Error(
			`cn-font-split core installation failed (exit ${result.status}). ` +
				`Install it manually: node ${cli} i default@${CN_FONT_SPLIT_CORE_VERSION}`,
		);
	}

	const downloaded = (await readdir(distDir)).find((name) =>
		corePattern.test(name),
	);
	if (!downloaded) {
		throw new Error("cn-font-split core is still missing after installation");
	}
	return downloaded;
}

async function loadFontSplit() {
	const module = await import("cn-font-split");
	const fontSplit =
		module.fontSplit ?? module.default?.fontSplit ?? module.default;
	if (typeof fontSplit !== "function") {
		throw new Error("cn-font-split does not expose a fontSplit() function");
	}
	return fontSplit;
}

async function runFontSplit(fontSplit, font, outDir) {
	const source = await readFile(font.source);
	const startedAt = Date.now();
	await fontSplit({
		input: new Uint8Array(source),
		outDir,
		chunkSize: CHUNK_SIZE,
		css: {
			fontFamily: font.family,
			fontWeight: font.weight,
			fontStyle: "normal",
			fontDisplay: "swap",
			commentBase: false,
			commentNameTable: false,
			commentUnicodes: false,
			compress: false,
		},
		testHtml: false,
		reporter: false,
		silent: true,
	});
	return Date.now() - startedAt;
}

function readDeclaredRanges(resultCss) {
	const declared = new Map();
	for (const match of resultCss.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
		const block = match[1];
		const file = block.match(/url\(\s*["']?\.\/([^"')]+\.woff2)["']?\s*\)/)?.[1];
		const range = block.match(/unicode-range\s*:\s*([^;}]+)/)?.[1];
		if (file && range) declared.set(file, parseUnicodeRange(range));
	}
	return declared;
}

async function processFont(fontSplit, font) {
	const outDir = join(slicesRoot, font.id);
	const resultCssPath = join(outDir, "result.css");

	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	console.log(`[${font.id}] splitting ${font.source} …`);
	const durationMs = await runFontSplit(fontSplit, font, outDir);

	const declared = existsSync(resultCssPath)
		? readDeclaredRanges(await readFile(resultCssPath, "utf8"))
		: new Map();

	// Drop everything but the slices so the published directory stays clean.
	for (const name of await readdir(outDir)) {
		if (!name.endsWith(".woff2")) {
			await rm(join(outDir, name), { recursive: true, force: true });
		}
	}

	const sliceFiles = (await readdir(outDir))
		.filter((name) => name.endsWith(".woff2"))
		.sort();
	if (sliceFiles.length === 0) {
		throw new Error(`[${font.id}] cn-font-split produced no slices`);
	}

	const sourceCmap = readTtfCmap(await readFile(font.source));
	const slices = [];
	const covered = new Set();
	let totalBytes = 0;
	let mismatchedSlices = 0;
	let outOfRangeGlyphs = 0;
	const mismatchSamples = [];

	for (const file of sliceFiles) {
		const path = join(outDir, file);
		const bytes = (await stat(path)).size;
		const cmap = readWoff2Cmap(await readFile(path));
		const ranges = codepointsToRanges(cmap);

		for (const code of cmap) covered.add(code);
		totalBytes += bytes;

		const declaredRanges = declared.get(file);
		if (declaredRanges) {
			const outside = [...cmap].filter(
				(code) =>
					!declaredRanges.some(([start, end]) => code >= start && code <= end),
			);
			if (outside.length > 0) {
				mismatchedSlices += 1;
				outOfRangeGlyphs += outside.length;
				if (mismatchSamples.length < 3) {
					mismatchSamples.push(
						`${file.slice(0, 8)}…: ${outside
							.slice(0, 6)
							.map(formatCode)
							.join(",")}`,
					);
				}
			}
		}

		slices.push({ file, bytes, codepoints: cmap.size, ranges });
	}

	const missing = [...sourceCmap].filter((code) => !covered.has(code));
	const extra = [...covered].filter((code) => !sourceCmap.has(code));

	console.log(
		`[${font.id}] ${sliceFiles.length} slices, ${(totalBytes / 1024 / 1024).toFixed(2)} MB, ` +
			`${(durationMs / 1000).toFixed(1)}s`,
	);
	console.log(
		`[${font.id}] coverage: source=${sourceCmap.size} union=${covered.size} ` +
			`missing=${missing.length} extra=${extra.length}`,
	);
	if (mismatchedSlices > 0) {
		console.log(
			`[${font.id}] cn-font-split declared unicode-range missed ` +
				`${outOfRangeGlyphs} glyph(s) in ${mismatchedSlices} slice(s); ` +
				`ranges were recomputed from the real cmap`,
		);
		for (const sample of mismatchSamples) console.log(`[${font.id}]   ${sample}`);
	}

	if (missing.length > 0) {
		console.error(
			`[${font.id}] FATAL: ${missing.length} code point(s) from the source font ` +
				`are not covered by any slice. Sample: ${missing
					.slice(0, 12)
					.map(formatCode)
					.join(",")}`,
		);
		process.exit(1);
	}

	const meta = {
		id: font.id,
		family: font.family,
		weight: font.weight,
		cssVariable: font.cssVariable,
		urlPrefix: `/fonts/slices/${font.id}`,
		chunkSize: CHUNK_SIZE,
		sourceCodepoints: sourceCmap.size,
		totalBytes,
		slices,
	};
	await writeFile(
		join(outDir, "slices.json"),
		`${JSON.stringify(meta, null, "\t")}\n`,
	);

	return meta;
}

function buildCss(fontMetas) {
	const lines = [
		"/* Generated by scripts/prepare-font-slices.mjs — do not edit by hand. */",
		"/* Custom fonts are split into unicode-range slices so the browser only",
		"   downloads the slices a page actually needs. */",
	];
	for (const meta of fontMetas) {
		for (const slice of meta.slices) {
			lines.push(
				`@font-face{font-family:"${meta.family}";` +
					`src:url("${meta.urlPrefix}/${slice.file}") format("woff2");` +
					`font-style:normal;font-weight:${meta.weight};font-display:swap;` +
					`unicode-range:${formatUnicodeRange(slice.ranges)}}`,
			);
		}
	}
	lines.push(
		`:root{${fontMetas
			.map((meta) => `${meta.cssVariable}:"${meta.family}"`)
			.join(";")}}`,
	);
	lines.push("");
	return lines.join("\n");
}

async function writeSystemModeOutput() {
	await rm(slicesRoot, { recursive: true, force: true });
	await mkdir(slicesRoot, { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify({ fonts: [] }, null, "\t")}\n`);
	await writeFile(
		generatedCssPath,
		"/* Generated by scripts/prepare-font-slices.mjs — system font mode: no custom fonts. */\n",
	);
	console.log("Font mode is 'system': custom font slices were removed.");
}

const requested = process.argv
	.slice(2)
	.filter((arg) => arg.startsWith("--only="))
	.flatMap((arg) => arg.slice("--only=".length).split(","))
	.filter(Boolean);

if (resolveFontMode() === "system") {
	await writeSystemModeOutput();
	process.exit(0);
}

const targets = requested.length
	? FONTS.filter((font) => requested.includes(font.id))
	: FONTS;
if (targets.length === 0) {
	throw new Error(
		`No font matched --only=${requested.join(",")}; known ids: ${FONTS.map((font) => font.id).join(",")}`,
	);
}

await mkdir(slicesRoot, { recursive: true });
await ensureFontSplitCore();
const fontSplit = await loadFontSplit();

for (const font of targets) {
	await processFont(fontSplit, font);
}

// Assemble CSS + manifest from every font that has slice metadata, so a
// partial run (`--only=`) still produces a complete site.
const fontMetas = [];
for (const font of FONTS) {
	const metaPath = join(slicesRoot, font.id, "slices.json");
	if (!existsSync(metaPath)) {
		if (requested.length > 0) {
			console.warn(
				`Skipping "${font.id}": no slice metadata yet (partial --only run).`,
			);
			continue;
		}
		throw new Error(
			`Missing slice metadata for "${font.id}"; run ` +
				`\`node scripts/prepare-font-slices.mjs\` without --only.`,
		);
	}
	fontMetas.push(JSON.parse(await readFile(metaPath, "utf8")));
}

await writeFile(generatedCssPath, buildCss(fontMetas));

const manifest = {
	chunkSize: CHUNK_SIZE,
	fonts: fontMetas.map((meta) => ({
		id: meta.id,
		family: meta.family,
		weight: meta.weight,
		cssVariable: meta.cssVariable,
		urlPrefix: meta.urlPrefix,
		totalBytes: meta.totalBytes,
		slices: meta.slices,
	})),
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

const totalBytes = fontMetas.reduce((sum, meta) => sum + meta.totalBytes, 0);
const totalSlices = fontMetas.reduce((sum, meta) => sum + meta.slices.length, 0);
console.log(
	`Font slices ready: ${totalSlices} slices, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total.`,
);
console.log(`  CSS:      ${generatedCssPath}`);
console.log(`  manifest: ${manifestPath}`);

// The native cn-font-split core keeps a handle on the event loop after the
// split, so the process would otherwise never exit (and `prebuild` would hang).
await new Promise((resolve) => process.stdout.write("", resolve));
process.exit(0);
