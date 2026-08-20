/**
 * 读取 TinaCMS 全局配置 JSON（由 sync-content 从内容仓库复制到
 * src/config/global/global.json）。
 *
 * 文件不存在或解析失败时返回空对象，调用方继续使用默认配置。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const globalConfigPath = fileURLToPath(
	new URL("./global/global.json", import.meta.url),
);

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
}

export function loadGlobalConfig(): GlobalConfig {
	try {
		if (!existsSync(globalConfigPath)) {
			return {};
		}
		return JSON.parse(readFileSync(globalConfigPath, "utf-8")) as GlobalConfig;
	} catch (error) {
		console.warn(
			`[globalConfig] 读取全局配置失败，使用默认配置：${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return {};
	}
}
