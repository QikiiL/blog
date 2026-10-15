import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// 横幅图片扩展名白名单（小写比较）
const BANNER_EXTENSIONS = new Set([
	".webp",
	".png",
	".jpg",
	".jpeg",
	".avif",
	".gif",
]);

// 横幅方向 -> 站点目标目录名
const BANNER_DIRECTIONS = [
	{ key: "desktop", target: "desktop-banner" },
	{ key: "mobile", target: "mobile-banner" },
];

// 枚举横幅源目录下的图片文件（过滤子目录与非图片），按文件名排序保证确定性
function listBannerImages(sourceDir) {
	const stat = fs.lstatSync(sourceDir, { throwIfNoEntry: false });
	if (!stat?.isDirectory()) {
		return [];
	}

	return fs
		.readdirSync(sourceDir, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				BANNER_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
		)
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
}

/**
 * 把内容仓库的横幅图片同步到站点资源目录，并写出清单 JSON。
 *
 * - 源目录：<contentRoot>/images/banners/<desktop|mobile>/
 * - 第 i 张（从 1 起）复制为 <i><源扩展名>，写入：
 *   public/assets/<方向>-banner/ 与 src/assets/public/assets/<方向>-banner/
 *   （Astro 图片管线要求两处都存在）
 * - 清理目标目录中不在本次编号集合里的旧图片文件（支持张数减少、扩展名变化）
 * - 源目录缺失或无图片时告警并跳过该方向（保留目标目录现状，避免误删导致背景消失）
 * - 清单写入 src/config/generated-banners.json（已 gitignore，由 prebuild 重新生成）
 *
 * 本模块不产生副作用（顶层不执行同步），可被测试单独导入调用。
 *
 * @param {string} contentRoot 内容仓库根目录
 * @returns {{desktop: string[], mobile: string[]}} 生成的文件清单（站点绝对路径）
 */
export function syncBanners(contentRoot) {
	const generated = {};

	for (const { key, target } of BANNER_DIRECTIONS) {
		const sourceDir = path.join(contentRoot, "images", "banners", key);
		const destDirs = [
			path.join(rootDir, "public", "assets", target),
			path.join(rootDir, "src", "assets", "public", "assets", target),
		];

		const sourceFiles = listBannerImages(sourceDir);
		if (sourceFiles.length === 0) {
			console.warn(
				`未找到 ${key} 横幅图片，跳过该方向（保留现有资源）：${sourceDir}`,
			);
			generated[key] = [];
			continue;
		}

		// 重编号并复制：第 i 张 -> <i><扩展名>
		const plannedNames = [];
		sourceFiles.forEach((fileName, index) => {
			const ext = path.extname(fileName);
			const targetName = `${index + 1}${ext}`;
			plannedNames.push(targetName);

			for (const destDir of destDirs) {
				fs.mkdirSync(destDir, { recursive: true });
				fs.copyFileSync(
					path.join(sourceDir, fileName),
					path.join(destDir, targetName),
				);
			}
		});

		// 清理旧编号/旧扩展名残留（只删图片文件，其它文件一律不动）
		for (const destDir of destDirs) {
			for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
				if (!entry.isFile()) {
					continue;
				}
				if (!BANNER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
					continue;
				}
				if (!plannedNames.includes(entry.name)) {
					fs.rmSync(path.join(destDir, entry.name));
					console.log(`已清理旧横幅：${target}/${entry.name}`);
				}
			}
		}

		generated[key] = plannedNames.map((name) => `/assets/${target}/${name}`);
		console.log(
			`已同步 ${key} 横幅 ${plannedNames.length} 张：${sourceFiles.join(", ")}`,
		);
	}

	// 写出清单供 siteConfig.ts 读取（已 gitignore，构建前由 prebuild 重新生成）
	const configPath = path.join(
		rootDir,
		"src",
		"config",
		"generated-banners.json",
	);
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, `${JSON.stringify(generated, null, 2)}\n`);
	console.log(`已生成横幅清单：${path.relative(rootDir, configPath)}`);

	return generated;
}
