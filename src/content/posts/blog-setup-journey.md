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
