import type { FullscreenWallpaperConfig } from "../types/config";
import { siteConfig } from "./siteConfig";

// 全屏壁纸默认复用顶部横幅的图片，只需维护 siteConfig.banner.src 一处即可。
export const fullscreenWallpaperConfig: FullscreenWallpaperConfig = {
	enable: true,
	src: siteConfig.banner.src,
	position: "center",
	carousel: {
		enable: true,
		interval: 5,
	},
	zIndex: -1,
	opacity: 0.8,
	blur: 1,
	switchable: true,
	overlay: {
		opacity: 0.8, // 壁纸不透明度，0-1
		blur: 1.5, // 背景模糊半径（px）
		cardOpacity: 0.8, // 卡片不透明度，0-1
		switchable: {
			opacity: true,
			blur: true,
			cardOpacity: true,
		},
	},
	fullscreen: {
		switchable: {
			opacity: true,
			blur: true,
		},
	},
};
