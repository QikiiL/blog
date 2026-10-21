#!/usr/bin/env node
/**
 * prewarm-cdn.mjs
 * 部署后预热 jsdmirror（jsDelivr 国内镜像）缓存。
 *
 * 背景：站点静态资源由 scripts/prefix-public-images.mjs 改写为
 * https://cdn.jsdmirror.com/gh/QikiiL/blog@pages/<path>。
 * jsdmirror 对**冷缓存**文件会透传 jsDelivr 的 `503 No healthy backend`，
 * 已缓存的 URL 则稳定返回 200；`@pages` 分支的缓存只有 12 小时，
 * 因此每次部署后都需要重新回源预热一遍。
 *
 * 行为：
 *  - 枚举 dist/ 下所有图片/字体资源（按扩展名白名单）
 *  - dist/index.html 中引用到的资源优先预热，其余随后
 *  - 并发 8，每个 URL 最多重试 5 次（0.5s/1s/2s/4s/8s + 随机抖动），单请求 30s 超时
 *  - 成功判定：HTTP 200 且 body 非空且不含 "No healthy backend"；503 视为可重试失败
 *  - 失败率 > 5% 打印警告，但**不**让流程失败（始终 exit 0，除非脚本自身异常）
 *
 * 用法：
 *   node scripts/prewarm-cdn.mjs
 *   node scripts/prewarm-cdn.mjs --dry-run
 *   node scripts/prewarm-cdn.mjs --limit 5
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(projectRoot, "dist");

// 与 prefix-public-images.mjs 保持同一套 CDN 前缀
const CDN_BASE = "https://cdn.jsdmirror.com/gh/QikiiL/blog@pages";
const ASSET_EXTENSIONS = new Set([
	".webp",
	".png",
	".jpg",
	".jpeg",
	".avif",
	".gif",
	".svg",
	".woff",
	".woff2",
	".ttf",
	".otf",
]);

const CONCURRENCY = 8;
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const REQUEST_TIMEOUT_MS = 30_000;
const FAILURE_RATE_WARN = 0.05;
const PREVIEW_COUNT = 10;

const HELP = `用法: node scripts/prewarm-cdn.mjs [--dry-run] [--limit N]
  --dry-run   只打印将预热的 URL 数量和前 ${PREVIEW_COUNT} 个，不发请求
  --limit N   仅预热排序后的前 N 个资源（便于测试）`;

// ---------------------------------------------------------------- CLI

function parseLimit(value) {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseArgs(argv) {
	const options = { dryRun: false, limit: 0, help: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--dry-run") {
			options.dryRun = true;
		} else if (arg === "--limit") {
			options.limit = parseLimit(argv[i + 1]);
			i += 1;
		} else if (arg.startsWith("--limit=")) {
			options.limit = parseLimit(arg.slice("--limit=".length));
		} else if (arg === "--help" || arg === "-h") {
			options.help = true;
		} else {
			console.warn(`[prewarm] 忽略未知参数: ${arg}`);
		}
	}
	return options;
}

// ------------------------------------------------------------- helpers

function sleep(ms) {
	return new Promise((resolvePromise) => {
		setTimeout(resolvePromise, ms);
	});
}

function toPosix(relativePath) {
	return relativePath.split(sep).join("/");
}

function decodeSafely(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function buildCdnUrl(relPath) {
	// 逐段编码：保留 `/` 分隔符，编码空格、中文、`#`、`?` 等特殊字符
	const encoded = relPath
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `${CDN_BASE}/${encoded}`;
}

// -------------------------------------------------------- asset 收集

async function collectAssetFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectAssetFiles(fullPath)));
		} else if (
			entry.isFile() &&
			ASSET_EXTENSIONS.has(extname(entry.name).toLowerCase())
		) {
			files.push(fullPath);
		}
	}
	return files;
}

// index.html 里可能已经是 CDN 绝对地址（prefix 脚本已改写），也可能是站内相对路径
const EXT_PATTERN = "webp|png|jpg|jpeg|avif|gif|svg|woff2|woff|ttf|otf";
const REFERENCE_RE = new RegExp(
	`(?:https://cdn\\.jsdmirror\\.com/gh/QikiiL/blog@pages)?/?([^\\s"'\`()<>,]+\\.(?:${EXT_PATTERN}))`,
	"gi",
);

async function readPriorityPaths() {
	const indexPath = join(distDir, "index.html");
	let html;
	try {
		html = await readFile(indexPath, "utf8");
	} catch {
		console.warn("[prewarm] 未找到 dist/index.html，跳过优先级排序");
		return new Set();
	}
	const paths = new Set();
	for (const match of html.matchAll(REFERENCE_RE)) {
		const candidate = decodeSafely(match[1] ?? "").replace(/^\/+/, "");
		if (candidate) paths.add(candidate);
	}
	return paths;
}

function buildAssetList(files, priorityPaths) {
	const assets = files.map((fullPath) => {
		const relPath = toPosix(relative(distDir, fullPath));
		return { fullPath, relPath, url: buildCdnUrl(relPath) };
	});
	const priority = [];
	const rest = [];
	for (const asset of assets) {
		(priorityPaths.has(asset.relPath) ? priority : rest).push(asset);
	}
	// 同优先级内按路径排序，保证多次运行顺序稳定、便于 diff
	const byPath = (a, b) => a.relPath.localeCompare(b.relPath);
	priority.sort(byPath);
	rest.sort(byPath);
	return { ordered: [...priority, ...rest], priorityCount: priority.length };
}

// ------------------------------------------------------------- 预热

class RetryableError extends Error {
	constructor(message, retryable = true) {
		super(message);
		this.name = "RetryableError";
		this.retryable = retryable;
	}
}

async function fetchOnce(url) {
	let response;
	try {
		response = await fetch(url, {
			redirect: "follow",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: {
				"user-agent": "qikiil-prewarm/1.0 (+https://qikiil.me)",
				accept: "*/*",
			},
		});
	} catch (error) {
		const detail =
			error?.name === "TimeoutError"
				? `timeout after ${REQUEST_TIMEOUT_MS}ms`
				: (error?.cause?.code ?? error?.message ?? String(error));
		throw new RetryableError(`network: ${detail}`, true);
	}

	let body = "";
	try {
		body = await response.text();
	} catch (error) {
		throw new RetryableError(
			`body read failed: ${error?.message ?? String(error)}`,
			true,
		);
	}

	if (response.status !== 200) {
		const retryable =
			response.status === 503 ||
			response.status === 429 ||
			response.status >= 500;
		throw new RetryableError(`HTTP ${response.status}`, retryable);
	}
	if (body.length === 0) {
		throw new RetryableError("empty body", true);
	}
	if (body.includes("No healthy backend")) {
		throw new RetryableError('body contains "No healthy backend"', true);
	}
	return { status: response.status, bytes: body.length };
}

async function warmAsset(asset) {
	let retries = 0;
	let lastReason = "unknown";

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
		if (attempt > 0) {
			const base =
				RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
			const jitter = Math.random() * base * 0.3;
			await sleep(base + jitter);
			retries += 1;
		}
		try {
			const result = await fetchOnce(asset.url);
			return { asset, ok: true, retries, ...result };
		} catch (error) {
			lastReason =
				error instanceof RetryableError
					? error.message
					: (error?.message ?? String(error));
			if (error instanceof RetryableError && !error.retryable) break;
		}
	}

	return { asset, ok: false, retries, reason: lastReason };
}

async function runPool(items, worker, concurrency) {
	const results = new Array(items.length);
	let cursor = 0;
	const runners = [];
	const runnerCount = Math.max(1, Math.min(concurrency, items.length));
	for (let i = 0; i < runnerCount; i += 1) {
		runners.push(
			(async () => {
				while (true) {
					const index = cursor;
					cursor += 1;
					if (index >= items.length) return;
					results[index] = await worker(items[index], index);
				}
			})(),
		);
	}
	await Promise.all(runners);
	return results;
}

// -------------------------------------------------------------- main

const options = parseArgs(process.argv.slice(2));

if (options.help) {
	console.log(HELP);
	process.exit(0);
}

const startedAt = Date.now();

let distStats;
try {
	distStats = await stat(distDir);
} catch {
	console.error(`[prewarm] 未找到构建产物目录: ${distDir}，请先执行 pnpm build`);
	process.exit(1);
}
if (!distStats.isDirectory()) {
	console.error(`[prewarm] 构建产物路径不是目录: ${distDir}`);
	process.exit(1);
}

const files = await collectAssetFiles(distDir);
const priorityPaths = await readPriorityPaths();
const { ordered, priorityCount } = buildAssetList(files, priorityPaths);

const targets = options.limit > 0 ? ordered.slice(0, options.limit) : ordered;

console.log(
	`[prewarm] dist 资源总数: ${ordered.length}（其中 index.html 引用 ${priorityCount} 个优先预热）`,
);

if (options.dryRun) {
	console.log(
		`[prewarm] --dry-run: 将预热 ${targets.length} 个 URL（未发起任何请求）`,
	);
	targets.slice(0, PREVIEW_COUNT).forEach((asset, index) => {
		console.log(`  ${index + 1}. ${asset.url}`);
	});
	if (targets.length > PREVIEW_COUNT) {
		console.log(`  ... 其余 ${targets.length - PREVIEW_COUNT} 个省略`);
	}
	process.exit(0);
}

if (targets.length === 0) {
	console.log("[prewarm] 没有需要预热的资源，跳过");
	process.exit(0);
}

console.log(
	`[prewarm] 开始预热 ${targets.length} 个 URL（并发 ${CONCURRENCY}，每个最多重试 ${MAX_RETRIES} 次，超时 ${REQUEST_TIMEOUT_MS / 1000}s）`,
);

let finished = 0;
const results = await runPool(
	targets,
	async (asset) => {
		const result = await warmAsset(asset);
		finished += 1;
		const tag = result.ok ? "ok " : "ERR";
		const detail = result.ok
			? `HTTP ${result.status} ${result.bytes}B`
			: result.reason;
		const retryNote = result.retries > 0 ? ` [retries: ${result.retries}]` : "";
		console.log(
			`[${String(finished).padStart(4)}/${targets.length}] ${tag} ${asset.relPath}${retryNote} — ${detail}`,
		);
		return result;
	},
	CONCURRENCY,
);

const succeeded = results.filter((result) => result.ok);
const failed = results.filter((result) => !result.ok);
const totalRetries = results.reduce((sum, result) => sum + result.retries, 0);
const elapsedMs = Date.now() - startedAt;

console.log("");
console.log("[prewarm] 预热完成");
console.log(`  总数: ${targets.length}`);
console.log(`  成功: ${succeeded.length}`);
console.log(`  失败: ${failed.length}`);
console.log(`  重试次数: ${totalRetries}`);
console.log(`  耗时: ${(elapsedMs / 1000).toFixed(1)}s`);

if (failed.length > 0) {
	console.log("  失败列表:");
	for (const item of failed) {
		console.log(`    - ${item.asset.url} → ${item.reason}`);
	}
	const failureRate = failed.length / targets.length;
	if (failureRate > FAILURE_RATE_WARN) {
		console.warn(
			`[prewarm] 警告: 失败率 ${(failureRate * 100).toFixed(1)}% 超过 ${FAILURE_RATE_WARN * 100}%，请检查 jsdmirror 状态`,
		);
	}
}

// 预热失败不阻塞部署：始终 exit 0（脚本自身异常会抛出 → 非 0）
// 兜底：避免 keep-alive socket 让进程挂住
setTimeout(() => process.exit(0), 5000).unref();
process.exitCode = 0;
