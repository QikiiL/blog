import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const distDirectory = path.join(projectRoot, "dist");

// 从 astro.config.mjs 读取 base（正则方式，脚本无法 import TypeScript 配置）
const astroConfigSource = await readFile(
	path.join(projectRoot, "astro.config.mjs"),
	"utf8",
);
const baseMatch = astroConfigSource.match(/\bbase\s*:\s*["']([^"']*)["']/);
// 归一化为不带尾斜杠的形式，例如 "/blog/" → "/blog"，根路径保持 "/"
const siteBasePath = (baseMatch?.[1] ?? "/").replace(/\/+$/, "") || "/";

function stripSiteBasePath(pathname) {
	if (siteBasePath === "/") {
		return pathname;
	}
	if (pathname === siteBasePath) {
		return "/";
	}
	if (pathname.startsWith(`${siteBasePath}/`)) {
		return pathname.slice(siteBasePath.length);
	}
	return pathname;
}

function getAttribute(tag, name) {
	const match = tag.match(
		new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
	);
	return match?.[1] ?? match?.[2] ?? match?.[3];
}

async function loadPageStyles(htmlPath) {
	const html = await readFile(path.join(distDirectory, htmlPath), "utf8");
	const stylesheetUrls = [...html.matchAll(/<link\b[^>]*>/gi)]
		.map(([tag]) => ({
			href: getAttribute(tag, "href"),
			rel: getAttribute(tag, "rel"),
		}))
		.filter(
			({ href, rel }) =>
				href && rel?.split(/\s+/).some((value) => value === "stylesheet"),
		)
		.map(({ href }) => href);

	const inlineStyles = [
		...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
	]
		.map((match) => match[1])
		.join("\n");

	const linkedStyles = await Promise.all(
		stylesheetUrls.map(async (stylesheetUrl) => {
			const pathname = decodeURIComponent(stylesheetUrl.split(/[?#]/, 1)[0]);
			if (
				/^(?:[a-z]+:)?\/\//i.test(pathname) ||
				pathname.startsWith("data:")
			) {
				return "";
			}

			// base 只是 URL 前缀，Astro 并不会在 dist 下创建对应的物理目录，
			// 解析磁盘路径前先剥掉 base 段。
			const siteRelativePath = stripSiteBasePath(pathname);
			const assetPath = path.resolve(
				distDirectory,
				siteRelativePath.startsWith("/")
					? siteRelativePath.slice(1)
					: siteRelativePath,
			);
			const relativePath = path.relative(distDirectory, assetPath);
			if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
				throw new Error(
					`Stylesheet escapes dist directory: ${stylesheetUrl}`,
				);
			}

			return readFile(assetPath, "utf8");
		}),
	);

	return {
		html,
		loadedCss: `${inlineStyles}\n${linkedStyles.join("\n")}`,
		stylesheetUrls,
	};
}

const pages = [
	{
		name: "Homepage",
		htmlPath: "index.html",
		requiredMarkup: [],
		requiredRules: [
			["--page-bg:", "page background variable"],
			["--card-bg:", "card background variable"],
			["--radius-large:", "shared radius variable"],
			["#banner-carousel", "banner layout styles"],
			[".widget-container", "responsive widget styles"],
		],
	},
	{
		name: "About page",
		htmlPath: "about/index.html",
		requiredMarkup: [["card-github", "rendered GitHub repository card"]],
		requiredRules: [
			[".card-github", "GitHub repository card styles"],
			[".custom-md .image-grid", "extended Markdown layout styles"],
		],
	},
];

for (const page of pages) {
	const { html, loadedCss, stylesheetUrls } = await loadPageStyles(page.htmlPath);
	const missingMarkup = page.requiredMarkup
		.filter(([token]) => !html.includes(token))
		.map(([, description]) => description);
	const missingRules = page.requiredRules
		.filter(([token]) => !loadedCss.includes(token))
		.map(([, description]) => description);

	if (missingMarkup.length > 0 || missingRules.length > 0) {
		const loadedStylesheets = stylesheetUrls.join(", ") || "none";
		const missing = [
			...missingMarkup.map((description) => `${description} markup`),
			...missingRules,
		];
		throw new Error(
			`${page.name} is missing: ${missing.join(", ")}. ` +
				`Loaded stylesheets: ${loadedStylesheets}`,
		);
	}

	console.log(
		`Verified ${page.name.toLowerCase()} styles across ` +
			`${stylesheetUrls.length} linked stylesheet(s).`,
	);
}
