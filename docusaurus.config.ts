import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const config: Config = {
  title: 'ymt的个人网站',
  tagline: '一个长期维护（学生阶段 → 职业生涯）的个人笔记网站',
  future: {
    v4: true,
  },
  url: 'https://woxiangjinbu-ymt.github.io',
  baseUrl: '/',
  organizationName: 'Woxiangjinbu-ymt',
  projectName: 'Woxiangjinbu-ymt.github.io',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  onDuplicateRoutes: 'throw',
  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },
  markdown: {
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
      onBrokenMarkdownImages: 'throw',
    },
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Woxiangjinbu-ymt/Woxiangjinbu-ymt.github.io/edit/main/',
          showLastUpdateTime: true,
          onInlineTags: 'throw',
          tags: 'tags.yml',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        blog: {
          showReadingTime: true,
          blogTitle: '学习时间线',
          blogDescription: '研究日志、学习心得、踩坑记录与阶段性复盘。',
          blogSidebarTitle: '最近记录',
          blogSidebarCount: 8,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
            copyright: `Copyright © ${new Date().getFullYear()} ymt`,
          },
          editUrl: 'https://github.com/Woxiangjinbu-ymt/Woxiangjinbu-ymt.github.io/edit/main/',
          onInlineTags: 'throw',
          onInlineAuthors: 'throw',
          onUntruncatedBlogPosts: 'throw',
          tags: 'tags.yml',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themes: [
    '@docusaurus/theme-mermaid',
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: 'filename',
        language: ['en', 'zh'],
        indexDocs: true,
        indexBlog: true,
        indexPages: true,
        searchBarShortcut: true,
        searchBarShortcutKeymap: 'mod+k',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],
  themeConfig: {
    image: 'img/social-card.png',
    metadata: [
      {
        name: 'keywords',
        content: 'LLM Agent, 算法, 计算机科学, 工程实践, 研究日志, 个人知识库',
      },
    ],
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ymt / notes',
      items: [
        {to: '/docs/algorithms', label: '算法', position: 'left'},
        {to: '/docs/llm-agents', label: 'LLM Agent', position: 'left'},
        {to: '/docs/engineering', label: '工程', position: 'left'},
        {to: '/docs/career', label: '成长', position: 'left'},
        {to: '/blog', label: '时间线', position: 'left'},
        {
          href: 'https://github.com/Woxiangjinbu-ymt',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '知识领域',
          items: [
            {label: '算法与数据结构', to: '/docs/algorithms'},
            {label: 'LLM Agent 科研', to: '/docs/llm-agents'},
            {label: '工程技术', to: '/docs/engineering'},
          ],
        },
        {
          title: '记录',
          items: [
            {label: '求职与成长', to: '/docs/career'},
            {label: '学习时间线', to: '/blog'},
            {
              label: 'RSS',
              href: 'https://woxiangjinbu-ymt.github.io/blog/rss.xml',
            },
          ],
        },
        {
          title: '连接',
          items: [
            {label: 'GitHub', href: 'https://github.com/Woxiangjinbu-ymt'},
            {
              label: '编辑本站',
              href: 'https://github.com/Woxiangjinbu-ymt/Woxiangjinbu-ymt.github.io',
            },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} ymt · 持续学习，长期维护。`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'python', 'json', 'typescript'],
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: false,
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
