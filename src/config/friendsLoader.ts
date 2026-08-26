/**
 * 读取 TinaCMS 管理的友链数据 JSON（由 sync-content 从内容仓库复制到
 * src/config/friends/friends.json）。
 *
 * 使用 Vite 的 import.meta.glob 内联 JSON。文件不存在时回退到
 * src/data/friends.ts 的默认数据。
 */

import { friendsData as defaultFriendsData } from "../data/friends";

export interface FriendItem {
	id: number;
	title: string;
	imgurl: string;
	desc: string;
	siteurl: string;
	tags: string[];
}

interface CmsFriendsFile {
	friends?: FriendItem[];
}

const friendModules = import.meta.glob<{ default?: unknown }>(
	"./friends/*.json",
	{ eager: true },
);

export function getFriendsList(): FriendItem[] {
	const module = friendModules["./friends/friends.json"];
	const cms = (module?.default as CmsFriendsFile | undefined)?.friends;

	if (Array.isArray(cms) && cms.length > 0) {
		return cms;
	}

	return defaultFriendsData;
}

export function getShuffledFriendsList(): FriendItem[] {
	const friends = [...getFriendsList()];
	for (let i = friends.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[friends[i], friends[j]] = [friends[j], friends[i]];
	}
	return friends;
}