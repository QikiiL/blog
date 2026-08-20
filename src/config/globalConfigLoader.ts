/**
 * 读取 TinaCMS 全局配置 JSON（由 sync-content 从内容仓库复制到
 * src/config/global/global.json）。
 *
 * 使用 Vite 的 import.meta.glob 内联 JSON，避免把 node:fs 打进客户端 bundle。
 * 文件不存在时 glob 为空对象，调用方继续使用默认配置。
 */

export interface GlobalConfig {
	announcement?: {
		title?: string;
		content?: string;
		icon?: string;
		type?: "info" | "warning" | "success" | "error";
		closable?: boolean;
		link?: {
			enable?: boolean;
			text?: string;
			url?: string;
			external?: boolean;
		};
	};
	site?: {
		title?: string;
		subtitle?: string;
		siteURL?: string;
		siteStartDate?: string;
		timeZone?: string;
	};
	profile?: {
		name?: string;
		bio?: string;
		avatar?: string;
	};
}

const globalModules = import.meta.glob<{ default?: unknown }>(
	"./global/*.json",
	{ eager: true },
);

export function loadGlobalConfig(): GlobalConfig {
	const module = globalModules["./global/global.json"];
	if (!module?.default) {
		return {};
	}
	return module.default as GlobalConfig;
}
