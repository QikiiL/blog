import type { AnnouncementConfig } from "../types/config";

// 公告栏配置
export const announcementConfig: AnnouncementConfig = {
	title: "", // 公告标题，填空使用i18n字符串Key.announcement
	content: "欢迎来到 QikiiL 的小站！这里记录编程与日常。", // 公告内容
	closable: true, // 允许用户关闭公告
	link: {
		enable: false, // 禁用链接（base 为子路径，避免跳转 404）
		text: "Learn More", // 链接文本
		url: "/about/", // 链接 URL
		external: false, // 内部链接
	},
};
