# ymt 的个人网站

一个长期维护（学生阶段 → 职业生涯）的个人笔记网站。

网站以知识领域组织稳定、可复用的笔记，以时间线记录阶段性思考。当前内容覆盖算法、LLM 与 Agent、软件工程和职业发展，后续可以随着学习与工作持续扩展。

日常写作、版本升级、设计修改、故障处理和发布回退的完整流程见 [`docs/00-site-guide.md`](docs/00-site-guide.md)。

## 技术栈

- [Docusaurus 3](https://docusaurus.io/) + React + TypeScript
- Markdown / MDX 内容
- Mermaid、KaTeX 与本地全文搜索
- GitHub Actions 自动检查和部署
- GitHub Pages 托管

## 本地开发

需要 Node.js 24 和 npm 11。推荐使用 `.nvmrc` 切换 Node.js 版本。

```bash
nvm use
npm ci
npm start
```

开发服务器默认运行在 `http://localhost:3000`。

提交前运行：

```bash
npm run typecheck
npm run build
```

`build/` 是完整的静态网站产物，可以使用 `npm run serve` 在本地预览生产版本。

## 内容组织

```text
docs/                 按领域组织的长期知识库
  00-site-guide.md     网站使用与维护指南
  algorithms/         算法与数据结构
  llm-agents/         LLM、Agent 与个人研究
  engineering/        软件工程实践
  career/             职业发展
blog/                 按时间记录的研究日志与阶段总结
templates/            新建内容时使用的写作模板
project-specs/        产品与工程设计文档
src/                  首页、样式与网站组件
static/               静态资源
```

知识库中的稳定内容放在 `docs/`；有明显时间属性的思考、复盘和进展放在 `blog/`。尚未完成的文章应在 front matter 中设置 `draft: true`，避免部署到公开网站。

创建文章时，先复制 `templates/` 中最接近的模板，再补充标题、描述、标签和正文。文档标签统一维护在 `docs/tags.yml`，博客标签统一维护在 `blog/tags.yml`。

## 自动化与部署

- `check.yml`：每个 Pull Request 运行类型检查和生产构建。
- `deploy.yml`：推送到 `main` 后构建并部署到 GitHub Pages。
- `links.yml`：每周检查公开内容中的失效链接。
- Dependabot：每月检查 npm 和 GitHub Actions 更新。

首次发布前，在仓库 `Settings → Pages → Build and deployment → Source` 中选择 **GitHub Actions**。之后只需把通过检查的内容合并到 `main`，网站会自动更新。

网站地址：<https://woxiangjinbu-ymt.github.io/>

## 日常维护建议

1. 平时从短小、可验证的笔记开始，不必等到文章完全成熟。
2. 每周整理草稿并检查站内链接；每月处理 Dependabot 更新。
3. 重要改动通过分支和 Pull Request 完成，确保自动检查通过后再合并。
4. 发布后若发现问题，可在 GitHub Actions 中重新部署上一条稳定提交，或用一次新的回退提交恢复。
5. 不要在公开仓库中提交密钥、个人隐私、未公开研究数据或受版权限制的材料。

## 仓库

<https://github.com/Woxiangjinbu-ymt/Woxiangjinbu-ymt.github.io>
