# 设计文档：QikiiL 的二次元个人博客

日期：2026-08-17
状态：已获用户批准（交互式设计对话后通过）

## 背景与目标

用户（QikiiL，计算机专业学生）想要一个个人博客，用于发布：

- 编程感想与代码相关内容
- 日常随笔

要求二次元风格，选定 Astro 框架 + [Mizuki](https://github.com/LyraVoid/Mizuki) 主题（基于 Fuwari 衍生、Apache-2.0 许可的 Material Design 3 风格静态博客模板），部署在 GitHub Pages。

**成功标准**：push 到 main 后 GitHub Actions 自动构建发布；线上 `https://qikiil.github.io/blog/` 可正常访问，文章、友链、评论挂载点工作正常；本地 `pnpm dev` 可正常预览写作。

## 决策记录（用户确认）

| 决策点 | 结论 |
| --- | --- |
| 部署形式 | 项目仓库（非 username.github.io 主仓库），子路径部署 |
| 仓库 | `QikiiL/blog`（新建，Public，当前不存在） |
| siteURL | `https://qikiil.github.io/blog/` |
| 评论系统 | Giscus（基于 GitHub Discussions） |
| 站点标题 | QikiiL's Blog |
| 作者展示名 | QikiiL |
| 语言 | zh_CN |
| 特色功能 | 启用友链页；Live2D 看板娘、追番页暂不开启（保持默认关闭，后续可开） |
| 搭建方式 | 方案 A：本地克隆 Mizuki 保留上游历史，便于日后合并主题更新 |
| 初始内容 | 清除演示文章；写 1 篇编程类《博客搭建记》+ 1 篇日常随笔；About 页写 CS 学生简介 |

## 1. 总体架构

- **技术栈**：Astro（Mizuki 主题）+ pnpm（corepack 启用；本机 Node v24.14.0、npm 11.15.0、git 2.54.0 已具备，无 pnpm/gh CLI）
- **本地仓库**：`D:\blog` 即 git 仓库，双远程：
  - `origin` → `git@github.com:QikiiL/blog.git`（日常推送；用户已有 SSH 密钥 id_ed25519）
  - `upstream` → `https://github.com/LyraVoid/Mizuki.git`（只读，拉取主题更新用）
- **部署**：GitHub Actions——push 到 `main` 自动安装依赖、构建（含 Pagefind 搜索索引生成）、发布到 GitHub Pages
- **线上地址**：`https://qikiil.github.io/blog/`

克隆方式：因 `D:\blog` 已含本设计文档，使用 `git init` + `remote add` + `fetch` + `checkout` 方式引入 Mizuki 历史（而非 `git clone`，后者要求空目录）。

## 2. 站点配置（`src/config/`）

- `siteURL = https://qikiil.github.io/blog/`——最关键配置，决定资源子路径与 RSS/OG 链接
- 站点标题 "QikiiL's Blog"；作者 QikiiL；`lang = zh_CN`
- 评论：Giscus，仓库上线后三步回填（见第 4 节），本地先保留默认关闭
- 友链页：启用（数据文件维护友链列表，起步为空 + 格式示例）
- 头像/横幅：先沿用主题演示图，用户后续自行替换（文档中注明替换路径）

## 3. 内容结构

- 文章目录：`src/content/posts/`（.md/.mdx，frontmatter 必填 `title`、`published`；`pnpm new-post -- <文件名>` 可脚手架新文）
- 起步内容：
  - 《博客搭建记》（编程类）：记录本次从零搭建、配置、部署全过程
  - 一篇日常随笔（简短占位）
- 分类起步为「编程」「日常」两类；Mizuki 由文章 frontmatter 的 tags/categories 自动组织，无需预先建目录
- About 页（`src/content/spec/`）：计算机学生简介
- 不启用代码/内容分离（`ENABLE_CONTENT_SYNC=false`，纯本地内容，简单优先）

## 4. 部署流程与错误处理

1. 用户在 GitHub 网页创建空仓库 `QikiiL/blog`——**必须 Public**（GitHub 免费版私有仓库不能用 Pages；Giscus 也要求公开仓库）
2. 仓库 Settings → 开启 Discussions（Giscus 依赖）
3. 安装 giscus GitHub App 并授权该仓库（giscus.app）
4. Pages 设置中部署源选 "GitHub Actions"
5. 推送 main 后 Actions 自动构建；从 giscus.app 获取配置参数回填 `src/config/` 评论配置后推送生效
6. 已知风险与处置：
   - **siteURL 与实际路径不一致** → 资源 404、样式丢失：本地 build 后核对产物路径带 `/blog/` 前缀再推送
   - **Actions 失败** → 查看 Actions 日志定位；常见为 pnpm 版本与 `packageManager` 声明不符（用 corepack/`packageManager` 字段锁定）
   - **SSH 推送被拒** → 确认 `ssh -T git@github.com` 通畅、仓库确已创建
   - **Giscus 不显示** → 核对 Discussions 已开、App 已装、repo 参数大小写正确

## 5. 验证方式

配置类项目，无单元测试，验证以实际构建与浏览为准：

- 本地：`pnpm install`、`pnpm dev`（http://localhost:3000）、`pnpm build` 全部无错；`dist/` 产物内部链接带 `/blog/` 前缀
- 线上：Actions 运行绿勾；浏览器打开 `https://qikiil.github.io/blog/`——首页样式（二次元/Material 3）正常、两篇文章可见、友链页可访问、文章页评论挂载点存在、搜索可用（Pagefind）
- 最终用浏览器截图人工核对视觉效果

## 范围外（明确不做）

- 自定义域名（后续可加）
- Twikoo/其他评论系统
- Live2D、追番页、相册、音乐播放器等其余特色页（配置保持关闭）
- 主题代码二次开发/样式定制（仅做配置级个性化）
