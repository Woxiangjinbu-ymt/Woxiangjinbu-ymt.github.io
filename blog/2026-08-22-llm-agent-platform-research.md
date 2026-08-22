---
title: "大模型与智能体平台深度调研：从模型架构、训练方法到 Agent Runtime"
description: "基于公开技术报告与官方文档，对主流大模型厂商和 Agent 平台的架构、算法、训练方法与实现机制进行横向拆解"
slug: /2026/08/22/llm-agent-platform-research
date: 2026-08-22
authors: [ymt]
tags: [research-log]
---

# 大模型与智能体平台深度调研

> **一句话核心主张：** 当前主流大模型之间真正有技术区分度的已经不只是“参数量”和 Benchmark，而是 **Attention / MoE / 多模态融合等模型内部架构、预训练与后训练方法、推理时计算策略，以及模型是否被专门训练成能够在 Agent Harness 中长期调用工具并根据环境反馈继续行动**；而主流 Agent 平台之间的核心差异，则在于它们如何实现 **Agent Loop、状态与上下文管理、工具执行、工作流控制、多智能体协作以及 MCP / A2A 等外部协议**。

<!-- truncate -->

本文只回答两个问题：

1. **主流大模型厂商到底在模型内部做了什么，它们为什么表现出不同的能力边界？**
2. **主流智能体平台到底如何把一个大模型变成可以连续执行任务的 Agent，它们的运行机制有何不同？**

对闭源模型，只讨论厂商公开披露的事实；没有公开的参数规模、Dense/MoE 结构、Attention 形式等内容一律标记为“未公开”，不根据产品表现反推模型内部结构。

---

## 1. 主流大模型厂商深度调研

### 1.1 先建立统一比较框架

如果只比较“谁更聪明”，很容易把模型、推理系统、工具、搜索和 Agent Harness 混在一起。更合理的比较方式是把一个现代大模型拆成五层。

| 层次 | 核心问题 | 典型技术 |
|---|---|---|
| Backbone | 单次前向传播如何计算 | Transformer、Attention、Linear Attention、Sparse Attention、MoE |
| Representation | 如何处理位置、长上下文和多模态 | RoPE、MLA、KDA、early fusion、统一 token 序列 |
| Pre-training | 模型如何获得通用能力 | next-token prediction、next-group prediction、数据课程、蒸馏、弹性训练 |
| Post-training | 如何获得推理、指令和 Agent 能力 | SFT、DPO、RLHF、RLAIF、GRPO、GSPO、Agentic RL、on-policy distillation |
| Inference / Agentization | 推理时如何分配计算并与环境交互 | reasoning effort、thinking mode、tool calling、computer use、多 Agent |

传统自回归语言模型的核心目标仍然可以写成：

$$
\mathcal{L}_{\mathrm{LM}}(\theta)
=-\sum_{t=1}^{T}\log p_{\theta}(x_t\mid x_{<t})
$$

模型架构的创新，本质上是在改变条件概率 $p_{\theta}$ 的计算方式；训练方法的创新，则是在改变参数 $\theta$ 如何被优化，以及模型最终更偏向什么行为。

#### 1.1.1 Attention：现代模型首先在解决“长序列算不起”

标准 Self-Attention 为：

$$
Q=XW_Q,\qquad K=XW_K,\qquad V=XW_V
$$

$$
\operatorname{Attn}(Q,K,V)
=\operatorname{softmax}\left(\frac{QK^\top}{\sqrt{d}}\right)V
$$

当序列长度为 $n$ 时，显式 $QK^\top$ 的计算和注意力矩阵存储都随 $n^2$ 增长。因此，2025—2026 年的一个明显趋势是：**各家都在试图让长上下文不再等价于完整 Dense Attention。**

不同路线包括：

```text
标准 MHA / GQA
    │
    ├─ 压缩 K/V：DeepSeek MLA / Kimi Gated MLA
    │
    ├─ 稀疏选 token：DeepSeek CSA / GLM DSA
    │
    ├─ 线性递推状态：Qwen Gated DeltaNet / Kimi KDA
    │
    └─ Dense + 稀疏/线性混合：在精确召回与长序列效率之间折中
```

#### 1.1.2 MoE：解决“参数越大，每个 token 都越贵”

Dense FFN 中，每个 token 都经过全部 FFN 参数。MoE 则先由 Router 选择少数专家：

$$
s_i=W_r h
$$

$$
\mathcal{I}(h)=\operatorname{TopK}(s, k)
$$

$$
y=\sum_{i\in\mathcal{I}(h)}\alpha_i E_i(h)
$$

这使模型的**总参数容量**与**每 token 激活计算量**部分解耦。代价是专家路由、负载均衡和跨设备 All-to-All 通信会成为新的系统瓶颈。

#### 1.1.3 Post-training：模型能力已经从“答题”转向“行动”

传统偏好优化可以抽象为：

$$
J(\theta)=
\mathbb{E}_{y\sim\pi_\theta(\cdot\mid x)}[r(x,y)]
-\beta D_{\mathrm{KL}}\left(\pi_\theta\|\pi_{\mathrm{ref}}\right)
$$

但 Agentic RL 的环境不再只给一个最终文本分数。模型产生动作 $a_t$，环境返回观察 $o_{t+1}$：

$$
a_t\sim\pi_\theta(a\mid s_t),
\qquad
s_{t+1}=f(s_t,a_t,o_{t+1})
$$

因此，**现代旗舰模型的后训练越来越接近“在真实或模拟环境中学习完成长轨迹任务”，而不是只学习生成一条更符合偏好的回答。**

下面按厂商逐一拆解。

---

### 1.2 OpenAI：GPT-5.6——系统级推理与 Agent 化最完整，但内部架构最不透明

#### 1.2.1 当前模型定位

截至 2026-08-22，GPT-5.6 分为三个能力层级：

| 模型 | 定位 |
|---|---|
| GPT-5.6 Sol | 旗舰，复杂推理、代码、科研和长程 Agent |
| GPT-5.6 Terra | 通用工作负载，强调性能/成本平衡 |
| GPT-5.6 Luna | 快速、低成本、大规模调用 |

OpenAI 当前没有公开 GPT-5.6 的参数量、Transformer 层数、Attention 类型以及 Dense/MoE 结构。因此不能把 GPT-5.6 写成某种未经证实的 MoE 架构。

#### 1.2.2 真正公开的技术重点：推理预算与工具执行

GPT-5 系列以后，OpenAI 更明显地把“模型”设计成推理系统的一部分。可以用一个抽象过程表示：

$$
(z_t,a_t)\sim p_\theta(\cdot\mid x,H_t,T,b)
$$

其中：

- $H_t$ 是已有上下文和工具结果；
- $T$ 是可调用工具集合；
- $b$ 是 reasoning effort / 计算预算；
- $z_t$ 表示内部推理状态；
- $a_t$ 可以是文本，也可以是结构化工具动作。

关键不是公式本身，而是 **推理预算已经成为模型 API 的显式控制变量**。对于简单任务，系统倾向于少用计算；对于难任务，可以提高 reasoning effort。

GPT-5.6 进一步把 Agent 执行能力推到模型接口内部：

```text
用户任务
   ↓
GPT-5.6
   ├─ reasoning
   ├─ programmatic tool calling
   │      └─ 生成小程序协调多个工具与中间结果
   ├─ computer use
   └─ multi-agent / ultra
          ├─ sub-agent A
          ├─ sub-agent B
          └─ synthesis
```

这里一个值得注意的变化是 **Programmatic Tool Calling**：模型不必把每一次工具调用都作为单独的“模型 → 工具 → 模型”往返，而可以生成程序在内存中协调多个工具和中间结果。它实际上是在减少 Agent Harness 的控制面开销。

#### 1.2.3 训练方法：公开到“方法层”，没有公开完整配方

GPT-5.6 官方资料明确强调：

- 更强的 reasoning；
- coding / knowledge work / cyber / science；
- tool use 与 computer use；
- 长程 Agent 任务；
- 多智能体并行协作。

但 OpenAI 没有公开 GPT-5.6 的完整预训练数据量、优化器和 RL 目标。因此更严格的结论是：**GPT-5.6 的优势可以确认来自模型与 Agent Harness 的联合优化，但无法把最终能力因果归结为某个公开的 Transformer 新结构。**

#### 1.2.4 优点、短板与主要定位

| 维度 | 判断 |
|---|---|
| 核心优势 | 模型、Responses API、工具、沙箱、Codex、Agents SDK 与多 Agent 能力形成完整闭环 |
| 推理特点 | reasoning effort 可调，强工具使用，长程任务完成度高 |
| 工程优势 | API 与 Agent runtime 紧密结合，开发者无需自行实现大量底层 harness |
| 主要短板 | 模型内部不可审计；无法做严格架构复现；高度依赖 OpenAI runtime |
| 主要定位 | 通用前沿模型 + Agent 原生基础模型 + 企业知识工作/软件工程 |

> **机制性总结：** GPT-5.6 的核心竞争力不是一个已公开的新 Attention 公式，而是“模型在训练时就被优化为能在高质量 Harness 中持续推理、调工具、写程序和分派子 Agent”。

**证据边界：** GPT-5.6 的模型内部结构未公开。任何“GPT-5.6 使用某种 MoE / 某种 Attention”的说法，如果没有 OpenAI 官方材料支持，都不应写入正式调研。

官方资料：

- [GPT-5.6](https://openai.com/index/gpt-5-6/)
- [How GPT-5.6 fuses frontier intelligence with frontier efficiency](https://openai.com/index/gpt-5-6-frontier-intelligence-efficiency/)

---

### 1.3 Anthropic：Claude——把长程 Agent、上下文工程和安全对齐放在同一条技术线上

#### 1.3.1 当前模型定位

2026 年 6—7 月，Anthropic 分别发布 Claude Sonnet 5 与 Claude Opus 5。Sonnet 5 主打规模化 Agent 和 coding，Opus 5 面向更复杂的长程 Agent、专业知识工作和高难度 coding。

与 OpenAI 类似，Anthropic 没有公开 Claude 5 的总参数、层数、MoE 细节和具体 Attention 架构。

#### 1.3.2 Anthropic 真正公开且有辨识度的部分：Constitutional AI 与 RLAIF

Anthropic 的经典对齐路线是 Constitutional AI。可以抽象为两个阶段：

```text
初始模型输出
   ↓
依据 Constitution 自我 critique
   ↓
生成 revised response
   ↓
形成监督数据
   ↓
训练偏好 / reward model
   ↓
RLAIF / RL
```

偏好模型可以写成 Bradley-Terry 形式：

$$
P(y_a\succ y_b\mid x)
=\sigma\left(r_\phi(x,y_a)-r_\phi(x,y_b)\right)
$$

Anthropic 的关键思想不是“让 AI 自己随便评价自己”，而是用一套显式原则约束 critique 和 preference generation，再通过 RL 把偏好压回策略模型。

#### 1.3.3 Claude 更重要的变化：把 Agent 行为作为模型能力本身

Sonnet 5 官方描述直接强调：

- 能制定计划；
- 能使用 browser、terminal 等工具；
- 能长时间自主运行；
- coding、tool use、knowledge work 都针对 Agent 场景优化。

Anthropic 的工程研究进一步表明，Claude 的 Agent 能力并不只依赖模型权重，而强依赖上下文工程：

```text
Context Window
   ├─ system instructions
   ├─ current task state
   ├─ selected files / retrieved knowledge
   ├─ tool schemas
   ├─ recent observations
   └─ compacted history / structured notes
```

当上下文接近上限时，Claude Agent SDK 可通过 compaction 压缩历史；在更长任务中，也可以进行 context reset，并通过结构化 artifact 把状态交给下一轮 Agent。

因此，Claude 的一个核心设计哲学可以概括为：

> **模型本身负责高质量决策，Harness 负责让有限 context window 中始终保留“当前最有用的信息”。**

#### 1.3.4 优点、短板与主要定位

| 维度 | 判断 |
|---|---|
| 核心优势 | 长文档、代码、复杂知识工作、长时间 Agent 运行；Agent Harness 研究体系完整 |
| 对齐特点 | Constitutional AI / RLAIF 形成清晰安全哲学 |
| Agent 特点 | 计划、terminal/browser、context compaction、structured artifacts、MCP |
| 主要短板 | 模型内部架构高度不透明；很多能力只能以模型+Harness整体评估 |
| 主要定位 | 企业知识工作、软件工程、长程自主 Agent、安全敏感场景 |

**证据边界：** Claude 5 的“Agentic”能力是公开事实，但不能因此推断其内部使用 MoE、特殊 Attention 或某个具体参数规模。

官方资料：

- [Claude Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5)
- [Anthropic Engineering](https://www.anthropic.com/engineering)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

---

### 1.4 Google：Gemini——原生多模态、长上下文和工具生态是主线

#### 1.4.1 当前模型定位

截至 2026-08，Gemini 3 系列已演进到 Gemini 3.7 Flash。Google 对 3.7 的公开说明强调：

- 在 3.6 基础上改进核心 reasoning；
- thinking budget 可调；
- 文本、图像、音频、视频输入；
- 1M 上下文；
- coding、agentic tool use 和企业场景。

Gemini 3.7 的完整 block-level 结构没有公开，因此不能直接把 Gemini 2.5 的所有结构细节当作 3.7 的事实。

#### 1.4.2 已公开的 Gemini 代系架构：Sparse MoE + Native Multimodality

Gemini 2.5 技术报告明确披露其使用 sparse MoE Transformer，并从模型层面联合处理文本、视觉和音频。因此 Gemini 的多模态并不是简单的：

```text
图片 → 独立视觉模型 → 文字描述 → LLM
```

而更接近：

```text
Text tokens ─┐
Image tokens ├─→ unified multimodal backbone → autoregressive output
Audio tokens ┤
Video tokens ┘
```

统一序列建模可以抽象为：

$$
\mathcal{L}
=-\sum_t \log p_\theta(z_t\mid z_{<t})
$$

其中 $z_t$ 不再只表示文本 token，也可以表示由不同模态编码后进入统一 backbone 的表示。

#### 1.4.3 “Thinking”与长上下文

Gemini 的另一个明确方向是可控 thinking budget。其意义与普通 temperature 不同：temperature 改变采样随机性，而 thinking budget 更接近控制模型在生成最终答案前允许消耗的内部推理计算。

长上下文则服务于 Google 的典型场景：

- 大型代码仓库；
- 多文档分析；
- 长视频；
- 多模态研究材料；
- Agent 在大量历史 observation 上继续工作。

#### 1.4.4 优点、短板与主要定位

| 维度 | 判断 |
|---|---|
| 核心优势 | 原生多模态、视频/音频、超长上下文、Google Search/Workspace/Cloud 工具生态 |
| 架构特点 | Gemini 2.5 已公开 sparse MoE；3.7 继承代系但具体结构未完全公开 |
| Agent 特点 | function calling、search、computer use、ADK/A2A 生态 |
| 主要短板 | 最新旗舰的内部细节仍有限；模型/产品版本层级多，横向比较容易混淆 |
| 主要定位 | 多模态 Agent、长上下文、Google 生态企业工作流、机器人/现实世界接口 |

**证据边界：** “Gemini 2.5 使用 sparse MoE”是公开技术事实；“Gemini 3.7 与 2.5 结构完全相同”不是。

官方资料：

- [Gemini 3.7 Flash Model Card](https://deepmind.google/models/model-cards/gemini-3-7-flash/)
- [Gemini Model Cards](https://deepmind.google/models/model-cards/)

---

### 1.5 xAI：Grok 4.6——把大规模 Agentic RL 与搜索、代码和实时环境结合

#### 1.5.1 当前模型定位

Grok 4.6 于 2026-08-12 发布，重点已经从“聊天模型”明显转向：

- coding；
- long-running agents；
- knowledge work；
- interactive / visual work；
- web、X search、code execution 等工具环境。

其 API 支持可配置 reasoning effort。

#### 1.5.2 训练方法：比内部架构披露得更多

xAI 没有公开 Grok 4.6 的参数量和 Attention / MoE 结构，但公开了较清晰的后训练路线：

```text
更长的 supplemental training
   ├─ 模型生成的 reasoning 数据
   ├─ 高质量 engineering 数据
   └─ 改进 optimizer / recipe
             ↓
         SFT trajectories
   ├─ 不同 reasoning effort
   ├─ 不同 agent harness
   ├─ STEM / SWE / knowledge work
   └─ model-based filtering
             ↓
         Agentic RL
   ├─ general coding
   ├─ knowledge work
   ├─ kernel optimization
   ├─ web development
   └─ CAD 等环境
```

这说明 Grok 的关键差异不是一个可见的 Transformer 新公式，而是**训练分布已经包含长轨迹、工具、代码环境和不同 Harness。**

#### 1.5.3 优点、短板与主要定位

| 维度 | 判断 |
|---|---|
| 核心优势 | 搜索/X实时信息、代码、长程 Agent、Agentic RL 规模化 |
| 训练特点 | 大量 agent harness 轨迹 + 环境式 RL |
| 工具生态 | web search、X search、code execution、function calling |
| 主要短板 | block-level 模型架构未公开；可复现实验细节有限 |
| 主要定位 | 实时信息 Agent、coding agent、交互式知识工作 |

官方资料：

- [Introducing Grok 4.6](https://x.ai/news/grok-4-6)
- [Grok 4.6 Docs](https://docs.x.ai/developers/grok-4-6)

---

### 1.6 Meta：Llama 4——开放模型中典型的 Native Multimodal MoE

Llama 4 虽然不是 2026 年最新发布的闭源旗舰，但仍是最重要的**可研究、可部署、架构公开度较高**的开放模型系列之一。

#### 1.6.1 架构：Alternating Dense + MoE

Llama 4 Maverick：

- 400B 总参数；
- 17B 激活参数；
- 128 个 routed experts + 1 个 shared expert；
- Dense 与 MoE 层交替。

每个 token 在 MoE 层经过共享专家和一个路由专家，可以写成：

$$
y=E_{\mathrm{shared}}(h)
+\alpha_{i^*}E_{i^*}(h)
$$

$$
i^*=\arg\max_i g_i(h)
$$

这种设计相对“每 token 激活多个专家”的 DeepSeek/Qwen 路线更激进地控制单 token 专家计算。

#### 1.6.2 Native Multimodality：Early Fusion

Llama 4 使用 early fusion，把文本和视觉 token 在 backbone 中联合训练，并使用大规模文本、图像、视频数据。

```text
Text ─────────┐
Image encoder ├─→ unified Llama backbone
Video frames ─┘
```

这意味着视觉不是后置外挂，而是参与模型预训练分布。

#### 1.6.3 长上下文：iRoPE

Llama 4 Scout 的一个重要结构是 iRoPE：部分 attention layer 不使用位置编码，大部分层仍使用 RoPE，并配合 inference-time attention temperature scaling 提高长度外推。

其目标不是简单扩大 RoPE base，而是减少所有层都强绑定绝对/相对位置几何后带来的外推问题。

#### 1.6.4 训练：MetaP、蒸馏、Online RL

Llama 4 的训练公开度很高：

- 超过 30T token；
- FP8 预训练；
- MetaP 用于跨规模迁移关键超参数；
- Behemoth 作为 teacher 对 Maverick 进行 codistillation；
- post-training 为 lightweight SFT → online RL → lightweight DPO；
- online RL 持续过滤过易样本，把训练预算集中在中高难度数据。

#### 1.6.5 优点、短板与定位

| 维度 | 判断 |
|---|---|
| 优点 | 权重开放、技术细节丰富、原生多模态、MoE、高度可微调 |
| 短板 | 超大模型部署仍需要高端多卡；Agent 后训练与最新闭源旗舰存在时间代差 |
| 定位 | 开放权重基础模型、企业私有化、科研和二次训练基座 |

> **核心机制：** Llama 4 的价值在于把 MoE、native multimodality、长上下文和 online RL 都以较开放的形式交给开发者，而不是单纯追求一个聊天产品的闭源上限。

官方资料：

- [The Llama 4 herd](https://ai.meta.com/blog/llama-4-multimodal-intelligence/)

---

### 1.7 Mistral：Mistral Large 3——强调 Apache 2.0 与可部署性的欧洲开放路线

Mistral Large 3 是 675B 总参数、41B 激活参数的 granular MoE 多模态模型，支持 256K 上下文，并以 Apache 2.0 发布。

#### 1.7.1 Granular MoE 的意义

“Granular”强调专家粒度较细。一般而言，在激活计算近似不变时，把大专家细分为更多小专家可以增加组合空间：

$$
\mathcal{C}(N,k)=\binom{N}{k}
$$

其中 $N$ 是专家总数，$k$ 是每 token 激活专家数。实际模型并不是简单穷举组合，但该式可以直观说明为什么细粒度专家会提高 token-to-expert 的组合容量。

#### 1.7.2 工程与定位

Mistral Large 3 同时支持 function calling、structured output、agents/conversations 和 built-in tools。其区别不在于“比所有闭源模型更强”，而在于：

- 开放权重；
- Apache 2.0；
- 欧洲企业与主权 AI 场景；
- 更容易做 on-premise / private deployment。

| 维度 | 判断 |
|---|---|
| 优点 | 许可证宽松、MoE、多模态、企业自部署友好 |
| 短板 | 公开的训练算法细节少于 DeepSeek/Qwen；前沿 Agent 能力并非其唯一卖点 |
| 定位 | 企业私有化、欧洲主权 AI、开放权重通用模型 |

官方资料：

- [Mistral Large 3](https://docs.mistral.ai/models/mistral-large-3-25-12)
- [Introducing Mistral 3](https://mistral.ai/news/mistral-3/)

---

### 1.8 DeepSeek：DeepSeek-V4——从 MLA 进一步走向“压缩 + 稀疏”的百万上下文

#### 1.8.1 规模与总体结构

DeepSeek-V4 有两个主要版本：

| 模型 | 总参数 | 激活参数 | 上下文 |
|---|---:|---:|---:|
| V4-Pro | 1.6T | 49B | 1M |
| V4-Flash | 284B | 13B | 1M |

它延续 DeepSeekMoE 和 Multi-Token Prediction，同时在 Attention、残差连接和优化器三个方向改变架构。

#### 1.8.2 CSA + HCA：不再让所有历史 token 以同样精度参加 Attention

DeepSeek-V2 的 MLA 主要压缩 K/V 表示；V4 进一步沿**序列维度**减少长上下文计算。

可以用一个抽象稀疏注意力表示：

$$
\mathcal{I}_t
=\operatorname{TopK}\left(s_\phi(q_t,K_{\le t}),k\right)
$$

$$
y_t
=\operatorname{Attn}\left(q_t,K_{\mathcal{I}_t},V_{\mathcal{I}_t}\right)
$$

其公开架构组合：

- **Compressed Sparse Attention (CSA)**：压缩序列方向的 KV，并用 sparse indexer 选择高价值历史位置；
- **Heavily Compressed Attention (HCA)**：对历史信息更重度压缩，再做 dense attention。

这反映出一个重要思路：

> **长上下文不一定要“保留全部历史 token 的完整 K/V 并逐个比较”，而可以把历史分成精确稀疏访问与压缩全局访问两个通道。**

#### 1.8.3 mHC：残差连接本身也成为可学习结构

传统 Transformer 残差近似：

$$
h_{l+1}=h_l+F_l(h_l)
$$

mHC 引入更灵活的跨流连接，并通过 manifold constraint 限制连接矩阵，使信息在深层网络中传播时更稳定。其关键不是“多一条 skip connection”，而是让残差混合具有可学习能力，同时限制其数值行为。

#### 1.8.4 Muon 与后训练

V4 使用 Muon optimizer，并在超过 32T token 上预训练。后训练采用：

```text
Base model
   ↓
多个 domain-specific experts
   ├─ SFT
   └─ GRPO
   ↓
on-policy distillation
   ↓
unified model
```

这与传统“所有能力一直混在一个 RL 阶段优化”不同：先让不同领域策略分别成长，再把 on-policy 行为蒸馏回统一模型，减少多任务 reward 互相干扰。

#### 1.8.5 优点、短板与定位

| 维度 | 判断 |
|---|---|
| 核心优势 | 1M 上下文的 Attention/KV 效率；MoE；开放权重；推理/代码/Agent |
| 架构创新 | CSA + HCA、mHC、Muon、MTP |
| 主要短板 | 1.6T 总权重仍导致部署门槛极高；Sparse Attention 需要专门 kernel/runtime |
| 主要定位 | 高效率开放前沿模型、长上下文 Agent、科研与私有化推理集群 |

> **与 DeepSeek-V2 的关系：** V2 主要解决“每个历史 token 存得太贵”；V4 则进一步解决“历史 token 太多时，即使压缩后也不能每一步都完整访问”。

官方资料：

- [DeepSeek-V4](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro)
- [DeepSeek-V4 Preview](https://deepseek.com/en/news/v4-preview/)

---

### 1.9 阿里 Qwen：Qwen3.8——Hybrid Linear Attention + 超稀疏 MoE + Agent 后训练

#### 1.9.1 当前开放模型规模

Qwen3.8-2.4T-A95B：

- 2.4T 总参数；
- 95B 激活参数；
- 92 层；
- 512 个 experts；
- 每 token 10 routed experts + 1 shared expert；
- 原生 262K，上扩约 1.01M。

最有辨识度的是它并不是“92 层全部标准 Attention”。

#### 1.9.2 Hidden Layout：3 个 Gated DeltaNet + 1 个 Gated Attention 周期

其结构为：

```text
23 × [
    Gated DeltaNet → MoE
    Gated DeltaNet → MoE
    Gated DeltaNet → MoE
    Gated Attention → MoE
]
```

Gated DeltaNet 属于线性/递推 Attention 路线。一般可以把这类结构写成：

$$
S_t=f(S_{t-1},k_t,v_t,g_t)
$$

$$
o_t=q_t^\top S_t
$$

它不显式构造 $n\times n$ 的 Attention matrix，而把历史压进固定或缓慢增长的 recurrent state $S_t$。

但纯 Linear Attention 对“精确找到很久以前某个 token”通常不如 full attention，所以 Qwen 的方案是周期性插入 Gated Attention：

> **大量 token 用线性递推高效传播，少量 full-attention 层恢复精确全局交互。**

#### 1.9.3 Qwen3 系列训练路线：从预训练到 Thinking/Agent

公开的 Qwen3 训练流程具有很高参考价值：

- 约 36T token、119 种语言；
- 分阶段数据课程：通用预训练 → STEM/代码/知识增强 → 长上下文；
- post-training：long-CoT cold start → reasoning RL → thinking/non-thinking fusion → general RL；
- general RL 覆盖包括 Agent 在内的 20+ 任务域。

Qwen 团队还提出 GSPO。与 token-level importance ratio 不同，GSPO 在序列级定义 ratio：

$$
s_i(\theta)
=\left(
\frac{\pi_\theta(y_i\mid x)}
{\pi_{\mathrm{old}}(y_i\mid x)}
\right)^{1/|y_i|}
$$

简化目标可写成：

$$
J_{\mathrm{GSPO}}
=\mathbb{E}\left[
\min\left(
 s_i A_i,
 \operatorname{clip}(s_i,1-\epsilon,1+\epsilon)A_i
\right)
\right]
$$

对长序列和 MoE RL 而言，序列级比率可以避免 token-level ratio 在长 rollout 上积累过大的方差，并改善训练稳定性。

#### 1.9.4 优点、短板与定位

| 维度 | 判断 |
|---|---|
| 核心优势 | 架构公开度高、超大 MoE、Hybrid Linear/Full Attention、多语言、Agentic |
| 工程优势 | Qwen Cloud + 开放权重 + vLLM/SGLang 生态 |
| 主要短板 | 2.4T 权重导致自主部署门槛很高；Gated DeltaNet/MoE 对推理框架要求高 |
| 主要定位 | 国产开放基础模型、复杂 Agent、代码、科研、多语言与企业私有化 |

**证据边界：** Qwen3.8 的结构参数已经公开；其完整训练 recipe 未完全公开。Qwen3 的训练方法可以解释技术路线，但不能把所有超参数原封不动套到 Qwen3.8。

官方资料：

- [Qwen3.8-2.4T-A95B](https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B)
- [Qwen3](https://qwenlm.github.io/blog/qwen3/)
- [GSPO](https://qwenlm.github.io/blog/gspo/)

---

### 1.10 智谱 GLM：GLM-5.3——基座不变，核心增量来自 Post-Training Scaling

#### 1.10.1 从 GLM-5 到 GLM-5.3：架构扩张之后，开始集中扩展后训练

GLM-5 已把基座扩展到：

- 744B 总参数；
- 40B 激活参数；
- 28.5T 预训练 token；
- 引入 DeepSeek Sparse Attention（DSA）。

GLM-5.2 随后围绕 **1M 上下文和 long-horizon task** 改造这一基座，引入 IndexShare，并加强 MTP、长程 Agentic RL 与推理基础设施。

GLM-5.3 的技术含义则不同。官方明确说明：

> **GLM-5.3 与 GLM-5.2 使用相同 base model，能力提升全部来自 post-training。**

因此不能把 GLM-5.3 理解成“又换了一套 Attention 或 MoE”。更准确的代际关系是：

```text
GLM-5
├─ 更大的 MoE 基座 + DSA
│
GLM-5.2
├─ 同代基座面向 1M context / long-horizon task 工程化
├─ IndexShare
├─ 更强 MTP speculative decoding
└─ SAO + slime Agentic RL stack
│
GLM-5.3
└─ 不改 base model
   ├─ 数十倍长程任务环境
   ├─ 更丰富的任务类型
   ├─ 更长、更大规模的后训练
   ├─ 更强环境生成与 verifier pipeline
   └─ 继续扩展 slime 上的 RL / OPD 基础设施
```

这使 GLM-5.3 成为一个很有代表性的案例：**当前前沿模型的能力增长不一定继续依赖扩大预训练基座，也可以通过大规模、环境化的后训练继续挖掘同一个基座的能力上限。**

#### 1.10.2 基座架构仍来自 GLM-5.2：DSA + IndexShare

由于 GLM-5.3 与 GLM-5.2 使用相同 base model，因此 GLM-5.2 的长上下文架构仍然是理解 GLM-5.3 的基础。

DSA 可以抽象为先用轻量 indexer 从历史 token 中选择一个稀疏集合：

$$
\mathcal{I}_t
=\operatorname{TopK}(s_\phi(q_t,K_{\le t}),k)
$$

再只对被选中的 Key/Value 做注意力：

$$
y_t
=\operatorname{Attn}(q_t,K_{\mathcal{I}_t},V_{\mathcal{I}_t})
$$

Sparse Attention 把完整历史上的 Attention 计算变成“**先找谁重要，再只计算重要部分**”。但当上下文达到 1M token 时，indexer 自己也会成为成本来源。

IndexShare 的做法是让连续四个 Transformer layer 共用一次索引结果：

```text
Layer 1: Indexer → Top-k indices I
             │
Layer 1 uses I
Layer 2 uses I
Layer 3 uses I
Layer 4 uses I
             ↓
Layer 5: new Indexer → new I
```

因此 4 层中只有第一层执行 indexer 的 dot-product 与 Top-k 操作。GLM-5.2 官方报告，在 1M context 下这一设计显著降低 indexer 的 per-token FLOPs。

这个设计的意义不只是“Sparse Attention 更快”，而是说明：**一旦 Attention 本体被稀疏化，稀疏选择本身也可能成为新的系统瓶颈。**

#### 1.10.3 MTP、IndexShare 与 KVShare：同时优化 Decode

GLM-5.2 还加强了 Multi-Token Prediction（MTP），并把 MTP 层作为 speculative decoding 的 draft model。

其基本逻辑是：

```text
Main model context
     ↓
MTP draft predicts y_{t+1:t+m}
     ↓
Main model verifies in parallel
     ├─ accept prefix
     └─ reject from first mismatch
```

同时，MTP 复用 IndexShare 与 KVShare，降低 draft model 自己的推理成本。配合 rejection sampling 和 end-to-end TV loss，GLM-5.2 官方消融实验中 MTP acceptance length 从 4.56 提升到 5.47，约增加 20%。

由于 GLM-5.3 没有更换 base model，这部分仍属于 GLM-5.3 的底层推理架构，而不是 5.3 新提出的结构创新。

#### 1.10.4 GLM-5.3 的核心：把 Post-Training 的“环境”做大

GLM-5.3 最重要的变化发生在训练目标和数据生成方式，而不是 Transformer block。

传统静态后训练可以粗略理解为从数据集 $(x,y)$ 上优化回答质量；Agentic RL 则是在可交互环境中优化完整 trajectory：

$$
J(\theta)
=
\mathbb{E}_{\mathcal{E}\sim p(\mathcal{E})}
\mathbb{E}_{\tau\sim\pi_\theta(\cdot\mid\mathcal{E})}
\left[R_{\mathcal{E}}(\tau)\right]
$$

其中：

- $\mathcal{E}$ 表示一个可执行任务环境；
- $\tau=(s_0,a_0,o_1,a_1,\ldots)$ 表示模型在环境中的完整行动轨迹；
- $R_{\mathcal{E}}(\tau)$ 不是只评价最终文本，而是评价任务是否真正完成。

GLM-5.3 主要扩大了 $p(\mathcal{E})$ 的**规模、覆盖面和难度**。官方披露，相比 GLM-5.2，训练加入了数十倍规模的长程任务环境、更丰富的任务类型和更多后训练计算。

这些环境也越来越接近真实工程工作，而不是短题目。例如一个 ML infrastructure task 可以同时包含：

```text
读取代码库 / 文档
        ↓
定位训练系统瓶颈
        ↓
修改实现
        ↓
调用集群运行实验
        ↓
读取性能结果
        ↓
继续迭代
        ↓
证明端到端 speedup 且保持 correctness
```

这类训练目标直接对应 coding Agent 或 research Agent 的真实长程工作流。

#### 1.10.5 环境生成与 Verifier：Agentic RL 的瓶颈从“模型”转向“环境”

当 RL 需要数万甚至更多真实长程任务时，手工设计环境本身会成为瓶颈。GLM-5.3 因此进一步自动化环境构造：

```text
真实工作中的任务模式
        ↓
Research Agent 收集并抽象任务
        ↓
合成为可运行 long-horizon environment
        ↓
Judge Agent 实际尝试任务
        ↓
检查任务是否可解
        ↓
合成 Verifier（不读取 reference solution）
        ↓
Oracle / No-op / Unsolved-state checks
        ↓
发现并关闭 reward shortcut
        ↓
形成可用于 RL 的 binary reward
```

这里的核心不是“让另一个 LLM 给分”，而是尽量把奖励转化成**可执行、可验证的环境反馈**。

从训练方法看，这比传统 preference model 更接近程序验证式 RL：模型只有真正改变了环境并完成目标，才应获得有效奖励。

#### 1.10.6 SAO with Compaction：让 RL 真正覆盖长轨迹

GLM-5.3 延续 GLM-5.2 的 SAO 与 compaction 路线。长程任务的一个现实问题是 trajectory 会不断增长：

$$
|\tau| \uparrow
\quad\Rightarrow\quad
\text{context cost} \uparrow,
\qquad
\text{credit assignment difficulty} \uparrow
$$

Compaction 的作用是把超长交互历史压缩成仍可继续训练的子轨迹或状态表示，使模型不需要把无限增长的原始历史完整保留在上下文中。

GLM-5.2 已公开说明，其 long-horizon RL 从 group-wise optimization 转向 critic-based PPO：不同 rollout 在 compaction 后可能产生数量和长度都不同的训练片段，因此使用 critic 估计 token-level advantage，更适合 single-rollout、variable-length 的长轨迹训练。

GLM-5.3 官方没有在发布文中重新给出 SAO 的完整算法推导，只明确说明继续使用 **SAO with compaction**。因此更稳妥的理解是：5.3 延续 5.2 已建立的长程 RL 优化机制，并把主要增量放在环境和训练规模上，而不是宣称其提出了新的 policy-gradient 基本算法。

#### 1.10.7 slime：大规模异步 Agentic RL 的训练系统

GLM-5.3 的后训练继续运行在 slime 上。其核心系统关系可以表示为：

```text
                  ┌─ Math / Code tasks
Environment pool ─┼─ Sandboxes
                  ├─ Verifiers
                  └─ Long-horizon agent environments
                          │
                          ↓
                    SGLang Rollout
                          │
                          ↓
                       Buffer
                          │
                          ↓
                  Megatron Training
                          │
                    policy update
                          └────────→ next rollout
```

slime 的关键不是某一个单独 RL loss，而是把 **training、rollout、data buffer 和异构环境** 统一到一条可扩展 dataflow 中。

GLM-5.3 又增加了几类训练系统能力：

- top-p mask；
- top-k 与 full-vocabulary OPD；
- R3-style training/rollout consistency 配置；
- 训练端与 rollout 端更严格的数值对齐；
- multi-teacher OPD 的动态 teacher switching 与 prefetch；
- 面向异步长轨迹的联合调度和 load balancing。

官方报告其 training-rollout log-probability 平均差异可以控制到 $10^{-7}$ 量级；针对 long-horizon coding RL 的系统优化使端到端训练吞吐提升超过 $2.3\times$。

这里有一个值得注意的研究问题：**大规模 RL 的效果越来越受训练—采样一致性、异步调度和环境吞吐限制，而不只是受 policy optimization 公式限制。**

#### 1.10.8 为什么同一个 Base Model 还能显著变强

如果 base model 不变，可以把 GLM-5.2 → GLM-5.3 的提升理解为策略分布继续向更有效的长程行为移动：

$$
\pi_{5.3}(a_t\mid s_t)
\neq
\pi_{5.2}(a_t\mid s_t)
$$

即使二者共享相同的预训练表示容量，5.3 通过更广泛、更长、更接近真实工作的轨迹，让模型进一步学习：

- 如何分解模糊任务；
- 如何选择和调用工具；
- 如何根据实验结果修正策略；
- 如何在数百轮行动后仍保持目标一致性；
- 如何完成端到端工程任务，而不是只生成局部代码。

这也解释了为什么 GLM-5.3 的增益在 Agent benchmark 上尤其明显。

| Benchmark | GLM-5.2 | GLM-5.3 |
|---|---:|---:|
| Terminal Bench 3.0 | 4.6 | 28.3 |
| DeepSWE v1.1 | 46.2 | 66.9 |
| Agents' Last Exam (CLI) | 23.8 | 28.5 |
| Toolathlon Verified | 59.9 | 73.0 |
| AutomationBench | 26.2 | 48.2 |

官方内部 Z.ai Code Bench 也报告 GLM-5.3 相对 GLM-5.2 提升约 50%。不过该结果来自私有 benchmark，更适合说明官方观察到的产品级增益，不能替代公开 benchmark 的独立验证。

#### 1.10.9 网络安全能力：后训练环境带来的能力涌现

GLM-5.3 的后训练加入漏洞发现数据和环境之后，能力不仅体现在“发现单个 bug”，还开始扩展到多阶段漏洞利用链推理。

代表性结果包括：

| Benchmark | GLM-5.2 | GLM-5.3 |
|---|---:|---:|
| CyberGym | 77.2 | 84.5 |
| ExploitBench | 24.4 | 54.4 |

这部分最有研究价值的地方，不是把 GLM-5.3 简单定义成“网络安全模型”，而是：**当环境分布中加入可执行、可验证的安全任务，并继续扩大 RL，模型会获得明显高于原基座的复杂行动能力。**

这说明 Agentic post-training 本身正在成为“能力塑形”的主要手段之一。

#### 1.10.10 Reasoning Effort 与当前产品形态

GLM-5.3 API 进一步显式提供：

- `low`；
- `high`；
- `max`；

三个 reasoning effort 档位，并默认使用 `max`。GLM-5.3 不再允许完全关闭 thinking。

可以把这一接口理解为给推理阶段的策略计算分配不同预算：

$$
\text{Capability}
=f(\text{base model},\text{post-training},\text{inference budget})
$$

因此同一个模型在真实 Agent 系统中的表现，已经越来越不能脱离 inference-time budget 单独评价。

截至 2026-08-22，GLM-5.3 已在官方产品和 Coding Plan 中上线；官方计划在 8 月 14 日发布后的两周完成安全评估与加固后开放模型权重，因此此时不应把“权重已经公开”写成既成事实。

#### 1.10.11 优点、短板与定位

| 维度 | 判断 |
|---|---|
| 核心优势 | 1M context、DSA/IndexShare、长程 coding/Agent 能力、同基座上大规模 post-training 增益明显 |
| 架构特点 | GLM-5.3 不更换 GLM-5.2 base model；底层仍是 MoE + DSA/IndexShare + MTP 路线 |
| 后训练特点 | 数十倍长程环境、SAO with compaction、slime 异步 RL、自动环境/Verifier 生成、OPD |
| 研究价值 | 是“固定 Base Model，通过 Agentic post-training Scaling 挖掘能力上限”的代表案例 |
| 主要短板 | 744B 级 MoE 部署门槛仍高；长程能力高度依赖复杂 rollout/environment infrastructure；5.3 权重截至 8 月 22 日尚未正式开放 |
| 主要定位 | 国产前沿 Agent/coding 基座、长程软件工程与科研任务、企业 Agent 与后训练系统研究 |

**证据边界：** GLM-5.3 官方明确说明 base model 与 GLM-5.2 相同，因此不能把 5.3 的 benchmark 提升归因于新的 Attention、MoE 或更大预训练规模。相反，它恰恰提供了一个比较少见的受控代际案例：**基座保持不变，而通过扩大后训练环境、任务种类和计算投入获得显著能力提升。** 但其内部 Z.ai Code Bench 属于私有评测；网络安全“涌现”也只能说明在当前训练环境和评测下出现了显著新能力，不能证明这种能力会无条件迁移到所有安全任务。

官方资料：

- [GLM-5.3](https://z.ai/blog/glm-5.3)
- [GLM-5.3 中文发布](https://www.zhipuai.cn/zh/research/162)
- [GLM-5.2](https://z.ai/blog/glm-5.2)
- [GLM-5](https://github.com/zai-org/GLM-5)

---

### 1.11 月之暗面 Kimi：Kimi K3——KDA + AttnRes + 极高稀疏度 LatentMoE

#### 1.11.1 当前模型结构

Kimi K3 是当前公开架构最激进的超大 MoE 模型之一：

| 项目 | Kimi K3 |
|---|---:|
| 总参数 | 2.8T |
| 激活参数 | 104B |
| 层数 | 93 |
| KDA 层 | 69 |
| Gated MLA 层 | 24 |
| Routed experts | 896 |
| 每 token 选择 | 16 |
| Shared experts | 2 |
| 上下文 | 1,048,576 |
| Vision encoder | MoonViT-V2 |

#### 1.11.2 KDA：把长历史压入递推状态

Kimi Delta Attention 属于 hybrid linear attention。概念上可以把历史压缩成状态：

$$
S_t=A_t\odot S_{t-1}+u_t v_t^\top
$$

$$
o_t=q_t^\top S_t
$$

这里的关键不是上述抽象公式的具体符号，而是：**KDA 的历史状态不需要与上下文长度线性保存完整 KV Cache。**

但 Kimi 没有完全舍弃 full attention，而是 69 个 KDA 层与 24 个 Gated MLA 层混合：

```text
长距离高效状态传播：KDA
            +
周期性精确内容检索：Gated MLA
```

与 Qwen3.8 的“Linear Attention + Full Attention”思路相似，但具体状态更新与 Attention 结构不同。

#### 1.11.3 Attention Residuals：跨深度的信息流也需要重新设计

传统 residual 只把 $h_l$ 直接送到下一层。AttnRes 的目标是让当前层能够对更早的 layer representation 进行加权读取，而不是只依赖最近一层。

从研究动机上看，这是在解决：

> 当模型深度和 MoE 稀疏度不断扩大时，“序列长度上的信息选择”之外，“网络深度上的信息选择”也会成为能力瓶颈。

#### 1.11.4 Stable LatentMoE 与 Quantile Balancing

K3 使用 896 个 routed experts，每 token 激活 16 个，同时有 2 个 shared experts。高稀疏率使专家负载变得非常敏感，因此又引入：

- Stable LatentMoE；
- Quantile Balancing；
- fully balanced expert-parallel training；
- Per-Head Muon。

Quantile Balancing 的思想是从 router score 的分位数直接估计专家分配边界，而不是不断依赖一个敏感的启发式 balancing 超参数。

#### 1.11.5 低精度训练从 SFT 阶段进入训练闭环

K3 从 SFT 起执行 quantization-aware training：

- MXFP4 weights；
- MXFP8 activations。

这说明量化不再只是模型训练完后的部署技巧，而是**训练时就让模型适应最终推理数值格式**。

#### 1.11.6 优点、短板与定位

| 维度 | 判断 |
|---|---|
| 核心优势 | 2.8T MoE、KDA、AttnRes、1M context、原生视觉、Agent/coding |
| 研究价值 | 提供超大稀疏模型、Hybrid Linear Attention、低精度训练的完整研究样本 |
| 主要短板 | 2.8T 权重部署极难；官方建议超大 accelerator domain；KDA 需要特殊缓存/runtime 支持 |
| 主要定位 | 开放前沿 Agent 模型、长程 coding/knowledge work、超大模型系统研究 |

官方资料：

- [Kimi K3](https://github.com/MoonshotAI/Kimi-K3)
- [Kimi K3 Tech Blog](https://www.kimi.com/blog/kimi-k3)

---

### 1.12 百度 ERNIE：ERNIE 5.1——Once-For-All 弹性训练 + 分离式异步 Agentic RL

#### 1.12.1 先理解 ERNIE 5.0 的“超级网络”

ERNIE 5.0 是 2.4T 级原生全模态 MoE，采用 modality-agnostic routing：专家不预先划分成“文本专家”“视觉专家”，而是由 token 特征决定路由。

更重要的是 Once-For-All Elastic Training。

传统做法：

```text
小模型 → 单独预训练
中模型 → 单独预训练
大模型 → 单独预训练
```

ERNIE 5.0 的目标则是训练一个 supernet：

$$
\mathcal{L}_{\mathrm{elastic}}
=\mathbb{E}_{a\sim\mathcal{A}}
\left[
\mathcal{L}(f_{\theta,a}(x),y)
\right]
$$

其中 $a$ 表示一个子网络配置，包括：

- depth：启用多少 Transformer 层；
- width：允许多少专家进入候选池；
- sparsity：Top-k 激活多少专家。

训练期间不断采样不同 $a$，让共享权重同时适应多个计算预算。

#### 1.12.2 ERNIE 5.1：从 supernet 中抽取更优子网络

ERNIE 5.1 并不是简单从头训练一个新模型，而是继承 5.0 的知识，从其 elastic sub-model matrix 中抽取更高效子结构：

- 总参数约压缩至 5.0 的 1/3；
- 激活参数约压缩至 1/2；
- 同时维持较强基础与 Agent 能力。

这是一条与“每代模型都继续增大”不同的路线：**先训练一个高容量超网络，再搜索/抽取合适计算预算下的子网络。**

#### 1.12.3 分离式全异步 RL

文心 5.1 的另一个关键贡献在 RL infrastructure：

```text
                  RL Controller
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
   Training       Inference      Reward
       ↑             ↓             ↑
       └──────── Agent Loop ───────┘
```

训练、rollout inference、reward、agent loop 的控制面解耦，可以独立扩缩容，并把不同类型算力放到最适合的子系统。

这对于 Agentic RL 很重要，因为 Agent rollout 的耗时极不规则：有的轨迹只推理几十秒，有的轨迹要执行代码、搜索和环境交互数分钟。如果强制同步，会出现大量 GPU 等待。

#### 1.12.4 优点、短板与定位

| 维度 | 判断 |
|---|---|
| 核心优势 | Once-For-All 弹性训练、全模态 MoE、异步 Agentic RL、中文/搜索生态 |
| 训练特点 | 用 supernet 降低多规格模型训练重复成本；训推奖 Agent loop 解耦 |
| 主要短板 | ERNIE 5.1 完整层级结构和精确参数未全部公开；旗舰权重并非像 DeepSeek/Qwen 那样开放 |
| 主要定位 | 百度搜索/知识生态、企业智能体、国产多模态与高效部署 |

官方资料：

- [ERNIE 5.1](https://ernie.baidu.com/blog/zh/posts/ernie-5.1-0508-release/)
- [ERNIE 5.0](https://ernie.baidu.com/blog/zh/posts/ernie5.0/)

---

### 1.13 字节 Seed：Seed2.1——模型架构披露有限，但明确围绕“真实环境 Agent”进行 RL

#### 1.13.1 当前定位

Seed2.1 分 Pro / Turbo，官方定位已经非常明确：**A Next-Generation Agent for Real-World Productivity**。

其能力重点包括：

- office / research tasks；
- project planning；
- file processing；
- code engineering；
- GUI + non-GUI tool use；
- image/video understanding；
- 跨工具、跨环境任务执行。

#### 1.13.2 与 DeepSeek/Qwen 的最大区别：当前内部 Backbone 没有充分公开

Seed2.1 官方没有公开：

- 总参数/激活参数；
- Transformer 层数；
- MoE/Dense；
- Attention 结构。

因此这一节的技术分析重点只能放在**Agent 后训练与动作空间**。

#### 1.13.3 GUI 与非 GUI 联合动作空间

一个现实生产力 Agent 的动作空间可以写成：

$$
\mathcal{A}
=\mathcal{A}_{\mathrm{GUI}}
\cup\mathcal{A}_{\mathrm{Tool}}
\cup\mathcal{A}_{\mathrm{Code}}
$$

其中：

- $\mathcal{A}_{\mathrm{GUI}}$：click、type、scroll、drag；
- $\mathcal{A}_{\mathrm{Tool}}$：MCP/API/function call；
- $\mathcal{A}_{\mathrm{Code}}$：执行脚本或程序。

如果一个动作既可以点 20 次 GUI 完成，也可以调用一个结构化 API 完成，理想策略应该学会在不同状态下选择更短、更可靠的路径：

$$
a_t^*=\arg\max_{a\in\mathcal{A}}
Q(s_t,a)
$$

Seed2.1 官方披露，通过 RL 让 Agent 在 GUI 与非 GUI 动作空间之间自然选择，并降低平均任务步骤数。这说明其训练目标已经直接作用到**trajectory efficiency**，而不仅是最终答案文本质量。

#### 1.13.4 优点、短板与定位

| 维度 | 判断 |
|---|---|
| 核心优势 | GUI + 工具 + coding + 多模态形成统一生产力 Agent 能力 |
| 后训练特点 | 强调真实工作流和环境反馈，而非只优化静态 benchmark |
| 主要短板 | Backbone/预训练细节公开度不足，科研可复现性弱于 Qwen/DeepSeek |
| 主要定位 | 豆包/Trae/火山引擎中的办公、coding、computer-use Agent |

官方资料：

- [Seed2.1](https://seed.bytedance.com/en/seed2_1)
- [Seed2.1 Official Release](https://seed.bytedance.com/en/blog/seed2-1-officially-released-advancing-ai-productivity)

---

### 1.14 横向总结：主流大模型真正的技术分叉在哪里

#### 1.14.1 架构层

| 厂商/模型 | Attention 主线 | FFN / 容量主线 | 多模态 | 架构公开度 |
|---|---|---|---|---|
| GPT-5.6 | 未公开 | 未公开 | 强 | 低 |
| Claude 5 | 未公开 | 未公开 | 支持视觉等 | 低 |
| Gemini 3.7 | 最新细节未完整公开；2.5 已披露 Transformer 路线 | 2.5 已披露 sparse MoE | 原生强多模态 | 中 |
| Grok 4.6 | 未公开 | 未公开 | 图像输入 | 低 |
| Llama 4 | MHA/iRoPE 长上下文路线 | Alternating Dense + MoE | early fusion | 高 |
| Mistral Large 3 | 未完全披露 | granular MoE | 多模态 | 中 |
| DeepSeek-V4 | CSA + HCA | DeepSeekMoE | 当前核心模型以文本为主 | 很高 |
| Qwen3.8 | Gated DeltaNet + Gated Attention | 512-expert MoE | API Max 扩展多模态 | 很高 |
| GLM-5.3 | DSA + IndexShare（继承 GLM-5.2 base model） | MoE | 以旗舰文本/Agent为主 | 高 |
| Kimi K3 | KDA + Gated MLA | Stable LatentMoE | 原生视觉 | 很高 |
| ERNIE 5.1 | 继承 5.0 代系 | Elastic MoE | 原生全模态代系 | 中高 |
| Seed2.1 | 未公开 | 未公开 | 强视觉/视频 | 低 |

#### 1.14.2 训练层

| 路线 | 代表模型 | 核心思想 |
|---|---|---|
| Reasoning + tool-use joint optimization | GPT-5.6 | 让模型原生适应工具与 Harness |
| Constitutional / RLAIF | Claude | 用显式原则产生 critique/preference，再强化对齐 |
| Native multimodal pretraining | Gemini、Llama、ERNIE、Kimi | 多模态进入 backbone，而不是后置模型拼接 |
| Online RL + hard-example curriculum | Llama 4 | 持续把预算集中到有学习信号的难样本 |
| Domain expert RL → on-policy distillation | DeepSeek-V4 | 专业策略分别成长，再融合成统一模型 |
| Sequence-level policy optimization | Qwen GSPO | 提高长序列/MoE RL 的稳定性 |
| Large-scale asynchronous Agentic RL | GLM、ERNIE、Grok | 用真实/模拟环境轨迹训练长程行为 |
| Elastic supernet training | ERNIE 5.x | 一次训练覆盖多个深度/专家/稀疏度子模型 |
| GUI + non-GUI action RL | Seed2.1 | 直接优化真实软件环境中的动作选择 |

#### 1.14.3 最关键的判断

现在不能再把“大模型技术路线”理解成只有 Transformer 参数扩张。更准确的演进是：

```text
2023：Dense Transformer + SFT/RLHF
                ↓
2024：MoE / 长上下文 / Reasoning
                ↓
2025：Native Multimodal + 大规模 RL + Tool Use
                ↓
2026：Hybrid/Sparse/Linear Attention
      + 超稀疏 MoE
      + Agentic RL
      + reasoning effort
      + Harness-aware training
```

因此，如果目标是**科研研究模型算法**，DeepSeek-V4、Qwen3.8、GLM-5.3、Kimi K3、ERNIE 5.x、Llama 4 的公开资料价值明显高于只看闭源模型 Benchmark；如果目标是**直接构建生产 Agent**，GPT、Claude、Gemini、Seed 等模型与其官方 Harness/工具生态的联合能力又更重要。

---

## 2. 主流智能体平台深度调研

### 2.1 先区分：Agent、Harness、Framework、Workflow、Protocol 不是同一层

这是当前 Agent 调研中最容易混乱的地方。

| 名称 | 本质 | 负责什么 |
|---|---|---|
| LLM | 决策模型 | 预测下一步文本/动作 |
| Agent | LLM + instructions + tools + loop | 根据环境反馈连续行动 |
| Agent Harness | Agent 的运行支架 | 上下文、计划、工具、沙箱、memory、审批、compaction、重试 |
| Agent Framework / SDK | 编程抽象 | 定义 Agent、tool、handoff、state、middleware |
| Workflow Runtime | 显式控制流执行器 | graph、branch、parallel、checkpoint、resume |
| Low-code Platform | 产品化开发环境 | 画布、知识库、插件、调试、部署 |
| MCP | Model ↔ Tool/Context 协议 | 把外部资源和工具以统一方式暴露给模型/Host |
| A2A | Agent ↔ Agent 协议 | 跨进程/跨框架发现与委托 Agent 任务 |

一个最小 Agent 可以表示为状态机。

定义状态：

$$
S_t=(H_t,M_t,O_t,E_t)
$$

其中：

- $H_t$：对话与 reasoning history；
- $M_t$：memory / 持久状态；
- $O_t$：工具返回的 observation；
- $E_t$：外部环境状态。

模型选择动作：

$$
a_t\sim\pi_\theta(a\mid S_t,\mathcal{T})
$$

工具执行后：

$$
o_{t+1}=\operatorname{Env}(a_t)
$$

$$
S_{t+1}=U(S_t,a_t,o_{t+1})
$$

直到：

$$
a_t=\text{Final}
$$

或达到 max iterations / budget / guardrail stop。

最小循环就是：

```text
User Goal
   ↓
LLM decides next action
   ├─ Final Answer ─────────────→ End
   │
   └─ Tool Call
          ↓
      Tool Runtime
          ↓
      Observation
          ↓
   append/update state
          └──────────────→ LLM again
```

**Agent 平台的技术差异，基本都发生在这个循环周围。**

---

### 2.2 OpenAI Agents SDK：少量 Primitive + 内置 Agent Loop

#### 2.2.1 核心抽象

OpenAI Agents SDK 刻意只保留很少的核心对象：

- `Agent`：model + instructions + tools；
- `Runner`：真正驱动 agent loop；
- `Agent as Tool`；
- `Handoff`；
- `Guardrail`；
- `Session`；
- `Tracing`；
- `SandboxAgent`。

其中 `Runner` 比 `Agent` 更关键。Agent 只是配置，Runner 才是状态转移执行器。

```text
Runner.run(input)
    ↓
Current Agent
    ↓
Model Call
    ├─ final output → stop
    ├─ function tool → execute → append ToolResult → loop
    ├─ agent-as-tool → call sub-agent → return result → loop
    └─ handoff → replace current active agent → loop
```

#### 2.2.2 Agent as Tool 与 Handoff 是两种不同多 Agent 语义

**Agents as tools：**

```text
Manager Agent
   ├─ Research Agent(...) → result
   ├─ Coding Agent(...)   → result
   └─ Manager synthesizes final answer
```

Manager 始终持有主控制权。

**Handoff：**

```text
Triage Agent
    ↓ chooses specialist
Specialist Agent becomes active
    ↓
Specialist owns remaining conversation
```

前者更接近函数调用；后者更接近**状态机切换 active policy**。

可以写成：

$$
\pi_t=\pi_{A_i}
$$

handoff 后：

$$
\pi_{t+1}=\pi_{A_j}
$$

而不是 $A_i$ 仅把 $A_j$ 当作一次工具调用。

#### 2.2.3 Guardrail：不是只在最终答案做安全检查

OpenAI SDK 区分：

- input guardrail；
- output guardrail；
- tool input/output guardrail。

尤其 tool guardrail 可以在真正产生外部 side effect 前拦截结构化调用。

```text
Model proposes tool(args)
        ↓
Tool Input Guardrail
    ├─ reject
    ├─ human approval
    └─ allow
        ↓
     Tool runs
        ↓
Tool Output Guardrail
        ↓
   Observation to model
```

这比只检查最终文本更接近生产系统需要的安全边界。

#### 2.2.4 Tracing：把 Agent Loop 显式变成可观察轨迹

SDK 的 trace hierarchy 包括：

```text
TaskSpan
  └─ AgentSpan
       └─ TurnSpan
            ├─ GenerationSpan
            ├─ FunctionSpan
            ├─ GuardrailSpan
            └─ HandoffSpan
```

这意味着 Agent 调试不再只是“看最终回答”，而是检查完整 trajectory。

#### 2.2.5 定位

| 项目 | 判断 |
|---|---|
| 抽象风格 | 轻量、code-first、少 primitive |
| 控制方式 | LLM orchestration 与 code orchestration 都支持 |
| 多 Agent | agent-as-tool + handoff |
| 状态 | Session + Runner state |
| 工具 | function、hosted tools、MCP、sandbox |
| 最适合 | OpenAI 模型上的生产 Agent、coding/research/tool agents |
| 短板 | 深度绑定 OpenAI 能力面；复杂固定业务流程用 graph runtime 更直观 |

> **核心机制：** Agents SDK 没有发明新的 Agent 算法，它的价值在于把正确的 Agent Loop、handoff、guardrail、session 和 tracing 固化成统一 runtime。

官方资料：

- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)

---

### 2.3 Anthropic Claude Agent SDK / Managed Agents：Harness-first，而不是 Workflow-first

#### 2.3.1 Claude Agent SDK 的定位

Anthropic 明确把 Claude Agent SDK 称为 **general-purpose agent harness**。它特别关注的不是画 DAG，而是：

- model/tool loop；
- context management；
- compaction；
- files/artifacts；
- shell/code environment；
- MCP；
- 长时间 autonomous execution。

因此，它和 LangGraph 的技术哲学并不相同：

```text
LangGraph：先显式定义 state transition / graph
Claude Agent SDK：先给模型一个高质量工作环境，让模型自己决定很多步骤
```

#### 2.3.2 Context Compaction

如果历史上下文为：

$$
H_t=[m_1,m_2,\ldots,m_t]
$$

直接保留全部历史最终会超过 context window。Compaction 形成摘要：

$$
\tilde{H}_t=C(H_{1:k})\oplus H_{k+1:t}
$$

其中 $C(\cdot)$ 需要尽量保留：

- architecture decisions；
- unresolved bugs；
- task state；
- critical file references；
- next actions。

这不是普通聊天摘要，而是**任务状态压缩函数**。

#### 2.3.3 Structured Artifact 作为跨 Context 的外部记忆

Anthropic 的 long-running harness 实验采用：

```text
Session 1
  ├─ implement feature
  ├─ update progress artifact
  └─ clean git state
          ↓
    context reset
          ↓
Session 2 reads
  ├─ progress artifact
  ├─ git history
  └─ current files
```

它解决的不是模型“记忆力不够”，而是**上下文窗口是临时 working memory，工程状态应该外置到 durable environment。**

#### 2.3.4 Planner–Generator–Evaluator

Anthropic 2026 的长程应用实验进一步形成：

```text
Planner
  ↓ produces product/spec artifact
Generator
  ↓ implements
Evaluator
  ↓ independently tests / critiques
Generator
  ↓ fixes if necessary
```

这里 evaluator 与 generator 分离的理由很重要：同一个 Agent 对自己刚生成的结果往往存在 self-evaluation bias。

从优化角度可以理解为：

$$
\hat{r}_{\mathrm{self}}(y)
\neq r_{\mathrm{external}}(y)
$$

独立 evaluator 的作用是提供更接近外部目标的 reward/feedback estimator。

#### 2.3.5 Managed Agents：Session 不等于 Context Window

Managed Agents 进一步把：

- session；
- harness；
- sandbox；
- model context

分离。一个 session 可以跨越多个 context window，并通过外部 state 恢复。这是长程 Agent 系统中非常关键的抽象：

> **Context 是模型一次推理看到的 token；Session 是一个任务生命周期。二者不应该绑定。**

#### 2.3.6 定位

| 项目 | 判断 |
|---|---|
| 抽象风格 | Harness-first、model-driven |
| 核心技术 | compaction、artifact memory、sandbox、MCP、long-running sessions |
| 多 Agent | planner/generator/evaluator、parallel Claude teams |
| 最适合 | coding、research、需要持续数十分钟到数小时的任务 |
| 短板 | Harness 本身可能消耗大量 token/latency；过度 scaffolding 会压制新模型能力 |

官方资料：

- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents)

---

### 2.4 Google ADK：把 Agent 与 Workflow Agent 同时做成一等公民

#### 2.4.1 Agent 类型

Google ADK 的核心类可以分为两组。

**LLM-driven：**

- `LlmAgent`：由模型决定工具和动作。

**Workflow agents：**

- `SequentialAgent`；
- `ParallelAgent`；
- `LoopAgent`。

结构上非常直观：

```text
SequentialAgent
  A → B → C

ParallelAgent
  ├→ A ─┐
  ├→ B ─┼→ join
  └→ C ─┘

LoopAgent
  A → B → condition
  ↑           │
  └───────────┘
```

这使 ADK 不必把所有控制流都交给 LLM。

#### 2.4.2 InvocationContext、Session、Event、State

ADK 的运行核心不是一个 message list，而是显式 invocation context。

可以抽象为：

$$
C_t=(\text{session},\text{state},\text{events},\text{artifacts})
$$

每一步产生 event，event 中可以携带 state delta；Runner 将这些变化写回 session。

这种 event-sourced 思路比“不断 append chat messages”更适合：

- streaming；
- tool events；
- artifact；
- 多 Agent；
- workflow observability。

#### 2.4.3 ReAct 与工具调用

Google 的默认 ADK agent template 本质上是 ReAct 风格：

```text
Observe state
   ↓
Reason / choose action
   ↓
Call tool
   ↓
Observe tool result
   ↓
Repeat
```

工具以普通 Python 函数、Google Cloud tool 或 MCP tool 暴露。

#### 2.4.4 A2A 原生化

Google 当前 Agent Platform 进一步让 Python ADK agent 可以直接通过 A2A 对外服务。这意味着多 Agent 不必都运行在一个进程中：

```text
Coordinator Service
        │ A2A
        ├────────→ Research Agent Service
        │ A2A
        ├────────→ Code Agent Service
        │ A2A
        └────────→ Validation Agent Service
```

它把“multi-agent”从 Python 对象组合提升为**分布式服务协议**。

#### 2.4.5 定位

| 项目 | 判断 |
|---|---|
| 抽象风格 | Agent + deterministic workflow 并重 |
| 核心运行态 | Runner + InvocationContext + Session/Event/State |
| 多 Agent | Sequential / Parallel / Loop + A2A |
| 工具 | Python tools、Google services、MCP |
| 最适合 | Google Cloud/Gemini 生态、分布式企业 Agent |
| 短板 | 与 Google Agent Platform/Cloud 组合时概念层较多；非 Google 部署体验不如纯框架简洁 |

官方资料：

- [Google ADK](https://google.github.io/adk-docs/)
- [Google Agents CLI](https://google.github.io/agents-cli/)

---

### 2.5 Microsoft Agent Framework：Agent + Workflow + Harness 三层明确分离

Microsoft Agent Framework 是目前对“Agent、Workflow、Harness”区分最清楚的平台之一。

#### 2.5.1 三层能力

```text
Agent
  └─ LLM-driven dynamic action selection

Workflow
  └─ Explicit graph / business process

Harness
  └─ Long multi-step autonomous work scaffolding
```

**Agent**：步骤由 LLM 动态决定。

**Workflow**：步骤与边由代码/graph 显式定义。

**Harness**：给模型增加计划、todo、context compaction、file memory、tool approval 等“持续工作支架”。

#### 2.5.2 Workflow 的 Graph Runtime

定义 workflow graph：

$$
G=(V,E)
$$

每个 executor $v_i\in V$ 接收 typed state：

$$
y_i=F_i(x_i,s_i)
$$

edge 根据输出和条件选择下一个 executor：

$$
v_{t+1}=R(y_t,E(v_t))
$$

Microsoft 的 graph workflow 支持 superstep-based parallel execution，可以理解为：在同一 superstep 中所有已 ready 的节点并行执行，完成后统一推进下一轮。

#### 2.5.3 Checkpoint

在 superstep boundary 保存：

$$
C_k=(S_k,V_k,P_k)
$$

其中包含 workflow state、executor state 和 pending information。故障后不是重新跑整个任务，而是：

$$
\operatorname{Resume}(C_k)
$$

这对于耗时数小时、包含人工审批的 workflow 非常重要。

#### 2.5.4 Harness：真正对应“Agent Harness”概念

Microsoft 2026 的 Harness 默认包含：

- planning / execute modes；
- todo tracking；
- per-service-call history persistence；
- context compaction；
- file memory / file access；
- tool approval / standing approval；
- OpenTelemetry；
- skills；
- optional background agents；
- shell / bounded looping。

因此可以把 Harness 看成：

$$
\text{Harness}
=\text{AgentLoop}
+\text{ContextManager}
+\text{Plan/Todo}
+\text{Memory}
+\text{ToolPolicy}
+\text{Observability}
$$

#### 2.5.5 定位

| 项目 | 判断 |
|---|---|
| 抽象风格 | 企业工程化、分层明确、type-safe |
| Agent | 动态 LLM loop |
| Workflow | 显式 graph、checkpoint、HITL |
| Harness | 面向 coding/research/data 等长程任务 |
| 多 Agent | sequential、concurrent、handoff、Magentic、background agents |
| 最适合 | Azure/Microsoft 企业系统、需要显式流程与审批的 Agent |
| 短板 | 能力面很大，学习成本高于轻量 SDK |

官方资料：

- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/)
- [Agent Harness](https://learn.microsoft.com/en-us/agent-framework/concepts/harness)
- [Workflows](https://learn.microsoft.com/en-us/agent-framework/workflows/)

---

### 2.6 LangGraph：把 Agent 问题重新表述为“可持久化状态图”

LangGraph 不是一个“给模型套 ReAct prompt”的库，而是一个低层 Agent orchestration runtime。

#### 2.6.1 StateGraph

最基本的抽象：

$$
G=(V,E,S)
$$

- $S$：共享状态；
- $V$：node 函数；
- $E$：edge / conditional edge。

节点不是必须是 LLM：

```text
START
  ↓
retrieve
  ↓
LLM
  ↓
should_call_tool?
  ├─ yes → tool → LLM
  └─ no  → END
```

因此 ReAct 只是 graph 的一种实例，而不是框架唯一范式。

#### 2.6.2 Persistence：每一步保存 checkpoint

LangGraph 的关键能力是 checkpointer：

$$
C_t=\operatorname{Serialize}(S_t)
$$

在每个 graph step 后保存 snapshot，并绑定 thread。由此自然得到：

- memory；
- resume；
- fault tolerance；
- human-in-the-loop；
- time travel；
- fork historical state。

这比“把 memory 放到 prompt”更严格，因为它保存的是**程序状态**，不只是语言模型上下文。

#### 2.6.3 Durable Execution 与确定性边界

如果一个 workflow 在中间暂停并重新恢复，外部 API、随机数、时间等非确定性操作不能随便重复。LangGraph Functional API 要求把这类操作包进 task 并 checkpoint 结果。

原因可以写成：

$$
F(S_t,\xi_1)\neq F(S_t,\xi_2)
$$

如果 resume 时再次采样不同随机量 $\xi$，轨迹就可能改变。把结果持久化后，相当于恢复时复用已经产生的 observation。

#### 2.6.4 Deep Agents 与 LangGraph 的关系

LangChain 当前明确区分：

```text
Deep Agents = Agent Harness
LangChain   = Agent Framework
LangGraph   = Orchestration Runtime
LangSmith   = Observability / Eval / Deployment
```

这正好说明“框架”和“Harness”不是同一个东西。

#### 2.6.5 定位

| 项目 | 判断 |
|---|---|
| 抽象风格 | state-machine / graph-first |
| 核心优势 | durable execution、checkpoint、HITL、精细控制、故障恢复 |
| 多 Agent | subgraph、supervisor、routing、并行 graph |
| 最适合 | 复杂生产 workflow、需要可恢复/可审计的 Agent 系统 |
| 短板 | 对简单 Agent 明显比直接 SDK 重；需要开发者自己设计 state schema 和 graph |

> **核心机制：** LangGraph 把“Agent 不稳定”问题的一部分转化成普通分布式系统问题：状态必须持久化，副作用必须可控，执行必须能从 checkpoint 恢复。

官方资料：

- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

---

### 2.7 AgentScope：ReActAgent + Toolkit + Plan + Multi-Agent Workflow 的模块化科研框架

AgentScope 由阿里开源，当前架构已经从早期“多智能体消息框架”演进为较完整的 Agent runtime。

#### 2.7.1 ReActAgent

其 `ReActAgent` 已集成：

- realtime steering；
- memory compression；
- parallel tool calls；
- structured output；
- MCP；
- long-term memory；
- automatic state/session management；
- planning。

基本循环仍是：

$$
a_t=\operatorname{ReAct}(S_t,\mathcal{T})
$$

但 Framework 把 reasoning、acting、observe、memory 等 hook 显式开放给开发者，因此比黑盒 Agent 产品更适合做科研实验。

#### 2.7.2 Toolkit：工具不是散落函数，而是可管理集合

Toolkit 负责：

- Python function → JSON schema；
- sync/async；
- streaming tool output；
- interrupt；
- dynamic schema；
- autonomous tool management；
- MCP tool registration。

从模型角度，一个工具就是：

$$
a_t=(\text{name},\text{arguments})
$$

Toolkit 则负责：

$$
o_{t+1}=\operatorname{ExecuteAndNormalize}(a_t)
$$

即把各种异构函数执行统一成 Agent 可消费的 observation。

#### 2.7.3 PlanNotebook：把计划变成 Agent 可调用的工具

AgentScope 的 Plan 并不是一个只存在 prompt 中的自然语言列表，而是一个有状态对象。PlanNotebook 暴露：

- create_plan；
- revise_current_plan；
- update_subtask_state；
- finish_subtask；
- recover_historical_plan 等工具。

所以 Agent 实际在做：

```text
ReActAgent
   ↓ calls create_plan(...)
PlanNotebook changes state
   ↓ returns hint
ReActAgent sees current plan state
   ↓ performs next task
```

这是一种很值得研究的 Harness 设计：**把 planning 从“prompt 技巧”变成显式状态和可调用 API。**

#### 2.7.4 多 Agent

AgentScope 官方工作流覆盖：

- concurrent agents；
- routing；
- handoff；
- conversation；
- multi-agent debate；
- MsgHub。

Router 可以由 structured output 实现：

$$
j=\arg\max_i p_\theta(A_i\mid x)
$$

也可以把各 Agent 暴露为工具，让 supervisor 通过 tool call 进行路由。

#### 2.7.5 定位

| 项目 | 判断 |
|---|---|
| 抽象风格 | Python、模块化、研究友好 |
| 单 Agent | ReActAgent 功能完整 |
| Planning | PlanNotebook 显式状态化 |
| 多 Agent | debate/routing/handoff/concurrent |
| 协议 | MCP + A2A |
| 最适合 | Agent 算法研究、多智能体实验、国产模型接入 |
| 短板 | 企业生态与托管 runtime 不如云厂商平台成熟 |

官方资料：

- [AgentScope](https://doc.agentscope.io/)
- [ReAct Agent](https://doc.agentscope.io/tutorial/task_agent.html)
- [Plan](https://doc.agentscope.io/tutorial/task_plan.html)

---

### 2.8 Dify：以显式 Workflow 为主体，Agent 只是其中一种可循环节点

Dify 更接近**LLM Application Platform**，不是一个单纯 Python Agent Framework。

#### 2.8.1 两类应用：Workflow 与 Chatflow

Dify 的核心价值是把业务流程变成可视化 graph：

```text
Start
  ↓
Parameter Extractor
  ↓
Knowledge Retrieval
  ↓
LLM
  ↓
Condition
  ├─→ Tool / HTTP
  └─→ Human / Other Node
  ↓
End
```

Workflow 面向一次性自动化；Chatflow 在 Workflow 基础上增加 conversation memory 与 streaming answer。

#### 2.8.2 Agent Node

Dify 的 Agent 可以使用：

- Function Calling；
- ReAct；
- 自定义 Agent Strategy plugin。

因此 Agent 在 Dify 中更像一个具有内部循环的特殊节点：

```text
Outer Workflow
      ↓
   Agent Node
     ├─ LLM
     ├─ Tool
     ├─ Observation
     └─ loop × N
      ↓
Outer Workflow continues
```

这和 OpenAI Agents SDK 的“整个应用本身就是 Agent loop”不同。

#### 2.8.3 Workflow 负责稳定性，Agent 负责不确定性

Dify 的设计哲学可以概括为：

> **确定性步骤用 graph 固定，不确定决策才交给 Agent。**

例如科研调研：

```text
[固定] 解析用户参数
   ↓
[固定] 检索内部知识库
   ↓
[Agent] 决定是否还需要搜索/计算
   ↓
[固定] 格式化结果
   ↓
[固定] 写入数据库/API
```

这通常比“一个全能 Agent 自己决定所有步骤”更稳定、更可调试。

#### 2.8.4 新 Agent Runtime 的 Layer/Session 思路

Dify 当前开源代码中，agent run 与 workflow run 已明确分离。一个 workflow run 可包含多个 agent run；Agent runtime 可以通过 session snapshot 恢复内部 layer state。

这说明 Dify 也在从简单 ReAct 节点向真正的**可持久化 Agent runtime**演进。

#### 2.8.5 定位

| 项目 | 判断 |
|---|---|
| 抽象风格 | low-code / visual workflow-first |
| Agent 算法 | Function Calling、ReAct、可扩展 strategy |
| RAG | 一等公民 |
| 工具 | plugin marketplace、自定义 tool、HTTP/API |
| 运行模式 | Workflow/Chatflow + Agent Node |
| 最适合 | 企业快速构建知识库、自动化、业务 Agent |
| 短板 | 做底层 Agent 算法创新不如 LangGraph/AgentScope 灵活；复杂图可能快速膨胀 |

官方资料：

- [Dify](https://github.com/langgenius/dify)
- [Dify Docs](https://docs.dify.ai/)

---

### 2.9 Coze Studio：可视化 Agent IDE，底层由 Eino/Workflow Engine 支撑

Coze Studio 是扣子平台核心引擎的开放版本，定位是一站式 Agent 可视化开发平台。

#### 2.9.1 平台组成

```text
Agent IDE
  ├─ Prompt
  ├─ Model
  ├─ Knowledge / RAG
  ├─ Memory
  ├─ Plugin / Tool
  ├─ Workflow
  ├─ Database / Variable
  └─ Publish / API / Chat SDK
```

其后端采用 Go，整体按微服务 + DDD 架构组织；Agent / Workflow runtime 的底层能力由 Eino 等组件支撑，前端 Workflow Canvas 使用 FlowGram 体系。

#### 2.9.2 Workflow 与 Agent 的关系

Coze 的 Agent 可挂接 workflow、knowledge、plugin；workflow 又可以通过 LLM、code、condition 等节点形成固定业务逻辑。

因此其控制模式和 Dify 相似：

```text
Model-driven Agent
        ↕
Tools / Plugins / Knowledge
        ↕
Deterministic Workflow
```

区别更多在工程生态与产品形态，而不是基础 Agent 算法。

#### 2.9.3 Memory

Coze Studio 明确提供面向个人用户历史交互的 memory。其意义是把：

$$
H_t=\text{current conversation}
$$

扩展成：

$$
C_t=H_t\oplus R(M,q_t)
$$

其中长期记忆 $M$ 不必全部进入上下文，而是根据当前 query 检索相关部分 $R(M,q_t)$。

#### 2.9.4 Plugin

Plugin 把外部世界封装成统一 tool。逻辑上仍然是 function schema：

```text
name
input schema
credentials
execution endpoint
output schema
```

模型不需要理解 API 的底层 HTTP 细节，只需要选择 tool 和 arguments。

#### 2.9.5 定位

| 项目 | 判断 |
|---|---|
| 抽象风格 | Visual Agent IDE / low-code |
| 核心能力 | prompt、RAG、plugin、workflow、memory、publish |
| 底层工程 | Go + microservices + DDD；Eino/FlowGram 生态 |
| 最适合 | 快速 Agent 产品原型、企业应用、面向非专业开发者 |
| 短板 | 深度自定义运行时不如 code-first framework；商业版与开源版能力需区分 |

官方资料：

- [Coze Studio](https://github.com/coze-dev/coze-studio)

---

### 2.10 MCP：不是 Agent Framework，而是 Model/Host 与外部工具之间的协议

MCP 的出现解决的是另一个问题：如果每个 Agent Framework 都为 GitHub、数据库、文件系统、浏览器各写一套 connector，生态会发生 $N\times M$ 集成爆炸。

#### 2.10.1 Host–Client–Server

MCP 使用：

```text
          Host Application
       (Claude Code / IDE / Agent)
          │          │
       Client A   Client B
          │          │
       MCP Server  MCP Server
       Filesystem    DB/GitHub
```

Host：

- 控制权限；
- 管理多个 client；
- 决定哪些 server 可见；
- 把结果加入模型上下文。

MCP Server 暴露的核心对象包括：

- tools；
- resources；
- prompts；
- 以及协议扩展能力。

#### 2.10.2 Tool 与 Resource 的区别

**Tool：产生动作/计算。**

$$
o=f_{tool}(args)
$$

**Resource：提供可读取上下文。**

$$
c=\operatorname{Read}(uri)
$$

把两者分开很重要：读取一份文档和执行“删除数据库行”不应该拥有相同权限语义。

#### 2.10.3 MCP 不负责 Agent 的计划

MCP 只解决：

> “模型/Host 如何标准化地发现、读取和调用外部能力？”

它不负责：

- Agent 是否使用 ReAct；
- 什么时候调用 tool；
- 多 Agent 如何协作；
- workflow 是否有 checkpoint。

所以 MCP 不能替代 LangGraph、Agents SDK、AgentScope 等 Framework。

官方资料：

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)

---

### 2.11 A2A：不是“另一个 MCP”，而是跨 Agent 服务的任务协议

MCP 连接 Agent 与工具；A2A 连接 Agent 与 Agent。

```text
MCP:
Agent ───→ Tool / Data Source

A2A:
Agent Service A ───→ Agent Service B
```

#### 2.11.1 A2A 的核心对象不是函数，而是 Task

A2A 把跨 Agent 工作建模成：

$$
\text{Task}=(id,contextId,status,history,artifacts)
$$

Task 有生命周期，可以：

- submitted / working；
- input-required；
- completed；
- failed / canceled / rejected。

输出不只是一个字符串，而可以是 Artifact：

```text
Task
  ├─ status
  ├─ history
  └─ artifacts
       ├─ report.md
       ├─ result.json
       └─ image.png
```

这比把远程 Agent 当成普通 function call 更适合长程任务。

#### 2.11.2 Transport

A2A 当前规范支持基于 HTTP(S) 的多种绑定，包括 JSON-RPC、gRPC、HTTP+JSON/REST；流式结果可以通过 SSE/gRPC streaming 返回。

因此远程 Agent 可以持续报告：

- status update；
- artifact update；
- clarification request。

#### 2.11.3 MCP 与 A2A 的根本区别

| 维度 | MCP | A2A |
|---|---|---|
| 对端 | Tool / context server | Autonomous agent service |
| 核心抽象 | Tool、Resource、Prompt | AgentCard、Message、Task、Artifact |
| 生命周期 | 多数是请求/响应工具调用 | 可长时间运行的有状态 Task |
| 谁做规划 | Host/Agent | 远程 Agent 自己可以继续规划 |
| 典型用途 | 文件、数据库、API、IDE 工具 | 跨团队/跨服务的 specialist agents |

官方资料：

- [A2A Protocol](https://a2a-protocol.org/)

---

### 2.12 横向总结：不同 Agent 平台到底差在哪里

#### 2.12.1 技术层级比较

| 平台 | 主要抽象层 | Agent Loop | 显式 Workflow | Durable State | 多 Agent | MCP | A2A |
|---|---|---|---|---|---|---|---|
| OpenAI Agents SDK | SDK/runtime | 内置 | 代码编排 | Session | agent-as-tool / handoff | 是 | 可通过外部集成 |
| Claude Agent SDK | Harness | 内置 | 非主要抽象 | compaction/artifact/session | planner/generator/evaluator 等 | 核心生态 | 非核心 |
| Google ADK | Framework + runtime | 内置 | Seq/Parallel/Loop | Session/Event/State | 原生 | 是 | 强 |
| Microsoft Agent Framework | Agent + Workflow + Harness | 内置 | 强 graph/functional workflow | checkpoint/session | 多种 orchestration | 是 | 是 |
| LangGraph | Orchestration runtime | 自定义/预构建 | 强 StateGraph | checkpoint/thread | subgraph/supervisor | 可接 | 可接 |
| AgentScope | Agent framework | ReActAgent | Python workflow/pipeline | state/session/memory | debate/routing/handoff | 强 | 是 |
| Dify | Low-code platform | Agent node 内部 | 强 visual workflow | workflow/agent session | 通过 workflow/agent | 是/插件生态 | 取决于集成 |
| Coze Studio | Visual Agent IDE | Agent runtime | 强 visual workflow | conversation/memory | 平台编排 | 插件/协议接入 | 取决于部署 |

#### 2.12.2 从“谁控制下一步”看，平台可以分成三派

**第一类：Model-driven Harness**

代表：OpenAI Agents SDK、Claude Agent SDK。

$$
a_t\sim\pi_\theta(a\mid S_t)
$$

大部分下一步由模型决定，Harness 负责给模型安全、稳定的执行环境。

优势：灵活、自然、适合开放任务。

缺点：轨迹难预测，模型能力不足时容易跑偏。

**第二类：Graph/Workflow-driven**

代表：LangGraph、Microsoft Workflow、Dify Workflow。

$$
v_{t+1}=R(v_t,S_t)
$$

下一步主要由 graph、condition 或代码决定，Agent 只是某些 node。

优势：可控、可审计、容易 checkpoint。

缺点：业务变化时 graph 维护成本增加，自主性低。

**第三类：Hybrid**

代表：Google ADK、AgentScope、Microsoft 全栈、Coze Studio。

```text
Deterministic outer workflow
        ↓
Model-driven local agent loop
        ↓
Deterministic validation / routing
```

这通常是生产系统最合理的结构：**把确定性留给代码，把真正需要语义判断的部分交给模型。**

#### 2.12.3 Agent Harness 的最小完整组成

经过上述平台对比，可以把一个生产级 Agent Harness 抽象为：

$$
\mathcal{H}
=(C,P,T,M,E,G,R,O)
$$

其中：

- $C$：Context Manager；
- $P$：Plan / Todo / Progress；
- $T$：Tool Runtime；
- $M$：Memory / State；
- $E$：Execution Environment / Sandbox；
- $G$：Guardrail / Approval；
- $R$：Retry / Resume / Loop Control；
- $O$：Observability / Trace。

模型本身只实现：

$$
\pi_\theta(a_t\mid S_t)
$$

真正决定 Agent 是否能稳定工作数十分钟甚至数小时的，往往是 Harness 是否能持续构造高质量 $S_t$。

这也解释了为什么同一个模型在不同 coding agent、research agent 或 benchmark harness 中可以出现明显不同的最终成功率：**最终系统是 Model × Harness 的乘积，而不是只由模型权重决定。**

---

## 参考资料

### 大模型

1. OpenAI. [GPT-5.6](https://openai.com/index/gpt-5-6/).
2. OpenAI. [How GPT-5.6 fuses frontier intelligence with frontier efficiency](https://openai.com/index/gpt-5-6-frontier-intelligence-efficiency/).
3. Anthropic. [Claude Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5).
4. Anthropic. [Engineering](https://www.anthropic.com/engineering).
5. Google DeepMind. [Gemini 3.7 Flash Model Card](https://deepmind.google/models/model-cards/gemini-3-7-flash/).
6. xAI. [Introducing Grok 4.6](https://x.ai/news/grok-4-6).
7. Meta AI. [The Llama 4 herd](https://ai.meta.com/blog/llama-4-multimodal-intelligence/).
8. Mistral AI. [Introducing Mistral 3](https://mistral.ai/news/mistral-3/).
9. DeepSeek-AI. [DeepSeek-V4](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro).
10. Qwen Team. [Qwen3.8-2.4T-A95B](https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B).
11. Qwen Team. [Qwen3](https://qwenlm.github.io/blog/qwen3/).
12. Qwen Team. [GSPO](https://qwenlm.github.io/blog/gspo/).
13. Z.ai. [GLM-5.3](https://z.ai/blog/glm-5.3).
14. Z.ai. [GLM-5.2](https://z.ai/blog/glm-5.2).
15. Moonshot AI. [Kimi K3](https://github.com/MoonshotAI/Kimi-K3).
16. Baidu ERNIE. [ERNIE 5.1](https://ernie.baidu.com/blog/zh/posts/ernie-5.1-0508-release/).
17. ByteDance Seed. [Seed2.1](https://seed.bytedance.com/en/seed2_1).

### Agent / Harness / Protocol

18. OpenAI. [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/).
19. Anthropic. [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
20. Anthropic. [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps).
21. Google. [Agent Development Kit](https://google.github.io/adk-docs/).
22. Microsoft. [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/).
23. Microsoft. [Agent Harness](https://learn.microsoft.com/en-us/agent-framework/concepts/harness).
24. LangChain. [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview).
25. AgentScope. [Documentation](https://doc.agentscope.io/).
26. Dify. [GitHub](https://github.com/langgenius/dify).
27. Coze. [Coze Studio](https://github.com/coze-dev/coze-studio).
28. Model Context Protocol. [MCP](https://modelcontextprotocol.io/).
29. Agent2Agent Protocol. [A2A](https://a2a-protocol.org/).
