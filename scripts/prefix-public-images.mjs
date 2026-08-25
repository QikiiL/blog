import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(projectRoot, "dist");
// cdn.jsdmirror.com 是 jsDelivr 的国内镜像，要求按
// https://cdn.jsdmirror.com/gh/<owner>/<repo>@<branch>/<path> 格式访问。
// 站点通过 GitHub Pages 部署，产物在仓库的 `pages` 分支上（dist 根目录即仓库根目录）。
const CDN = "https://cdn.jsdmirror.com";
const CDN_BASE = `${CDN}/gh/QikiiL/blog@pages`;
// 需要走 CDN 的静态资源扩展名：图片 + 字体
const CDN_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".woff",
	".woff2",
	".ttf",
	".otf",
]);

async function collectFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(fullPath)));
		} else if ([".html", ".css"].includes(extname(entry.name).toLowerCase())) {
			files.push(fullPath);
		}
	}
	return files;
}

function prefixImageUrl(url) {
	const raw = url.trim();
	if (!raw) return raw;
	// 已经是 CDN 或外部协议，跳过
	if (raw.startsWith(CDN) || /^(?:data:|https?:|blob:)/i.test(raw)) {
		return raw;
	}
	const pathname = raw.split(/[?#]/, 1)[0];
	if (!CDN_EXTENSIONS.has(extname(pathname).toLowerCase())) {
		return raw;
	}
	if (raw.startsWith("/")) {
		return CDN_BASE + raw;
	}
	return `${CDN_BASE}/${raw}`;
}

function processSrcset(value) {
	return value
		.split(",")
		.map((part) => {
			const trimmed = part.trim();
			if (!trimmed) return part;
			const tokens = trimmed.split(/\s+/);
			tokens[0] = prefixImageUrl(tokens[0]);
			return tokens.join(" ");
		})
		.join(", ");
}

function processHtml(content) {
	content = content.replace(
		/(\b(?:src|data-src|poster)=")([^"]*)(")/g,
		(_match, prefix, value, suffix) => prefix + prefixImageUrl(value) + suffix,
	);
	content = content.replace(
		/(\bsrcset=")([^"]*)(")/g,
		(_match, prefix, value, suffix) => prefix + processSrcset(value) + suffix,
	);
	content = content.replace(
		/(url\()(['"]?)([^)'"]+)(\2\))/g,
		(_match, prefix, quote, value, suffix) =>
			prefix + quote + prefixImageUrl(value) + suffix,
	);
	return content;
}

function processCss(content) {
	return content.replace(
		/(url\()(['"]?)([^)'"]+)(\2\))/g,
		(_match, prefix, quote, value, suffix) =>
			prefix + quote + prefixImageUrl(value) + suffix,
	);
}

const files = await collectFiles(distDir);
let changedFiles = 0;
let replacedUrls = 0;

for (const file of files) {
	const original = await readFile(file, "utf8");
	const isHtml = extname(file).toLowerCase() === ".html";
	const updated = isHtml ? processHtml(original) : processCss(original);
	if (updated !== original) {
		await writeFile(file, updated);
		changedFiles += 1;
		replacedUrls +=
			(updated.match(/cdn\.jsdmirror\.com/g) ?? []).length -
			(original.match(/cdn\.jsdmirror\.com/g) ?? []).length;
	}
}

console.log(
	`CDN prefix applied: ${changedFiles} file(s) changed, ${replacedUrls} prefixed URL(s).`,
);
