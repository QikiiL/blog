import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const astroConfig = await readFile(
	new URL("../astro.config.mjs", import.meta.url),
	"utf8",
);
const layoutSource = await readFile(
	new URL("../src/layouts/Layout.astro", import.meta.url),
	"utf8",
);
const mainStyles = await readFile(
	new URL("../src/styles/main.css", import.meta.url),
	"utf8",
);
const configTypes = await readFile(
	new URL("../src/types/config.ts", import.meta.url),
	"utf8",
);
const fontModeSource = await readFile(
	new URL("../src/utils/fontMode.ts", import.meta.url),
	"utf8",
);
const fontCheckSource = await readFile(
	new URL("../scripts/check-font-loading.mjs", import.meta.url),
	"utf8",
);
const sliceScriptSource = await readFile(
	new URL("../scripts/prepare-font-slices.mjs", import.meta.url),
	"utf8",
);
const preloadScriptSource = await readFile(
	new URL("../scripts/inject-font-preloads.mjs", import.meta.url),
	"utf8",
);
const packageJson = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const generatedCssPath = new URL(
	"../src/styles/fonts.generated.css",
	import.meta.url,
);
const manifestPath = new URL(
	"../public/fonts/slices/manifest.json",
	import.meta.url,
);
const generatedArtifactsExist =
	existsSync(generatedCssPath) && existsSync(manifestPath);

describe("Custom font loading boundary", () => {
	it("no longer ships the two display fonts through the Astro Fonts API", () => {
		assert.doesNotMatch(astroConfig, /name:\s*"ZenMaruGothic-Medium"/);
		assert.doesNotMatch(astroConfig, /name:\s*"Loli"/);
		assert.doesNotMatch(astroConfig, /src: \["\.\/src\/assets\/fonts\/[^\]]+\.woff2"\]/);
		assert.doesNotMatch(astroConfig, /src: \[[^\]]+\.ttf/);
	});

	it("keeps the monospace font on the Fonts API", () => {
		assert.match(astroConfig, /fonts:\s*customFontsEnabled\s*\?\s*\[/);
		assert.match(astroConfig, /name:\s*"JetBrains Mono"/);
		assert.match(astroConfig, /cssVariable:\s*"--font-jetbrains-mono"/);
		assert.equal(
			(layoutSource.match(/customFontsEnabled\s*&&\s*<Font/g) ?? []).length,
			1,
		);
		assert.match(layoutSource, /<Font cssVariable="--font-jetbrains-mono" preload \/>/);
	});

	it("loads the sliced @font-face rules from the generated stylesheet", () => {
		assert.doesNotMatch(layoutSource, /cssVariable="--font-body"/);
		assert.doesNotMatch(layoutSource, /cssVariable="--font-cjk"/);
		assert.match(layoutSource, /import "\.\.\/styles\/fonts\.generated\.css";/);
	});

	it("keeps PR #502's ZenMaru -> Loli fallback contract", () => {
		const bodyIndex = mainStyles.indexOf("var(--font-body");
		const cjkIndex = mainStyles.indexOf("var(--font-cjk");
		assert.ok(bodyIndex >= 0 && cjkIndex > bodyIndex);
		// The slice generator must restore the variables the Fonts API used to inject.
		assert.match(sliceScriptSource, /--font-body/);
		assert.match(sliceScriptSource, /--font-cjk/);
		assert.match(sliceScriptSource, /cssVariable:\s*"--font-body"/);
		assert.match(sliceScriptSource, /cssVariable:\s*"--font-cjk"/);
	});

	it("generates unicode-range slices and validates the glyph coverage", () => {
		assert.match(sliceScriptSource, /cn-font-split/);
		assert.match(sliceScriptSource, /chunkSize:\s*CHUNK_SIZE/);
		assert.match(sliceScriptSource, /unicode-range/);
		assert.match(sliceScriptSource, /manifest\.json/);
		assert.match(sliceScriptSource, /readWoff2Cmap/);
		assert.match(sliceScriptSource, /readTtfCmap/);
		// Missing glyphs must fail the build instead of silently shipping.
		assert.match(sliceScriptSource, /process\.exit\(1\)/);
		assert.match(sliceScriptSource, /coverage: source=/);
	});

	it("injects per-page font preloads after the build", () => {
		assert.match(preloadScriptSource, /rel="preload"/);
		assert.match(preloadScriptSource, /as="font"/);
		assert.match(preloadScriptSource, /type="font\/woff2"/);
		assert.match(preloadScriptSource, /crossorigin/);
		assert.match(preloadScriptSource, /PER_PAGE_BUDGET/);
		assert.match(preloadScriptSource, /manifest\.json/);

		const buildScript = packageJson.scripts.build;
		const astroBuildIndex = buildScript.indexOf("astro build");
		const injectIndex = buildScript.indexOf("inject-font-preloads.mjs");
		const prefixIndex = buildScript.indexOf("prefix-public-images.mjs");
		assert.ok(astroBuildIndex >= 0 && injectIndex > astroBuildIndex);
		assert.ok(prefixIndex > injectIndex);
	});

	it("runs the slice generator before dev and build", () => {
		assert.match(packageJson.scripts.predev, /prepare-font-slices\.mjs/);
		assert.match(packageJson.scripts.prebuild, /prepare-font-slices\.mjs/);
	});

	it("checks the new font budgets in the built output", () => {
		assert.match(fontCheckSource, /MAX_PAGE_PRELOAD_BYTES\s*=\s*1\.5 \* 1024 \* 1024/);
		assert.match(fontCheckSource, /MAX_TOTAL_SLICE_BYTES\s*=\s*12 \* 1024 \* 1024/);
		assert.match(fontCheckSource, /PRELOAD_FONT_LINK_PATTERN/);
		assert.match(fontCheckSource, /unicode-range/);
		assert.doesNotMatch(fontCheckSource, /MAX_CUSTOM_FONT_BYTES/);
	});

	it("defaults older configurations without a font block to custom mode", () => {
		assert.match(configTypes, /font\?:\s*{\s*mode\?:\s*"custom" \| "system"/);
		assert.match(
			fontModeSource,
			/environmentMode\s*\?\?\s*config\.font\?\.mode\s*\?\?\s*"custom"/,
		);
	});

	it("emits unicode-range rules and a non-empty manifest when generated", async (t) => {
		if (!generatedArtifactsExist) {
			t.diagnostic(
				"fonts.generated.css / manifest.json not generated yet; run scripts/prepare-font-slices.mjs",
			);
			return;
		}

		const generatedCss = await readFile(generatedCssPath, "utf8");
		const fontFaceRules = generatedCss.match(
			/@font-face\{[^}]*unicode-range:[^}]*\}/g,
		);
		assert.ok(fontFaceRules && fontFaceRules.length > 10);
		assert.match(generatedCss, /:root\{[^}]*--font-body:"ZenMaruGothic-Medium"/);
		assert.match(generatedCss, /:root\{[^}]*--font-cjk:"Loli"/);

		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		const slices = manifest.fonts.flatMap((font) => font.slices);
		assert.ok(slices.length > 0);
		assert.equal(
			manifest.fonts.length,
			2,
			"both display fonts must be sliced",
		);
		for (const slice of slices) {
			assert.match(slice.file, /\.woff2$/);
			assert.ok(slice.bytes > 0);
			assert.ok(slice.ranges.length > 0);
		}
	});
});
