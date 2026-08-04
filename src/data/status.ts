export type StatusItem = {
  label: string;
  value: string;
  note: string;
};

export type KnowledgeDomain = {
  index: string;
  title: string;
  description: string;
  href: string;
  accent: string;
};

export const currentStatus: StatusItem[] = [
  {
    label: '正在阅读',
    value: 'Agent Skill Learning',
    note: '梳理技能获取、评估与优化的研究脉络',
  },
  {
    label: '算法专题',
    value: '双指针与滑动窗口',
    note: '从模式识别到复杂度分析',
  },
  {
    label: '研究阶段',
    value: '问题空间调研',
    note: '建立领域地图与论文阅读队列',
  },
];

export const knowledgeDomains: KnowledgeDomain[] = [
  {
    index: '01',
    title: '算法与数据结构',
    description: '以专题组织 LeetCode 训练，沉淀可迁移的问题模式与解题框架。',
    href: '/docs/algorithms',
    accent: 'amber',
  },
  {
    index: '02',
    title: 'LLM Agent 科研',
    description: '从基础机制、论文精读到公开研究进展，建立长期可修订的研究主线。',
    href: '/docs/llm-agents',
    accent: 'teal',
  },
  {
    index: '03',
    title: '工程技术',
    description: '覆盖 CS 基础、开发工具、MLSys、LLM Infra 与真实项目实践。',
    href: '/docs/engineering',
    accent: 'blue',
  },
  {
    index: '04',
    title: '求职与成长',
    description: '记录公开且脱敏的求职经验、能力建设与阶段性复盘。',
    href: '/docs/career',
    accent: 'rose',
  },
];

export const recentUpdates = [
  {
    kind: '知识笔记',
    date: '2026-08-04',
    title: 'ReAct：Reasoning and Acting',
    description: '理解推理轨迹与外部行动如何在 Agent 循环中交替发生。',
    href: '/docs/llm-agents/fundamentals/react',
  },
  {
    kind: '学习时间线',
    date: '2026-08-04',
    title: '开始搭建这个网站',
    description: '为什么要建立一个能够从学生阶段持续到职业生涯的知识系统。',
    href: '/blog/2026/08/04/start-building-this-site',
  },
];
