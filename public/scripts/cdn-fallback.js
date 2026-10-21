/*
 * cdn-fallback.js
 *
 * 图片 CDN 兜底：线上静态资源走 https://cdn.jsdmirror.com/gh/QikiiL/blog@pages/<path>
 * （见 scripts/prefix-public-images.mjs）。jsdmirror 对冷缓存文件会透传 jsDelivr 的
 * `503 No healthy backend`，此时把该前缀换回站点自身源 https://qikiil.me/ 重试一次。
 *
 * 约定：
 *  - 只处理 <img>，只重试一次（dataset.cdnFallback 标记）
 *  - 同时处理 src 与 srcset（多 URL 时逐个替换前缀）
 *  - 纯浏览器 JS，无依赖，ES5 写法兼容旧浏览器
 */
(function () {
	"use strict";

	var CDN_PREFIX = "https://cdn.jsdmirror.com/gh/QikiiL/blog@pages/";
	var ORIGIN_PREFIX = "https://qikiil.me/";
	var FLAG_ATTR = "data-cdn-fallback";

	// 把值里出现的所有 CDN 前缀替换为站点源；没有命中返回 null
	function replacePrefix(value) {
		if (!value || value.indexOf(CDN_PREFIX) === -1) return null;
		return value.split(CDN_PREFIX).join(ORIGIN_PREFIX);
	}

	function alreadyRetried(img) {
		if (img.dataset) return img.dataset.cdnFallback === "1";
		return img.getAttribute(FLAG_ATTR) === "1";
	}

	function markRetried(img) {
		if (img.dataset) {
			img.dataset.cdnFallback = "1";
		} else {
			img.setAttribute(FLAG_ATTR, "1");
		}
	}

	function handleError(event) {
		var img = event && event.target;
		if (!img || img.tagName !== "IMG") return;
		if (alreadyRetried(img)) return;

		var rawSrc = img.getAttribute("src") || "";
		var rawSrcset = img.getAttribute("srcset") || "";
		var nextSrc = replacePrefix(rawSrc);
		var nextSrcset = replacePrefix(rawSrcset);

		// 与 CDN 前缀无关的加载失败（例如站点源本身就 404）不处理
		if (nextSrc === null && nextSrcset === null) return;

		markRetried(img);

		if (nextSrcset !== null) {
			img.setAttribute("srcset", nextSrcset);
		}
		if (nextSrc !== null) {
			img.setAttribute("src", nextSrc);
		} else if (nextSrcset !== null) {
			// src 没变、只有 srcset 变了：强制浏览器重新解析图片资源
			var currentSrc = img.getAttribute("src");
			if (currentSrc) img.setAttribute("src", currentSrc);
		}
	}

	// error 事件不冒泡，必须用 capture 在 document 上捕获
	document.addEventListener("error", handleError, true);
})();
