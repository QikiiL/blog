import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "./load-env.js";

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

loadEnv();
console.log("已加载 .env 配置文件\n");

// 从环境变量读取配置
const ENABLE_CONTENT_SYNC = process.env.ENABLE_CONTENT_SYNC !== "false"; // 默认启用
const CONTENT_REPO_URL = process.env.CONTENT_REPO_URL || "";
const CONTENT_DIR = process.env.CONTENT_DIR || path.join(rootDir, "content");

console.log("开始同步内容...\n");

// 检查是否启用内容分离
if (!ENABLE_CONTENT_SYNC) {
	console.log("内容分离功能已关闭（ENABLE_CONTENT_SYNC=false）");
	console.log("提示：将使用本地内容，不会从远程仓库同步");
	console.log("      若要启用内容分离，请在 .env 中设置：");
	console.log("      ENABLE_CONTENT_SYNC=true");
	console.log("      CONTENT_REPO_URL=<your-repo-url>\n");
	process.exit(0);
}

// 检查内容目录是否存在
if (!fs.existsSync(CONTENT_DIR)) {
	console.log(`内容目录不存在：${CONTENT_DIR}`);
	console.log("将使用独立仓库模式");

	if (!CONTENT_REPO_URL) {
		console.warn("警告：未设置 CONTENT_REPO_URL，将使用本地内容");
		console.log(
			"提示：请设置 CONTENT_REPO_URL 环境变量，或手动创建内容目录",
		);
		process.exit(0);
	}

	try {
		console.log(`正在克隆内容仓库：${CONTENT_REPO_URL}`);
		execSync(`git clone --depth 1 ${CONTENT_REPO_URL} ${CONTENT_DIR}`, {
			stdio: "inherit",
			cwd: rootDir,
		});
		console.log("内容仓库克隆成功");
	} catch (error) {
		console.error("克隆失败：", error.message);
		process.exit(1);
	}
} else {
	console.log(`内容目录已存在：${CONTENT_DIR}`);

	if (fs.existsSync(path.join(CONTENT_DIR, ".git"))) {
		try {
			console.log("正在同步远程内容（强制模式）...");

			// 1. 防止本地修改丢失
			execSync("git stash push --include-untracked -m 'auto-sync'", {
				stdio: "inherit",
				cwd: CONTENT_DIR,
			});

			// 2. 更新远程引用
			execSync("git fetch --all --prune", {
				stdio: "inherit",
				cwd: CONTENT_DIR,
			});

			// 3. 判断分支
			let branch = "main";
			try {
				execSync("git rev-parse --verify origin/main", { cwd: CONTENT_DIR });
			} catch {
				branch = "master";
			}

			// 4. 强制同步
		execSync(`git checkout ${branch}`, { cwd: CONTENT_DIR });
		execSync(`git reset --hard origin/${branch}`, { cwd: CONTENT_DIR });

		console.log(`内容同步成功（分支：${branch}）`);
		} catch (error) {
			console.warn("内容更新失败：", error.message);
		}
	}
}

// 创建符号链接或复制内容
console.log("\n正在建立内容链接...");

const contentMappings = [
	{ src: "posts", dest: "src/content/posts" },
	{ src: "spec", dest: "src/content/spec" },
	{ src: "data", dest: "src/data" },
	{ src: "images", dest: "public/images" },
	// 覆盖文件是带相对导入的 TS 模块，符号链接会被 Vite 解析到内容仓库真实
	// 路径导致找不到 types/config，因此复制进代码仓库而不是建链接
	{ src: "overrides", dest: "src/config/overrides", copy: true },
	// TinaCMS 全局配置 JSON 同样复制进代码仓库，供构建时读取
	{ src: "global", dest: "src/config/global", copy: true },
	// TinaCMS 友链数据 JSON
	{ src: "friends", dest: "src/config/friends", copy: true },
];

for (const mapping of contentMappings) {
	const srcPath = path.join(CONTENT_DIR, mapping.src);
	const destPath = path.join(rootDir, mapping.dest);

	if (!fs.existsSync(srcPath)) {
		// 内容仓库删掉 overrides/ 后清掉上次的副本，避免旧配置继续生效
		if (mapping.copy) {
			const stat = fs.lstatSync(destPath, { throwIfNoEntry: false });
			if (stat) {
				if (stat.isSymbolicLink()) {
					fs.unlinkSync(destPath);
				} else {
					fs.rmSync(destPath, { recursive: true, force: true });
				}
				console.log(`已清理失效的配置覆盖：${mapping.dest}`);
			}
		}
		console.log(`跳过不存在的源目录：${mapping.src}`);
		continue;
	}

	// 覆盖目录由本脚本复制维护，直接删除重建，不走备份逻辑
	if (mapping.copy) {
		const stat = fs.lstatSync(destPath, { throwIfNoEntry: false });
		if (stat) {
			if (stat.isSymbolicLink()) {
				fs.unlinkSync(destPath);
			} else {
				fs.rmSync(destPath, { recursive: true, force: true });
			}
		}
		copyRecursive(srcPath, destPath);
		console.log(`已复制配置覆盖：${mapping.src} -> ${mapping.dest}`);
		continue;
	}

	// 如果目标已存在且不是符号链接,备份它
	if (fs.existsSync(destPath) && !fs.lstatSync(destPath).isSymbolicLink()) {
		const backupPath = `${destPath}.backup`;
		console.log(
			`正在备份已有内容：${mapping.dest} -> ${mapping.dest}.backup`,
		);
		if (fs.existsSync(backupPath)) {
			fs.rmSync(backupPath, { recursive: true, force: true });
		}
		fs.renameSync(destPath, backupPath);
	}

	// 删除现有的符号链接
	if (fs.existsSync(destPath)) {
		fs.unlinkSync(destPath);
	}

	// 创建符号链接 (Windows 需要管理员权限,否则复制文件)
	try {
		const relPath = path.relative(path.dirname(destPath), srcPath);
		fs.symlinkSync(relPath, destPath, "junction");
		console.log(`已创建符号链接：${mapping.dest} -> ${mapping.src}`);
	} catch (error) {
		console.log(`符号链接失败，改为复制内容：${mapping.src} -> ${mapping.dest}`);
		copyRecursive(srcPath, destPath);
	}
}

// ─── 背景横幅同步（TinaCMS 媒体库 -> 站点静态资源）────────────────────
// 横幅由内容仓库 images/banners/<方向>/ 管理，这里按文件名排序重编号后复制到
// public/assets/ 与 src/assets/public/assets/ 两处（Astro 图片管线需要两处都有），
// 并写出 src/config/generated-banners.json 供 siteConfig 读取。
console.log("\n正在同步背景横幅...");
const generatedBanners = syncBanners(CONTENT_DIR);
console.log(
	`横幅同步完成：desktop ${generatedBanners.desktop.length} 张，mobile ${generatedBanners.mobile.length} 张`,
);

console.log("\n内容同步完成\n");
try {
	// 1. 获取 content 分支名
	const branch = execSync("git rev-parse --abbrev-ref HEAD", {
		cwd: CONTENT_DIR,
	})
		.toString()
		.trim();

	// 2. 获取 content commit hash（短）
	const hash = execSync("git rev-parse --short HEAD", {
		cwd: CONTENT_DIR,
	})
		.toString()
		.trim();

	// 3. 提交主仓库
	execSync("git add .", { cwd: rootDir });

	execSync(
		`git commit -m "chore(content): sync ${branch}@${hash}"`,
		{ cwd: rootDir },
	);

	console.log(`已提交内容更新（${branch}@${hash}）`);
} catch {
	console.log("没有变化，跳过提交");
}

// 递归复制函数
function copyRecursive(src, dest) {
	if (fs.statSync(src).isDirectory()) {
		if (!fs.existsSync(dest)) {
			fs.mkdirSync(dest, { recursive: true });
		}
		const files = fs.readdirSync(src);
		for (const file of files) {
			copyRecursive(path.join(src, file), path.join(dest, file));
		}
	} else {
		fs.copyFileSync(src, dest);
	}
}

// ─── 背景横幅同步 ───────────────────────────────────────────────

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
 * - 清理目标目录中不在本次编号集合里的旧图片文件（支持张数减少、扩展名变化）
 * - 源目录缺失或无图片时告警并跳过该方向（保留目标目录现状，避免误删导致背景消失）
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
