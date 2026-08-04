# 个人学习笔记网站 — 设计与实施规范

> 文档版本：2.0  
> 最后修订：2026-08-04  
> 状态：第一版开发中

本文档用于指导 code agent 搭建并长期维护个人学习网站。除文中明确标记为“后续可选”的能力外，第一版实现必须遵循本规范，不得自行替换框架、部署方式、内容模型或引入后端服务。

## 1. 项目目标

建设一个可从研究生阶段持续使用到职业生涯的个人 Markdown 知识网站，用于：

1. 记录 LLM Agent 科研学习历程，包括基础原理、论文精读、公开研究进展与领域地图。
2. 记录 LeetCode 与算法专题笔记。
3. 记录 CS 基础、MLSys、LLM 工程与项目实践。
4. 发布经过脱敏、适合公开访问的求职与成长内容。
5. 以时间线形式保留研究日志、心得、踩坑记录和阶段性复盘。

网站应满足以下长期目标：

- 内容以纯文本为核心，能够被 Git 完整追踪和迁移。
- 本地写作、预览、发布流程简单，不依赖数据库或 CMS。
- URL、标签和外部代码链接长期稳定。
- 每次发布都经过自动构建检查，并可通过 Git 历史回滚。
- 即使未来迁移托管平台，也不需要重写内容体系。

代码一律不托管在网站仓库内。网站只保存笔记、少量页面代码和静态资源；实验代码放在独立 GitHub 仓库中，例如 `agent-journey`。

## 2. 公开范围与隐私边界

本项目是公开网站，不是私人知识库。GitHub Pages 通常可被任何人访问；`draft` 或 `unlisted` 也不能替代真正的权限控制。

以下内容不得进入网站仓库，包括草稿文件和 Git 历史：

- API Key、访问令牌、账号密码、服务器地址或其他凭据。
- 未公开的论文结果、审稿材料、实验数据和合作方资料。
- 未披露的研究想法池、投稿进度和内部讨论。
- 包含电话、住址、证件信息等隐私数据的完整简历。
- 企业内部代码、数据、文档或受保密协议约束的内容。

`04-career` 只保存公开版、脱敏后的内容；未公开研究记录、私人求职材料和完整投稿跟踪必须存放在本项目之外的私有仓库或本地目录。

## 3. 技术选型

### 3.1 核心栈

- **框架**：Docusaurus Classic，TypeScript 模板。
- **Docusaurus 版本**：初始化时使用当前最新稳定版；截至本文修订为 `3.10.2`。所有 `@docusaurus/*` 包必须使用相同的精确版本，并提交锁文件。
- **运行时**：Node.js 24 LTS；根目录提供 `.nvmrc`，GitHub Actions 也使用 Node.js 24。
- **包管理器**：npm；必须提交 `package-lock.json`，CI 使用 `npm ci`。
- **内容格式**：默认使用 `.md`；只有确实需要 React 组件时才使用 `.mdx`。
- **默认语言**：简体中文，Docusaurus locale 使用 `zh-Hans`；技术名词、URL slug、文件名和标签使用英文。
- **样式**：Docusaurus Classic/Infima + `src/css/custom.css` + 必要的 CSS Modules；第一版不引入大型 UI 组件库。

### 3.2 内容能力

- **文档体系**：`docs/`，用于持续修订的知识内容。
- **博客体系**：`blog/`，用于带明确时间背景的记录。
- **本地搜索**：`@easyops-cn/docusaurus-search-local`，索引 docs、blog 和必要的普通页面，语言配置为 `['en', 'zh']`，设置 `hashed: 'filename'` 生成可长期缓存的带哈希索引文件。
- **图表**：Docusaurus 官方 Mermaid theme。
- **公式**：KaTeX，通过与当前 Docusaurus 版本兼容的 `remark-math` 和 `rehype-katex` 版本启用。
- **订阅与索引**：保留 Docusaurus blog 的 RSS/Atom feed，并生成 sitemap。

第一版不使用 Algolia、评论系统、登录、CMS、PWA、AI 问答、自动读取 GitHub 状态或访问统计。未来只有在出现明确需求时再单独评估。

### 3.3 架构约束

- 纯静态构建，不使用数据库、自建后端或服务端渲染。
- 不使用 `localStorage`、`sessionStorage` 保存业务数据。
- 不使用 Git submodule 把代码仓库嵌入网站仓库。
- 不在浏览器端调用需要私密 token 的 GitHub API。
- 首页状态先手动维护，不做跨仓库自动同步。

## 4. docs 与 blog 的分工

| 判断标准 | 归属 |
|---|---|
| 半年后会继续修订、补充或纠错 | `docs/` |
| 主要价值是记录某个时间点的思考、进展或复盘 | `blog/` |

示例：

- “ReAct 论文精读笔记” → docs，会持续修订。
- “读完 SkillOpt 的第一点思考” → blog，保留当时观点。
- “研一上学期研究进展复盘” → blog。
- “LLM Agent Memory 领域地图” → docs。

blog 的“时间不可变”是内容政策，不是技术限制：

- 可以修复错别字、失效链接和明确事实错误。
- 不应重写当时的核心观点。
- 观点变化时，在文末追加带日期的更新说明，或另写一篇 blog 并相互链接。
- Git 历史保留原始版本。

`docs/02-llm-agents/my-research/research-overview.md` 只作为公开研究总览和日志索引；具体的日期型进展写入 blog，避免两处重复维护。

## 5. 项目目录结构

实施开始前，应将本设计文档从 `docs/specs/` 移至 `project-specs/`，避免被 Docusaurus 当作公开内容发布。

```text
personal-site/
├── project-specs/
│   └── personal-site-design-spec.md
├── docs/
│   ├── tags.yml
│   ├── 01-algorithms/
│   │   ├── _category_.json
│   │   ├── hot-100/
│   │   │   ├── _category_.json
│   │   │   └── index.md
│   │   ├── interview-150/
│   │   │   ├── _category_.json
│   │   │   └── index.md
│   │   ├── topics/
│   │   │   ├── _category_.json
│   │   │   ├── two-pointers-sliding-window.md
│   │   │   ├── dynamic-programming.md
│   │   │   ├── graph.md
│   │   │   ├── backtracking.md
│   │   │   ├── binary-search.md
│   │   │   ├── linked-list.md
│   │   │   ├── tree.md
│   │   │   └── heap-priority-queue.md
│   │   └── contest-notes/
│   │       ├── _category_.json
│   │       └── index.md
│   ├── 02-llm-agents/
│   │   ├── _category_.json
│   │   ├── fundamentals/
│   │   │   ├── _category_.json
│   │   │   ├── react.md
│   │   │   ├── reflexion.md
│   │   │   ├── tool-use-function-calling.md
│   │   │   ├── planning.md
│   │   │   ├── memory.md
│   │   │   └── multi-agent-systems.md
│   │   ├── paper-notes/
│   │   │   ├── _category_.json
│   │   │   ├── skill-learning-optimization/
│   │   │   │   ├── _category_.json
│   │   │   │   └── index.md
│   │   │   ├── agent-evaluation-benchmark/
│   │   │   │   ├── _category_.json
│   │   │   │   └── index.md
│   │   │   ├── agentic-rl-training/
│   │   │   │   ├── _category_.json
│   │   │   │   └── index.md
│   │   │   ├── memory-retrieval/
│   │   │   │   ├── _category_.json
│   │   │   │   └── index.md
│   │   │   └── multi-agent-systems/
│   │   │       ├── _category_.json
│   │   │       └── index.md
│   │   ├── my-research/
│   │   │   ├── _category_.json
│   │   │   ├── research-overview.md
│   │   │   ├── public-ideas.md
│   │   │   └── publications.md
│   │   └── landscape/
│   │       ├── _category_.json
│   │       └── index.md
│   ├── 03-engineering/
│   │   ├── _category_.json
│   │   ├── languages-tools/
│   │   │   ├── _category_.json
│   │   │   └── index.md
│   │   ├── cs-fundamentals/
│   │   │   ├── _category_.json
│   │   │   └── index.md
│   │   ├── mlsys-llm-infra/
│   │   │   ├── _category_.json
│   │   │   └── index.md
│   │   └── project-logs/
│   │       ├── _category_.json
│   │       └── index.md
│   └── 04-career/
│       ├── _category_.json
│       ├── resume-interview/
│       │   ├── _category_.json
│       │   └── index.md
│       └── retrospectives/
│           ├── _category_.json
│           └── index.md
├── blog/
│   ├── tags.yml
│   └── YYYY-MM-DD-title.md
├── templates/
│   ├── paper-note.md
│   ├── fundamentals-note.md
│   └── research-blog.md
├── src/
│   ├── css/custom.css
│   ├── data/status.ts
│   └── pages/index.tsx
├── static/
│   └── img/
├── .github/
│   ├── workflows/check.yml
│   ├── workflows/deploy.yml
│   ├── workflows/links.yml
│   └── dependabot.yml
├── .nvmrc
├── docusaurus.config.ts
├── sidebars.ts
├── package.json
├── package-lock.json
└── README.md
```

各分类的 label 和 position 必须按下表初始化：

| 目录 | label | position |
|---|---|---:|
| `01-algorithms` | 算法与数据结构 | 10 |
| `02-llm-agents` | LLM Agent 科研 | 20 |
| `03-engineering` | 工程技术 | 30 |
| `04-career` | 求职与成长 | 40 |
| `01-algorithms/hot-100` | LeetCode Hot 100 | 10 |
| `01-algorithms/interview-150` | 面试 150 | 20 |
| `01-algorithms/topics` | 专题突破 | 30 |
| `01-algorithms/contest-notes` | 竞赛笔记 | 40 |
| `02-llm-agents/fundamentals` | Agent 基础与原理 | 10 |
| `02-llm-agents/paper-notes` | 论文精读 | 20 |
| `02-llm-agents/my-research` | 我的研究 | 30 |
| `02-llm-agents/landscape` | 领域地图 | 40 |
| `03-engineering/languages-tools` | 语言与工具 | 10 |
| `03-engineering/cs-fundamentals` | CS 基础 | 20 |
| `03-engineering/mlsys-llm-infra` | MLSys & LLM 工程 | 30 |
| `03-engineering/project-logs` | 项目实战 | 40 |
| `04-career/resume-interview` | 简历与面经 | 10 |
| `04-career/retrospectives` | 阶段性复盘 | 20 |

`paper-notes` 下的五个研究主题依次使用 position 10、20、30、40、50，顺序与目录树一致。

## 6. 分类、文件和 URL 设计原则

1. 顶层分类按知识领域划分，不按人生阶段划分。
2. `_category_.json` 的 `position` 使用 10、20、30、40 等间隔值，方便插入新分类。
3. `paper-notes` 按研究主题分类，不按发表年份分类。
4. 文件夹负责主分类，tags 负责跨领域关联，不复制同一篇内容。
5. 文件名、目录名、slug 和 tag 使用小写英文 kebab-case。
6. 每篇正式发布的 doc/blog 必须显式设置稳定 `slug`；移动文件时不得随意改变原 slug。
7. 需要更换公开 URL 时，必须配置重定向或保留旧 slug，不能直接制造失效链接。
8. 页面专属图片应与笔记就近存放并使用相对路径；全站共用资源放在 `static/img/`。
9. 不把论文 PDF、数据集、模型权重或大型实验产物提交到网站仓库，只链接 DOI、arXiv、GitHub Release 或外部存储。

### 6.1 空分类与草稿

为了保留规划中的目录，可以创建 `_category_.json` 和占位 `index.md`，但占位页必须包含：

```yaml
draft: true
```

`draft: true` 页面只用于本地预览，不进入生产构建。分类出现第一篇正式内容后，应将 `index.md` 改为有实质内容的分类介绍，或改用 `_category_.json` 的 `generated-index`。

`unlisted: true` 仅用于“可凭链接访问但不出现在导航/搜索/sitemap”的公开内容，不得用于保存秘密。

### 6.2 标签治理

- docs 标签统一登记在 `docs/tags.yml`。
- blog 标签统一登记在 `blog/tags.yml`。
- 配置 `onInlineTags: 'throw'`，禁止未登记标签进入构建。
- 标签 key 使用英文 kebab-case，label 可以使用中文或中英混排。
- 新增标签前先检查是否已有同义标签。

初始标签至少包括：

```text
algorithms
leetcode
agent-fundamentals
paper-notes
skill-learning-optimization
agent-evaluation
research-log
cs-fundamentals
mlsys
llm-infra
career
retrospective
```

## 7. Frontmatter 与写作模板

### 7.1 docs 必填字段

每篇正式 doc 必须包含：

```yaml
---
title: <标题>
description: <用于搜索结果和页面摘要的一句话说明>
slug: /<稳定的英文路径>
sidebar_position: <数字>
tags: [<已在 docs/tags.yml 登记的标签>]
---
```

草稿额外使用 `draft: true`。不手动维护 `last_update`；正式页面的最后更新时间由 Git 历史生成。

### 7.2 论文精读模板

```markdown
---
title: <论文标题>
description: <论文解决的问题、核心方法和本文覆盖范围>
slug: /llm-agents/paper-notes/<topic>/<paper-slug>
sidebar_position: <数字>
tags: [paper-notes, <topic-tag>]
---

## 一句话核心思想

## 论文信息

- 论文：<arXiv / DOI / 官方页面>
- 作者：
- 会议或期刊：
- 阅读日期：

## 是什么

## 怎么做

## 为什么这样做

## 实验与结论

## 代码与复现

- [项目仓库：查看最新实现](https://github.com/<username>/<code-repo>)
- [本文对应版本：固定 commit 或 tag](https://github.com/<username>/<code-repo>/tree/<commit-or-tag>/code/<path>)
- 最后验证日期：YYYY-MM-DD

## 与相关工作的对比

## 我的思考与待验证问题

## 修订记录
```

### 7.3 Agent 基础原理模板

```markdown
---
title: ReAct: Reasoning and Acting
description: ReAct 的核心机制、适用边界和代码复现。
slug: /llm-agents/fundamentals/react
sidebar_position: 10
tags: [agent-fundamentals]
---

## 核心思想

## 关键机制

## 最小示例

## 代码复现

- [最新实现](https://github.com/<username>/<code-repo>)
- [固定版本](https://github.com/<username>/<code-repo>/tree/<commit-or-tag>/code/react)

## 相关工作对比

## 局限与适用场景

## 修订记录
```

### 7.4 blog 研究日志模板

文件名格式为 `YYYY-MM-DD-title.md`，并使用稳定的日期型 slug：

```markdown
---
title: 读完 SkillOpt 的第一点思考
description: <一句话摘要>
slug: /2026/08/20/skillopt-first-thoughts
date: 2026-08-20
tags: [research-log, skill-learning-optimization]
---

用于列表页展示、能够独立阅读的开头摘要。

<!-- truncate -->

正文……

## 相关链接

- [论文或资料](...)
- [相关知识笔记](...)
- [代码固定版本](...)

## 更新说明

<!-- 只有观点或事实后续发生变化时追加，不重写原始记录。 -->
```

## 8. 首页与导航

首页用于快速进入知识体系，不做通用作品集或复杂仪表盘。至少包含：

- 网站简介和主要研究方向。
- 四个顶层知识领域入口。
- “当前状态”：正在读的论文、正在刷的 LeetCode 专题、当前研究阶段。
- 最近更新的知识笔记和最近 blog。
- GitHub 主页与主要代码仓库入口。

“当前状态”统一维护在 `src/data/status.ts`，首页只负责渲染；第一版不调用 GitHub API。

导航栏至少包含：

- 算法与数据结构
- LLM Agent 科研
- 工程技术
- 求职与成长
- 时间线 / Blog
- GitHub
- 搜索框

## 9. GitHub 仓库集成

### 9.1 仓库边界

- 网站仓库：保存 Docusaurus、Markdown 笔记和静态资源。
- 代码仓库：保存实验代码、环境配置、数据处理脚本和测试。
- 两者通过普通 HTTPS 链接双向连接，不使用 submodule。

### 9.2 链接规则

每篇涉及代码的笔记应同时提供：

1. 指向代码仓库默认分支的“最新实现”链接。
2. 指向 commit SHA 或 release tag 的“本文固定版本”链接。
3. 必要时链接到固定版本中的具体文件或行号。

代码仓库 README 应反向链接对应的公开笔记，形成双向导航。用于论证和复现实验结论的链接不得只指向会持续变化的 `main` 分支。

### 9.3 编辑入口

在 docs 和 blog 插件中分别配置 `editUrl`，指向网站仓库 `main` 分支对应的源文件，使正式页面显示 “Edit this page”。

配置 `showLastUpdateTime: true`；GitHub Actions checkout 必须使用完整 Git 历史，以保证更新时间正确。

## 10. Docusaurus 配置要求

`docusaurus.config.ts` 至少应明确配置：

- `title`、`tagline`、`favicon`。
- `url`、`baseUrl`、`organizationName`、`projectName`。
- `trailingSlash: false`，避免 GitHub Pages 路径行为不一致。
- `i18n.defaultLocale: 'zh-Hans'` 和 `locales: ['zh-Hans']`。
- docs/blog 的 `editUrl`、tags 文件、`onInlineTags: 'throw'`。
- docs 的 `showLastUpdateTime: true`。
- navbar、footer、代码仓库链接。
- Mermaid、KaTeX、本地搜索。
- blog RSS/Atom feed 和 sitemap。
- 站点级 description、Open Graph 元数据和社交分享图。

构建必须严格处理内容错误：

- 普通失效链接：`throw`。
- Markdown 内部链接：`throw`。
- 失效图片：`throw`。
- 重复路由：`throw`。
- 失效锚点：`throw`。

如果站点部署在项目仓库：

```text
url: https://<username>.github.io
baseUrl: /<repo>/
```

如果仓库名为 `<username>.github.io` 或使用自定义域名：

```text
url: https://<site-domain>
baseUrl: /
```

## 11. GitHub Actions 与部署

### 11.1 发布方式

只使用 GitHub Pages 官方 Actions artifact 部署，不创建或维护 `gh-pages` 分支，不把 `build/` 提交到 Git。

仓库设置中必须将：

```text
Settings → Pages → Build and deployment → Source
```

设为 `GitHub Actions`。

### 11.2 PR 检查

`.github/workflows/check.yml`：

- 触发：面向 `main` 的 pull request、手动 `workflow_dispatch`。
- checkout 使用 `fetch-depth: 0` 获取完整 Git 历史。
- 使用 Node.js 24 和 npm cache。
- 执行 `npm ci`、TypeScript 检查和 `npm run build`。
- 不部署网站。

### 11.3 正式部署

`.github/workflows/deploy.yml`：

- 触发：push 到 `main`、手动 `workflow_dispatch`。
- 使用 concurrency，避免多个 Pages 部署互相覆盖。
- build job 执行 `npm ci`、类型检查、`npm run build`。
- 上传 `build/` 作为 Pages artifact。
- deploy job 依赖 build job，使用 `actions/deploy-pages` 发布到 `github-pages` environment。
- 使用最小权限：`contents: read`、`pages: write`、`id-token: write`。

自定义域名应在 GitHub 仓库的 Pages 设置中配置并启用 HTTPS；官方 Actions 部署不依赖手工维护 `CNAME` 文件。

### 11.4 回滚

发布失败时不得手工修改生产构建产物。应修复源文件后重新 push；需要恢复旧版本时，revert 对应源代码提交并重新部署，或重新运行已验证的历史 workflow。

## 12. 内容与工程质量

### 12.1 发布前最低检查

每次合并或直接 push 到 `main` 前至少保证：

- `npm ci` 可重复安装依赖。
- TypeScript 检查通过。
- `npm run build` 成功。
- 内部链接、锚点、图片和路由没有构建错误。
- 页面在桌面端和移动端能够正常阅读。
- 新增 tag 已写入 tags 文件。
- 涉及代码结论时包含固定 commit/tag 链接。
- 内容不包含敏感信息或大文件。

### 12.2 外部链接检查

增加 `.github/workflows/links.yml`，通过每周定时任务和手动 `workflow_dispatch` 检查 Markdown 中的 HTTP 链接。对暂时不可达但确认有效的站点使用小范围 allowlist，不得全局忽略错误。

### 12.3 依赖维护

`.github/dependabot.yml` 同时维护：

- npm 依赖。
- GitHub Actions。

更新频率统一使用 monthly，并按 npm 与 GitHub Actions 分组；不自动合并 Docusaurus 大版本升级。升级 Docusaurus 时，所有 `@docusaurus/*` 包必须保持同一版本，并在合并前完成构建和页面抽查。

## 13. 日常使用工作流

### 写作与发布

1. 从 `templates/` 复制相应模板。
2. 先确定内容属于 docs 还是 blog。
3. 填写稳定 slug、description 和已登记 tags。
4. 本地运行预览并检查链接、公式和图片。
5. 普通笔记可直接提交到 `main`；框架配置、依赖升级和较大改版使用分支 + PR。
6. push 后等待 GitHub Actions 构建和部署完成。

### 内容演进

- 临时内容使用 `draft: true`，完成后再公开。
- docs 可以持续修订，但重要观点变化应保留修订记录。
- blog 只追加更正或更新说明，不重写历史语境。
- 重命名文件或调整分类时保持原 slug；确需改变时提供重定向。
- 删除页面前检查站内引用和外部公开链接。

### 定期维护

- 每周检查失效外链，并处理持续失败的链接。
- 每月处理 Dependabot PR。
- 每季度检查 Node.js、Docusaurus 和搜索插件的兼容版本。
- 每季度确认自定义域名、HTTPS、Actions 和 Pages 部署正常。
- 至少保留一个本地 clone；可选地将 Git 仓库镜像到第二个远端作为额外备份。

## 14. 第一版验收标准

第一版只有在以下条件全部满足时才算完成：

1. 四个顶层知识领域、blog、标签和模板目录已建立。
2. 空分类不会以“待补充”页面污染生产站点。
3. 至少一篇正式 doc 和一篇正式 blog 可正常访问。
4. 首页状态、分类入口、最近更新和 GitHub 链接可用。
5. 中文本地搜索能检索 docs 和 blog。
6. Mermaid 和 KaTeX 示例可正确渲染。
7. docs/blog 都有正确的 Edit this page 链接。
8. PR 检查 workflow 能阻止构建错误。
9. push 到 `main` 后能通过官方 Pages Actions 自动发布。
10. 桌面端和移动端导航、正文、代码块、表格均可阅读。
11. sitemap、RSS/Atom、页面 description 和基础 Open Graph 元数据存在。
12. README 说明本地运行、内容分类、发布、回滚和隐私规则。
13. 定时外链检查和 Dependabot 配置已启用。

## 15. 给 code agent 的执行清单

1. 将本文档移动到 `project-specs/personal-site-design-spec.md`。
2. 使用 Docusaurus Classic TypeScript 模板在当前仓库根目录初始化项目，使用 npm 和 Node.js 24。
3. 删除模板自带的示例 docs、blog 和无关首页内容。
4. 按第 5 节建立目录、`_category_.json`、tags 文件和 draft 占位页。
5. 创建三份写作模板，并创建正式的 `react.md` 示例和“开始搭建这个网站”blog。
6. 实现 `src/data/status.ts` 和简洁的知识入口首页。
7. 配置中文 locale、稳定 URL、严格链接检查、最后更新时间、Mermaid、KaTeX、RSS/Atom、sitemap 和本地中文搜索。
8. 配置 docs/blog 的 `editUrl`、GitHub 导航入口与固定代码版本链接示例。
9. 配置 `check.yml`、`deploy.yml`、`links.yml` 和 `dependabot.yml`；部署只使用官方 Pages artifact 工作流。
10. 生成 README，说明目录、写作、本地预览、构建、部署、回滚、隐私与维护流程。
11. 执行类型检查和生产构建，修复全部错误。
12. 验证首页、分类、搜索、Mermaid、KaTeX、Edit this page、RSS、sitemap、移动端和 GitHub Pages 部署。

---

本规范的优先级从高到低为：公开安全与仓库边界 → 内容模型与稳定 URL → 可重复构建与部署 → 搜索和阅读体验 → 视觉定制。第一版应优先保证内容能够长期积累、链接长期有效、发布过程可靠。
