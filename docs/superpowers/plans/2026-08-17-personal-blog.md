# QikiiL 二次元个人博客实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `D:\blog` 基于 Mizuki 主题搭建 Astro 二次元博客，部署到 GitHub Pages 项目页 `https://qikiil.github.io/blog/`，含 Giscus 评论与友链页。

**Architecture:** 本地 `D:\blog` 为 git 仓库，保留 Mizuki 上游历史（`upstream` 远程）以便日后合并主题更新；日常推送到 `origin`（`QikiiL/blog`）。GitHub Actions（Mizuki 自带 `deploy.yml`）在 push 到 `main` 时构建并发布到 `pages` 分支，Pages 从该分支提供站点。子路径部署的关键是 `astro.config.mjs` 的 `base: "/blog/"`（主题内部通过 `import.meta.env.BASE_URL` 拼接所有链接与资源路径，已验证支持子路径）。

**Tech Stack:** Astro + Mizuki 主题（Svelte/Tailwind 内置）、pnpm 11.5.3（corepack 启用）、GitHub Pages + GitHub Actions、Giscus 评论、Pagefind 搜索（主题内置）。

**规格文档:** `docs/superpowers/specs/2026-08-17-personal-blog-design.md`

---

## 环境事实（已验证）

- 本机：Node v24.14.0、npm 11.15.0、git 2.54.0（Windows + Git Bash）、corepack 0.34.6、无 pnpm/gh CLI
- 本地代理：`127.0.0.1:7890`（系统代理，Git Bash 不自动继承，需显式指定；用户可能开关代理）
- git 身份：`QikiiL / 2671597670@qq.com`，SSH 密钥 `~/.ssh/id_ed25519` 已存在
- GitHub 账号 `QikiiL` 存在；仓库 `QikiiL/blog` **尚不存在**（需用户网页创建）
- Mizuki 上游：`https://github.com/LyraVoid/Mizuki`，**默认分支为 `master`**（已核实），已克隆到 `/tmp/mizuki-inspect` 供参考；本地仓库分支用 `main`（跟踪 `upstream/master`），deploy.yml 触发分支也是 `main`
- 关键源文件结构（已核实）：
  - 站点配置 `src/config/siteConfig.ts`（title/siteURL/lang/featurePages/navbarTitle/homeText）
  - 个人资料 `src/config/profileConfig.ts`（name/bio/links）
  - 导航 `src/config/navBarConfig.ts`（`links` 数组，`LinkPreset.Home/Archive/Friends` 等）
  - 评论 `src/config/commentConfig.ts`（enable/system/giscus.{repo,repoId,category,categoryId}）
  - 友链数据 `src/data/friends.ts`（`friendsData: FriendItem[]`）
  - 文章 `src/content/posts/`（frontmatter 必填 `title`、`published`）；关于页 `src/content/spec/about.md`（纯 Markdown 无 frontmatter）
  - 构建：`astro.config.mjs` 有 `base: "/"` **硬编码，必须改**
  - `.env.example` 提供模板；`ENABLE_CONTENT_SYNC=false` 为纯本地内容模式（本项目用）
  - 主题仓库根有 `CLAUDE.md` 行为准则（外科手术式修改、简单优先、密钥不入库），实施时遵守
- 主题自带测试/检查命令：`pnpm test`、`pnpm type-check`、`pnpm check`——配置改动后作为回归门槛

## 网络注意（贯穿所有任务）

git 走 HTTPS 访问 github.com 必须带代理 `-c http.proxy=http://127.0.0.1:7890`（或仓库级配置）；`origin` 用 SSH 不受影响。pnpm 安装依赖需 `export HTTPS_PROXY=http://127.0.0.1:7890`（不要改 registry 镜像，避免与 `pnpm-lock.yaml` 冲突）。若任何网络步骤失败，先提醒用户确认代理已开启再重试。

---

### Task 1: 引入 Mizuki 代码到 D:\blog（保留上游历史）

`D:\blog` 已有本计划与规格文档（未跟踪文件），Mizuki 也有自己的 `docs/` 目录但路径不冲突（`docs/superpowers/` vs `docs/image/` 等），checkout 不会覆盖未跟踪文件。

**Files:**
- Create: Mizuki 全部仓库文件（来自 upstream fetch）
- Keep: `docs/superpowers/`（本计划与规格）

- [ ] **Step 1: 初始化仓库并配置代理**

```bash
cd /d/blog
git init -b main
git config http.https://github.com/.proxy http://127.0.0.1:7890
```

说明：仓库级配置只对 `https://github.com` 的 HTTP(S) 请求走代理，不影响 SSH 的 `origin`；用户关代理时仅影响 `upstream` 获取。

- [ ] **Step 2: 添加 upstream 远程并拉取**

```bash
git remote add upstream https://github.com/LyraVoid/Mizuki.git
git fetch upstream master
```

预期：成功列出对象与引用；若超时超过 15 分钟，改用 `git fetch --depth=100 upstream master`（浅历史，日后 `git fetch --unshallow upstream` 补全），并在最终交付说明中记录。

- [ ] **Step 3: 检出上游代码到本地 main 分支**

```bash
git reset --hard FETCH_HEAD
git branch --set-upstream-to=upstream/master main
```

说明：上游默认分支是 `master`（已核实），本地分支名保持 `main`（deploy.yml 触发分支）。`git init -b main` 已存在空 main 分支，用 reset 指向上游内容；未跟踪的 `docs/superpowers/` 不受影响。

预期：工作区出现 `package.json`、`src/`、`astro.config.mjs` 等；`git log --oneline -3` 显示 Mizuki 提交（最新为 `9ccb273` Merge PR #555）；`git status` 中 `docs/superpowers/` 仍为未跟踪。

- [ ] **Step 4: 提交设计文档与计划**

```bash
git add docs/superpowers/
git commit -m "docs: add design spec and implementation plan"
```

- [ ] **Step 5: 验证**

```bash
ls package.json astro.config.mjs src/config/siteConfig.ts && git remote -v
```

预期：三个文件存在；remotes 显示 `upstream`（github.com/LyraVoid/Mizuki）。

---

### Task 2: 安装依赖（pnpm via corepack + 代理）

**Files:** 无源码修改；产出 `node_modules/`（gitignore 范围内）

- [ ] **Step 1: 启用 pnpm**

```bash
corepack enable
pnpm --version
```

预期：`11.5.3`（读 `package.json` 的 `packageManager` 字段）。若 corepack 启用失败（权限问题），回退 `npm install -g pnpm@11.5.3`。

- [ ] **Step 2: 带代理安装依赖**

```bash
cd /d/blog
export HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890
pnpm install --frozen-lockfile
```

预期：安装完成无 ERR；`preinstall: npx only-allow pnpm` 校验通过。若下载超时，重试一次并确认代理开启。

- [ ] **Step 3: 验证安装**

```bash
ls node_modules/.pnpm | head -3 && pnpm exec astro --version
```

预期：pnpm 存储目录非空；astro 版本号输出（4.x）。

---

### Task 3: 站点基础配置（base 路径 + 身份 + 导航 + .env）

**Files:**
- Modify: `astro.config.mjs`（base 一行）
- Modify: `src/config/siteConfig.ts`（title/siteURL/lang/featurePages/navbarTitle/homeText.title）
- Modify: `src/config/profileConfig.ts`（name/bio/links）
- Modify: `src/config/navBarConfig.ts`（links 数组精简）
- Create: `.env`（gitignore 内，不提交）

- [ ] **Step 1: astro.config.mjs 修改 base**

找到（`site: siteConfig.siteURL,` 下一行）：

```ts
	base: "/",
```

改为：

```ts
	base: "/blog/",
```

- [ ] **Step 2: siteConfig.ts 修改站点身份**

依次修改以下字段（其余保持不动）：

```ts
const SITE_LANG = "zh_CN"; // 语言代码，例如：'en', 'zh_CN', 'ja' 等。
```

```ts
	title: "QikiiL's Blog",
	subtitle: "编程感想与日常随笔",
	siteURL: "https://qikiil.github.io/blog/", // 请替换为你的站点URL，以斜杠结尾
	siteStartDate: "2026-08-17", // 站点开始运行日期，用于站点统计组件计算运行天数
```

featurePages 改为（友链保留，其余未用页面关闭）：

```ts
	featurePages: {
		anime: false, // 番剧页面开关
		diary: false, // 日记页面开关
		friends: true, // 友链页面开关
		projects: false, // 项目页面开关
		skills: false, // 技能页面开关
		timeline: false, // 时间线页面开关
		albums: false, // 相册页面开关
		devices: false, // 设备页面开关
		aiTools: false, // AI 工具页面开关
	},
```

navbarTitle 文本与首页横幅大标题：

```ts
		text: "QikiiL's Blog",
```

```ts
		homeText: {
			enable: true,
			title: "QikiiL's Blog",
```

（homeText 的日文副标题数组、打字机效果保留——属二次元风格元素。）

- [ ] **Step 2b: siteConfig.ts 其余占位字段**

`bangumi.userId` 与 `bilibili.vmid` 保持演示占位值不动（对应页面已关闭，`anime.mode` 保持 `"local"`）。

- [ ] **Step 3: profileConfig.ts 修改个人资料**

```ts
export const profileConfig: ProfileConfig = {
	avatar: "assets/images/avatar.webp", // 相对于 /src 目录。如果以 '/' 开头，则相对于 /public 目录
	name: "QikiiL",
	bio: "计算机学生 | 记录编程与日常",
	typewriter: {
		enable: true, // 启用个人简介打字机效果
		speed: 80, // 打字速度（毫秒）
	},
	links: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/QikiiL",
		},
	],
};
```

（avatar 沿用主题演示图，路径不变。）

- [ ] **Step 4: navBarConfig.ts 精简导航**

将 `links: [` 数组整体（从 `links: [` 到对应 `],`，含演示下拉菜单）替换为：

```ts
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.Friends,
	],
```

保留文件其余部分（注释块、`export const navBarConfig` 结构）不动。

- [ ] **Step 5: 创建 .env（不提交）**

```bash
cp .env.example .env
```

然后编辑 `.env`，最终内容只保留：

```ini
# Mizuki 博客环境变量
# 纯本地内容模式（不使用代码/内容分离）
ENABLE_CONTENT_SYNC=false
```

验证 `.gitignore` 已含 `.env`：

```bash
grep -n "^\.env$" .gitignore && git check-ignore .env
```

预期：两命令均有输出（被忽略）。

- [ ] **Step 6: 回归验证**

```bash
pnpm type-check && pnpm test
```

预期：tsc 无错误；主题测试全部通过。

- [ ] **Step 7: 提交**

```bash
git add astro.config.mjs src/config/
git commit -m "config: set site identity, zh_CN, subpath base /blog/, trim nav and feature pages"
```

---

### Task 3b: 子路径适配修复（代码质量审查发现的必要修复）

> 背景：Task 3 质量审查（实际运行 pnpm build）发现主题默认假设根路径部署，`base: "/blog/"` 暴露 4 个问题。规格"范围外：主题代码二次开发"指样式/功能定制；以下属部署必要性的 bug 修复，不违背规格意图。

**Files:**
- Modify: `scripts/check-global-style-loading.mjs`（Critical：构建链必挂）
- Modify: `src/components/organisms/navigation/Navbar.astro:21` 附近 isHomePage 判断与 `:316` pagefind URL
- Modify: `src/layouts/MainGridLayout.astro:67` isHomePage 判断
- Modify: `src/layouts/partials/GridScripts.astro:97-98` 客户端 isHomePage 判断
- Modify: `src/config/pioConfig.ts`（enable: false，符合规格"Live2D 暂不开启"意图）
- Modify: `.github/workflows/deploy.yml`（Build step 增加 `ENABLE_CONTENT_SYNC: false` env，消除 CI 警告的不确定性）

- [ ] **Step 1: 修复 check-global-style-loading.mjs**——资源路径解析前移除 base 前缀。参考 `scripts/read-site-config.mjs` 的模式读取 base（不要硬编码 "blog"），或在 `path.resolve(dist, p)` 前将 p 的 base 段剥掉。修复标准：`pnpm build` 完整跑通（含 pagefind 与字体检查）退出码 0。
- [ ] **Step 2: 修复 isHomePage 判断**——三处 `pathname === "/"` 改为与 `import.meta.env.BASE_URL` 比较（兼容带/不带尾斜杠）。服务端两处（Navbar.astro、MainGridLayout.astro）直接用 BASE_URL；客户端 GridScripts.astro 通过 `define:vars` 或 data 属性传入。修复标准：重新构建后 `dist/index.html` 的 `data-is-home="true"`。
- [ ] **Step 3: 修复 Pagefind 加载 URL**——`new URL('pagefind/pagefind.js', window.location.origin)` 需加 base 前缀（`<script is:inline>` 中 `import.meta.env` 不生效，用 `define:vars` 传 base）。修复标准：构建产物中该 URL 为 `/blog/pagefind/pagefind.js`。
- [ ] **Step 4: pioConfig.ts 设 `enable: false`**（审查发现主题默认是 true，与规格"Live2D 暂不开启"不符）。
- [ ] **Step 5: deploy.yml 的 Build site 步骤 env 增加 `ENABLE_CONTENT_SYNC: false`。**
- [ ] **Step 6: 回归**：`pnpm type-check && pnpm test && pnpm build` 全部通过；`grep -o 'data-is-home="[^"]*"' dist/index.html` 输出 true；grep pagefind.js URL 含 /blog/ 前缀。
- [ ] **Step 7: 提交** `fix: adapt theme to subpath base /blog/ (build check, homepage detection, pagefind, pio off)`。

### Task 4: 本地构建烟测（演示内容仍在时先验证配置）

**Files:** 无修改（验证性任务）

- [ ] **Step 1: 开发服务器验证（注意 base 路径）**

```bash
pnpm dev
```

后台运行后访问 `http://localhost:3000/blog/`（**不是** `/`，dev 服务器也挂载在 base 下）。

预期：首页正常渲染二次元/Material 3 样式，横幅轮播、导航为 首页/归档/友链 三项。验证后停止 dev（Ctrl+C 或 kill）。

- [ ] **Step 2: 生产构建验证**

```bash
export HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890
pnpm build
```

（构建含 `update-anime`、`astro build`、样式/字体检查、`pagefind` 索引，可能较慢；字体 provider 需联网。）

预期：`dist/` 生成；`pagefind` 索引输出无 error。

- [ ] **Step 3: 验证产物子路径**

```bash
grep -o 'href="/blog/[^"]*"' dist/index.html | head -5 && ls dist/assets/ | head -3
```

预期：内部链接均为 `/blog/...` 前缀；静态资源目录存在。

---

### Task 5: 内容替换（删演示、写文章、About、友链）

**Files:**
- Delete: `src/content/posts/` 下全部演示内容（`guide/` 目录及 `*.md`/`*.mdx`）
- Create: `src/content/posts/blog-setup-journey.md`
- Create: `src/content/posts/hello-daily.md`
- Modify: `src/content/spec/about.md`（整文件重写）
- Modify: `src/data/friends.ts`（`friendsData` 数组替换）
- Modify: `src/config/announcementConfig.ts`（质量审查发现：演示公告链接 `/about/` 在子路径下 404——重写为中文欢迎公告并保持链接 base 感知或禁用链接）

- [ ] **Step 1: 删除演示文章**

```bash
git rm -r src/content/posts/
mkdir -p src/content/posts
```

- [ ] **Step 2: 创建《博客搭建记》**

写入 `src/content/posts/blog-setup-journey.md`：

```markdown
---
title: 博客搭建记：从零部署 Astro + Mizuki 二次元博客
published: 2026-08-17
description: 记录我用自己的 Windows 电脑，基于 Astro 框架和 Mizuki 主题，把一个二次元风格的个人博客部署到 GitHub Pages 的全过程。
tags: [Astro, Mizuki, GitHub Pages]
category: 编程
draft: false
---

一直想要一个自己的博客：能写写代码学习中的感想，也能记记日常。市面上方案很多，我最终选了 **Astro + Mizuki 主题**，托管在 **GitHub Pages** 上——全免费，而且 Mizuki 是我喜欢的二次元/Material Design 3 风格。这篇文章记录搭建全过程，也当作博客的第一篇文章。

## 为什么选 Astro + Mizuki

- **Astro** 是内容驱动型网站的静态站点框架，默认零 JS 发往浏览器，构建产物是纯静态页面，非常适合博客，也天然适配 GitHub Pages。
- **Mizuki** 是基于 Astro 的开源博客主题（Apache-2.0），自带明暗主题、Pagefind 全文搜索、文章分类标签、目录、KaTeX/Mermaid、代码高亮等能力，开箱即用。

## 搭建步骤

### 1. 准备环境

需要 Node.js 和 pnpm。pnpm 通过 corepack 启用：

```bash
corepack enable
pnpm --version
```

### 2. 获取主题代码

我把 Mizuki 的完整 git 历史拉了下来，并把它的仓库地址保留为 `upstream` 远程——这样以后主题更新，可以直接 `git merge upstream/master` 合并，不用从头再来：

```bash
git init -b main
git remote add upstream https://github.com/LyraVoid/Mizuki.git
git fetch upstream master
git reset --hard FETCH_HEAD
```

### 3. 安装依赖并配置

```bash
pnpm install --frozen-lockfile
```

核心配置在 `src/config/` 目录：站点标题、URL、语言（`zh_CN`）、导航栏、个人资料都在这里改。

有一个**关键坑**：我把博客部署在项目仓库的子路径（`https://用户名.github.io/blog/`）下，而主题的 `astro.config.mjs` 里 `base` 默认是 `"/"`。不改的话所有样式和图片都会 404：

```ts
base: "/blog/",
```

### 4. 本地预览与构建

```bash
pnpm dev   # 注意：开启 base 后访问 http://localhost:3000/blog/
pnpm build # 产出 dist/，同时生成 Pagefind 搜索索引
```

### 5. 部署到 GitHub Pages

在 GitHub 创建公开仓库后推送，Mizuki 自带的 GitHub Actions 工作流（`.github/workflows/deploy.yml`）会在每次 push 到 `main` 时自动构建，并把 `dist/` 发布到 `pages` 分支。然后在仓库设置的 Pages 里选择从 `pages` 分支部署即可。

### 6. 开启 Giscus 评论

Giscus 基于 GitHub Discussions，免费且无需自己跑服务器：仓库开启 Discussions、安装 giscus App，再到 [giscus.app](https://giscus.app/zh-CN) 拿到 `repoId` 和 `categoryId` 填进 `src/config/commentConfig.ts` 就完成了。

## 写在最后

整个过程半天搞定，最大的收获是搞清楚了静态站点"构建→部署"的链路。接下来打算把学习笔记和日常都写进来。如果你也想搭一个，推荐从 [Mizuki 文档](https://docs.mizuki.mysqil.com/) 开始。
```

- [ ] **Step 3: 创建日常随笔**

写入 `src/content/posts/hello-daily.md`：

```markdown
---
title: 你好，世界：博客的第一篇日常
published: 2026-08-17
description: 博客开张，写点碎碎念。
tags: [日常]
category: 日常
draft: false
---

博客终于搭起来了！以后编程的收获写进「编程」分类，生活里的碎碎念就放在「日常」这里。

先立几个小目标：

- 每月至少更新两篇文章
- 把课程里觉得有意思的实验和坑都记下来
- 交几个友链

那么，开始吧。
```

- [ ] **Step 4: 重写 About 页**

将 `src/content/spec/about.md` 整文件替换为：

```markdown
## 你好，我是 QikiiL 👋

一名计算机专业的学生。

这个博客用来记录我的编程感想、代码笔记，还有一些日常琐事。如果你在找本站的搭建方式，可以看[《博客搭建记》](/posts/blog-setup-journey/)——它基于 [Astro](https://astro.build) 和 [Mizuki](https://github.com/LyraVoid/Mizuki) 主题搭建，托管在 GitHub Pages 上。

- 📌 写作方向：编程技术、课程笔记、日常随笔
- 💬 评论：文章下方可以直接留言（Giscus，用 GitHub 账号登录）
- 🔗 找到我：[GitHub](https://github.com/QikiiL)

欢迎常来！
```

- [ ] **Step 5: 替换友链数据**

将 `src/data/friends.ts` 中 `friendsData` 数组（保留 `FriendItem` 接口定义）替换为：

```ts
// 友情链接数据（起步示例：换成你朋友们的站点即可）
export const friendsData: FriendItem[] = [
	{
		id: 1,
		title: "Mizuki Docs",
		imgurl: "https://github.com/LyraVoid.png",
		desc: "本站所用主题的官方文档",
		siteurl: "https://docs.mizuki.mysqil.com",
		tags: ["Docs"],
	},
	{
		id: 2,
		title: "Astro",
		imgurl: "https://avatars.githubusercontent.com/u/44914786?v=4&s=640",
		desc: "The web framework for content-driven websites",
		siteurl: "https://astro.build",
		tags: ["Framework"],
	},
];
```

- [ ] **Step 6: 构建 + 测试回归**

```bash
export HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890
pnpm type-check && pnpm build
ls dist/posts/
```

预期：类型检查通过；构建成功；`dist/posts/` 下有 `blog-setup-journey` 与 `hello-daily`（目录或 html）。

- [ ] **Step 7: 提交**

```bash
git add src/content/ src/data/friends.ts
git commit -m "content: replace demo posts with first two articles, rewrite about and friends"
```

---

### Task 6: 创建 GitHub 仓库并推送（需要用户操作一步）

**Files:** 无源码修改（git 远程与推送）

- [ ] **Step 1: 用户在网页创建仓库（用户操作）**

请用户打开 https://github.com/new ，填写：

- Repository name: `blog`
- 可见性：**Public**（免费账户私有仓库不能用 Pages，Giscus 也要求公开）
- **不要**勾选 "Add a README"、.gitignore、license（保持空仓库）

点击 "Create repository"。

- [ ] **Step 2: 验证 SSH 连通**

```bash
ssh -T git@github.com
```

预期：`Hi QikiiL! You've successfully authenticated...`（exit code 1 属正常）。若 22 端口超时，在 `~/.ssh/config` 追加后重试：

```
Host github.com
  HostName ssh.github.com
  Port 443
  User git
```

- [ ] **Step 3: 添加 origin 并推送**

```bash
git remote add origin git@github.com:QikiiL/blog.git
git push -u origin main
```

- [ ] **Step 4: 验证**

```bash
git ls-remote origin main
curl -s --max-time 15 -x http://127.0.0.1:7890 -o /dev/null -w "%{http_code}\n" https://github.com/QikiiL/blog
```

预期：ls-remote 输出远端 main 哈希；仓库页面 HTTP 200。

---

### Task 7: 启用 GitHub Pages 并线上验证

**Files:** 无源码修改（仓库设置 + 验证）

- [ ] **Step 1: 等待首次 Actions 构建完成**

push 后 `deploy.yml` 自动运行（仓库 Actions 标签页查看，构建约 3-6 分钟）。确认绿勾且 `pages` 分支已生成：

```bash
git ls-remote --heads origin | grep pages
```

预期：输出 `refs/heads/pages`。若失败：读 Actions 日志，常见原因与处置——依赖安装失败（重跑一次）、`pnpm install --no-frozen-lockfile` 已在工作流中使用无需改。

- [ ] **Step 2: 用户设置 Pages（用户操作）**

仓库 **Settings → Pages**：
- Source: **Deploy from a branch**
- Branch: `pages`，文件夹 `/ (root)`
- Save

- [ ] **Step 3: 线上验证（构建生效需等 1-3 分钟）**

```bash
curl -s --max-time 15 -x http://127.0.0.1:7890 -o /dev/null -w "%{http_code}\n" https://qikiil.github.io/blog/
```

预期：`200`。随后浏览器打开 `https://qikiil.github.io/blog/` 核对：首页二次元样式与横幅轮播正常、文章列表显示两篇文章、归档页分类为「编程/日常」、友链页显示两条示例友链、搜索框可搜到文章、站点语言为中文。

- [ ] **Step 4: 修复回路**

若页面空白/样式 404：核对 `astro.config.mjs` 的 `base` 与浏览器地址栏路径；用 DevTools Network 面板确认资源 URL 前缀。改配置 → commit → push → 等 Actions → 复验。

---

### Task 8: 启用 Giscus 评论

**Files:**
- Modify: `src/config/commentConfig.ts`

- [ ] **Step 1: 用户开启 Discussions（用户操作）**

仓库 **Settings → General → Features** 勾选 **Discussions**。

- [ ] **Step 2: 用户安装 giscus App（用户操作）**

打开 https://github.com/apps/giscus → Install → 只授权 `QikiiL/blog`。

- [ ] **Step 3: 获取 giscus 参数（用户操作或代理下浏览器完成）**

打开 https://giscus.app/zh-CN ：
- 仓库名填 `QikiiL/blog`（页面应显示绿色 "仓库符合要求"）
- 映射方式：pathname；分类：Announcements
- 记下页面生成的 `data-repo-id`（repoId）与 `data-category-id`（categoryId）

- [ ] **Step 4: 填入评论配置**

`src/config/commentConfig.ts` 修改（repoId/categoryId 用 Step 3 实际值替换 `<...>` 占位）：

```ts
export const commentConfig: CommentConfig = {
	enable: true, // 启用评论功能。当设置为 false 时，评论组件将不会显示在文章区域。
	system: "giscus", // 评论系统选择: "twikoo" | "giscus"
	twikoo: {
		envId: "https://twikoo.vercel.app",
		lang: SITE_LANG,
	},
	giscus: {
		repo: "QikiiL/blog",
		repoId: "<Step3 获取的 data-repo-id>",
		category: "Announcements",
		categoryId: "<Step3 获取的 data-category-id>",
		mapping: "pathname",
		strict: "0",
		reactionsEnabled: "1",
		emitMetadata: "0",
		inputPosition: "top",
		theme: "preferred_color_scheme",
		lang: SITE_LANG,
		loading: "lazy",
	},
};
```

- [ ] **Step 5: 提交推送**

```bash
git add src/config/commentConfig.ts
git commit -m "config: enable giscus comments"
git push
```

- [ ] **Step 6: 线上验证**

等 Actions 完成后，浏览器打开任一文章页（如 `https://qikiil.github.io/blog/posts/hello-daily/`），页面底部出现 giscus 评论框；用 GitHub 账号发一条测试评论，仓库 Discussions 出现对应讨论帖。

---

### Task 9: 收尾与交付说明

**Files:** 无新修改（验证 + 总结）

- [ ] **Step 1: 最终全面回归**

```bash
pnpm type-check && pnpm test
```

预期：全部通过。

- [ ] **Step 2: 向用户交付总结**

必须包含：
- 线上地址 `https://qikiil.github.io/blog/`
- 写作流程：`pnpm new-post -- 文件名` → 编辑 `src/content/posts/<文件名>.md` → `git add/commit/push`，Actions 自动发布
- 换头像：替换 `src/assets/images/avatar.webp`（profileConfig 引用的路径）
- 换横幅：`public/assets/desktop-banner/`、`public/assets/mobile-banner/` 下的 webp
- 主题更新：`git fetch upstream && git merge upstream/master`（需开代理）
- 代理提示：git 对 github.com 的 HTTPS 操作走 `127.0.0.1:7890`（仓库级配置已设）；SSH 推送不受影响
- 若 Task 1 用了浅 fetch：注明日后 `git fetch --unshallow upstream` 补全历史

---

## 自审记录（写完计划后已核对）

1. **规格覆盖**：架构（Task 1/6/7）、站点配置（Task 3）、内容结构（Task 5）、部署与错误处理（Task 6/7/8 的用户步骤与修复回路）、验证方式（Task 4/7/8/9）——规格各节均有对应任务。范围外项（自定义域名、Twikoo、Live2D 等）未纳入，符合规格。
2. **占位符扫描**：唯一保留的 `<...>` 是 Task 8 的 repoId/categoryId——这两个值只能由用户在 giscus.app 实时生成，属外部输入而非计划缺失，步骤已写明获取方式。
3. **一致性**：`base: "/blog/"` 与 siteURL、dev 访问路径 `localhost:3000/blog/`、线上验证 URL、deploy.yml 的 pages 分支模式全文一致；`LinkPreset.Friends` 与 `featurePages.friends: true` 对应；友链数据结构 `FriendItem` 字段与上游定义一致。
