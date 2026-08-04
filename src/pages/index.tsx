import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {
  currentStatus,
  knowledgeDomains,
  recentUpdates,
} from '@site/src/data/status';

import styles from './index.module.css';

function HomepageHeader() {
  return (
    <header className={styles.hero}>
      <div className={`container ${styles.heroGrid}`}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span>YMT</span>
            <span className={styles.eyebrowLine} />
            <span>LEARNING LEDGER</span>
          </p>
          <Heading as="h1" className={styles.heroTitle}>
            把学习变成一张
            <span>长期生长的知识地图。</span>
          </Heading>
          <p className={styles.heroDescription}>
            一个从学生阶段延伸到职业生涯的个人笔记网站。记录理解，连接研究，保留每一次认知更新的来路。
          </p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} to="/docs/llm-agents">
              进入知识库 <span aria-hidden="true">↗</span>
            </Link>
            <Link className={styles.secondaryAction} to="/blog">
              查看学习时间线
            </Link>
          </div>
          <p className={styles.heroMeta}>Markdown-first · Git-versioned · 持续维护</p>
        </div>

        <aside className={styles.statusCard} aria-label="当前学习状态">
          <div className={styles.statusHeader}>
            <span>NOW / 当前状态</span>
            <span className={styles.liveDot}>更新中</span>
          </div>
          <div className={styles.statusList}>
            {currentStatus.map((item) => (
              <div className={styles.statusItem} key={item.label}>
                <p>{item.label}</p>
                <strong>{item.value}</strong>
                <span>{item.note}</span>
              </div>
            ))}
          </div>
          <div className={styles.statusFooter}>
            <span>LAST UPDATED</span>
            <time dateTime="2026-08-04">2026.08.04</time>
          </div>
        </aside>
      </div>
    </header>
  );
}

function DomainSection() {
  return (
    <section className={styles.section} aria-labelledby="domains-title">
      <div className="container">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionIndex}>01 / KNOWLEDGE DOMAINS</p>
            <Heading as="h2" id="domains-title">按领域生长，而不是按阶段归档</Heading>
          </div>
          <p>稳定的分类树承载长期知识，标签负责连接跨领域的线索。</p>
        </div>
        <div className={styles.domainGrid}>
          {knowledgeDomains.map((domain) => (
            <Link
              className={`${styles.domainCard} ${styles[domain.accent]}`}
              to={domain.href}
              key={domain.index}>
              <div className={styles.domainTopline}>
                <span>{domain.index}</span>
                <span aria-hidden="true">↗</span>
              </div>
              <Heading as="h3">{domain.title}</Heading>
              <p>{domain.description}</p>
              <span className={styles.cardLink}>浏览该领域</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function UpdateSection() {
  return (
    <section className={`${styles.section} ${styles.updateSection}`} aria-labelledby="updates-title">
      <div className="container">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionIndex}>02 / RECENTLY UPDATED</p>
            <Heading as="h2" id="updates-title">最近更新</Heading>
          </div>
          <Link className={styles.textLink} to="/blog">完整时间线 →</Link>
        </div>
        <div className={styles.updateGrid}>
          {recentUpdates.map((item) => (
            <Link className={styles.updateCard} to={item.href} key={item.href}>
              <div className={styles.updateMeta}>
                <span>{item.kind}</span>
                <time dateTime={item.date}>{item.date.replaceAll('-', '.')}</time>
              </div>
              <Heading as="h3">{item.title}</Heading>
              <p>{item.description}</p>
              <span aria-hidden="true" className={styles.updateArrow}>→</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContentModelSection() {
  return (
    <section className={styles.modelSection} aria-labelledby="model-title">
      <div className={`container ${styles.modelGrid}`}>
        <div>
          <p className={styles.sectionIndex}>03 / HOW IT WORKS</p>
          <Heading as="h2" id="model-title">两种内容，两种时间尺度</Heading>
          <p className={styles.modelIntro}>
            知识需要反复修订，思考也需要保留当时的样子。这个网站让两者各自生长，又彼此连接。
          </p>
        </div>
        <div className={styles.modelCards}>
          <Link to="/docs/llm-agents" className={styles.modelCard}>
            <span className={styles.modelLabel}>DOCS / 常青笔记</span>
            <strong>半年后仍会回来修订</strong>
            <p>原理、论文、算法与工程知识，进入可持续整理的分类树。</p>
          </Link>
          <Link to="/blog" className={styles.modelCard}>
            <span className={styles.modelLabel}>BLOG / 时间切片</span>
            <strong>记录此刻如何理解问题</strong>
            <p>研究进展、学习心得和阶段复盘，保留当时的语境。</p>
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="长期生长的个人知识地图"
      description="ymt 的个人学习笔记网站，记录 LLM Agent 科研、算法、工程技术与成长复盘。">
      <HomepageHeader />
      <main>
        <DomainSection />
        <UpdateSection />
        <ContentModelSection />
      </main>
    </Layout>
  );
}
