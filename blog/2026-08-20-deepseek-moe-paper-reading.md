---
title: "论文精读：DeepSeekMoE——迈向混合专家语言模型的终极专业化"
description: "梳理 DeepSeekMoE 的细粒度专家分割、共享专家隔离、负载均衡策略，以及从 2B 到 145B 规模的实验结论。"
slug: /2026/08/20/deepseek-moe-paper-reading
date: 2026-08-20
authors: [ymt]
tags: [research-log]
---

DeepSeekMoE 试图解决传统混合专家模型中的知识混杂与知识冗余问题。它通过细粒度专家分割和共享专家隔离，让路由组合更加灵活，并让不同专家承担更明确的知识分工。

这篇笔记梳理论文的架构设计、负载均衡策略、关键实验与扩展结果，并记录我对“专家专业化”这一核心概念的理解。

<!-- truncate -->

## 论文概况

### 论文信息

- 论文：[DeepSeekMoE: Towards Ultimate Expert Specialization in Mixture-of-Experts Language Models](https://arxiv.org/abs/2401.06066)
- 作者：Damai Dai 等（DeepSeek-AI）
- arXiv：2401.06066
- 首次提交：2024-01-11
- 阅读日期：2026-08-20

论文提出了基于 MoE 模型的 DeepSeekMoE 架构，目的是实现语言模型的专家专业化。论文通过细粒度的专家分割和共享专家的隔离，实现了相比主流 MoE 架构（GShard）显著更高的专家专业化和性能。



### 摘要

在大语言模型时代，混合专家架构（Mixture-of-Experts, MoE）是一种有发展前景的架构，用于在扩展模型规模时控制计算成本。然而，传统的 MoE 架构如 GShard，从 $N$ 个专家中激活 Top-$K$ 个，面临着确保专家专业化的问题，即让每个专家学习到非重叠且专注的知识。

为此，我们提出的DeepSeekMoE架构，旨在实现最终的专家专业化。其主要包含两个核心设计策略：1）精细化专家的划分：将专家划分为 mN 个，并从中激活 mK 个，从而实现更灵活的激活专家组合。2）隔离 Ks 个专家作为共享专家，旨在学习共同知识从而减少路由专家的冗余。

本文从参数规模为2B的模型开始实验，证明了DeepSeekMoE架构下的2B模型能够达到与GShard 2.9B模型相同的表现，并表明了DeepSeekMoE 2B几乎接近MoE模型的性能上限。

接下来，我们将DeepSeekMoE扩展到训练16B模型，并显示仅需要40%的计算量，就能达到LLaMA2 7B模型相当的性能。我们还进行了将DeepSeekMoE扩展到145B模型的初步努力，突显了其相对于GShard架构的持续优势（随着参数量的提升），并显示其性能与DeepSeek 67B相当（仅仅需要28.5%的计算量）。



### 核心概念

#### 1. 文中的专家（experts）是什么？

专家不是系统，也不是独立的模型，而是结构上等同于一个标准FFN的子网络（两层线性变换+激活），数学专家并不是指擅长数学的智能体，而是经过训练后对数学类token的输出更有用的模型参数。

#### 2. 路由专家（routed experts）是什么？

每个token的隐藏状态u会经过一个路由器（可学习的门控，就是公式里的s = Softmax(uᵀ·eᵢ)），一个线性打分器），对所有专家打分，选出分值最高的若干个。**被路由动态选中的那部分专家就叫路由专家**（这个角色并不是一个固定的子集，同一个token每次经过不同层，选中的专家都可能不同）。

#### 3. 共享专家（shared experts）

绕过路由器，每个token都必须无条件经过的专家。

所以一个完整的DeepSeekMoE层= Ks 个常开的共享专家 + (mN − Ks) 个可路由的专家，其中每个 token 再激活 mK − Ks 个路由专家

#### 4. Dense model

Dense指的是“标准Transformer”：每个token前向传播时，模型的所有参数都参与计算。所以dense模型的总参数量 = 激活参数量。

与之对应的是MoE（稀疏激活）。一个总参数量为2B 的模型，激活参数量可能只有0.3B。

#### 5. MoE 只替换 FFN，不替换注意力

FFN是逐token独立计算的（每个token走哪条路FFN互不影响），天然适合做“按token路由”；FFN是参数大头，占每层参数的2/3，稀疏化收益最大；而注意力是**跨token**的信息交换，没法按token条件化地省计算。



## 1. 引言

**1.** 近期的研究与实践已经实证表明：在训练数据充足的条件下，通过增加参数量和计算预算来缩放（scale）语言模型，可以显著增强模型能力（Brown et al. 2020；OpenAI 2023；Touvron et al. 2023a；Hoffmann et al. 2022）。然而，必须认识到，将模型缩放至极大规模的努力也伴随着极其高昂的计算成本。鉴于这一高昂成本，混合专家（Mixture-of-Experts，MoE）架构（Jacobs et al. 1991；Jordan and Jacobs 1994；Shazeer et al. 2017）已成为一种流行的解决方案。它能够在扩大参数规模的同时，将计算成本维持在较低水平。

**2.** 近期，MoE 架构在 Transformer（Vaswani et al. 2017）中的应用已经取得了将语言模型规模化到可观规模的诸多成功尝试（Fedus et al. 2021；Lepikhin et al. 2021；Du et al. 2022；Zoph 2022），并伴随出色的性能表现。这些成果彰显了 MoE 语言模型巨大的潜力与前景。

**3.** 尽管 MoE 架构潜力可观，但现有的 MoE 架构可能存在**知识混杂**（knowledge hybridity）与**知识冗余**（knowledge redundancy）的问题，这限制了专家专业化（expert specialization）——即每个专家习得互不重叠、聚焦明确的知识。

**4.** 传统 MoE 架构用 MoE 层替换 Transformer 中的前馈网络（FFN）。每个 MoE 层由多个专家组成，每个专家在结构上与标准 FFN 完全相同，每个 token 被分配给一个（Fedus et al. 2021）或两个（Lepikhin et al. 2021）专家。这种架构暴露出两个潜在问题：

**（1）知识混杂**：现有 MoE 实践通常采用数量有限的专家（如 8 或 16 个），因此被分配到某个特定专家的 token 很可能会涵盖多种多样的知识。其结果是，该专家倾向于在自己的参数中"拼装"截然不同的知识类型，而这些知识难以被同时利用。

**（2）知识冗余**：被分配到不同专家的 token 可能需要某些公共知识。其结果是，多个专家可能会在各自的参数中趋同地习得这些共享知识，从而导致专家参数出现冗余。

**5.** 这些问题共同妨碍了现有 MoE 实践的专家专业化，使其无法达到 MoE 模型的理论上界（upper-bound）性能。

**6.** 针对上述问题，我们提出了 **DeepSeekMoE**——一种专为达成终极专家专业化而设计的创新型 MoE 架构。我们的架构包含两大核心策略：

**（1）细粒度专家分割（Fine-Grained Expert Segmentation）**：在保持参数量不变的前提下，我们通过拆分 FFN 的中间隐藏维度，将专家分割为更细的粒度。相应地，在保持计算成本不变的前提下，我们也激活更多细粒度的专家，以实现对激活专家更灵活、更具适应性的组合。细粒度专家分割使得多样化的知识能够被更精细地分解，并更精准地分布到不同专家中学习，从而使每个专家保持更高的专业化水平。此外，激活专家组合灵活性的提升，也有助于更准确、更有针对性地获取知识。

**（2）共享专家隔离（Shared Expert Isolation）**：我们隔离出若干专家作为始终激活的共享专家，旨在捕获并整合不同上下文中的公共知识。通过将公共知识压缩进这些共享专家，其他路由专家之间的冗余将得到缓解。这有助于提升参数效率，并确保每个路由专家通过专注于各自的独特方面而保持专业化。

**7.** DeepSeekMoE 的这些架构创新，为训练一个参数高效、且每个专家都高度专业化的 MoE 语言模型提供了可能。

**8.** 我们从 2B 参数的适中规模起步，验证 DeepSeekMoE 架构的优势。我们在覆盖多种任务的 12 个零样本或少样本基准上进行了评测。实证结果表明，DeepSeekMoE 2B 大幅超越 GShard 2B（Lepikhin et al. 2021），甚至追平了 GShard 2.9B——一个专家参数与计算量均为其 1.5 倍的更大的 MoE 模型。值得注意的是，我们发现 DeepSeekMoE 2B 几乎逼近其同等参数量稠密对应模型（dense counterpart）的性能，而后者构成了 MoE 语言模型的严格上界。

**9.** 为了获得更深入的理解，我们对 DeepSeekMoE 的专家专业化开展了细致的消融研究与分析。这些研究验证了细粒度专家分割与共享专家隔离的有效性，并为"DeepSeekMoE 能够实现高水平的专家专业化"这一论断提供了实证支持。

**10.** 依托我们的架构，我们随后将模型参数扩展到 16B，并在包含 2T tokens 的大规模语料上训练了 DeepSeekMoE 16B。评测结果显示，DeepSeekMoE 16B 仅用约 40% 的计算量，就达到了与 DeepSeek 7B（DeepSeek-AI 2024）——一个在同一 2T 语料上训练的稠密模型——相当的性能。我们还将 DeepSeekMoE 与开源模型进行了对比，评测表明 DeepSeekMoE 16B 以很大的优势持续胜过激活参数相近的模型，并达到了与 LLaMA2 7B（Touvron et al. 2023b）相当的性能，而后者拥有约 2.5 倍的激活参数。图 1 展示了在 Open LLM Leaderboard¹ 上的评测结果。

**11.** 此外，我们进行了用于对齐的监督微调（SFT），将模型转化为对话模型。评测结果表明，在对话场景下，DeepSeekMoE Chat 16B 同样达到了与 DeepSeek Chat 7B 和 LLaMA2 SFT 7B 相当的性能。

**12.** 受这些结果的鼓舞，我们进一步开展了将 DeepSeekMoE 扩展到 145B 的初步尝试。实验结果持续验证了其相对于 GShard 架构的显著优势。此外，它仅用 28.5%（甚至可能只有 18.2%）的计算量，就展现出与 DeepSeek 67B 相当的性能。

**13.** 我们的贡献总结如下：

- **架构创新**：我们提出了 DeepSeekMoE，一种以达成终极专家专业化为目标的新型 MoE 架构，采用了细粒度专家分割与共享专家隔离两大核心策略。
- **实证验证**：我们开展了大量实验以实证检验 DeepSeekMoE 架构的有效性。实验结果验证了 DeepSeekMoE 2B 具有高水平的专家专业化，并表明 DeepSeekMoE 2B 已接近 MoE 模型的上界性能。
- **可扩展性**：我们将 DeepSeekMoE 扩展到 16B 规模进行训练，并证明 DeepSeekMoE 16B 仅用约 40% 的计算量即可达到与 DeepSeek 7B 和 LLaMA2 7B 相当的性能。我们还开展了将 DeepSeekMoE 扩展到 145B 的初步尝试，凸显了其相对于 GShard 架构的一致优势，并展现出与 DeepSeek 67B 相当的性能。
- **MoE 的对齐能力**：我们成功地对 DeepSeekMoE 16B 进行了监督微调，构建出对齐的对话模型，展示了 DeepSeekMoE 16B 的适应性与多面性。
- **公开发布**：秉承开放研究的精神，我们向公众发布了 DeepSeekMoE 16B 的模型权重。值得一提的是，该模型无需量化即可部署在单张 40GB 显存的 GPU 上。

> ¹ Open LLM Leaderboard：https://huggingface.co/spaces/HuggingFaceH4/open_llm_leaderboard（原文脚注）



## 2. 前置知识：Transformer 中的混合专家

### 2.1 标准 Transformer 块

我们首先介绍 Transformer 语言模型中常用的一种通用 MoE 架构。

标准 Transformer 语言模型由 $L$ 层标准 Transformer 块堆叠而成，其中每个块可以表示如下：

$$
\mathbf{u}_{1:T}^{l} = \operatorname{Self-Att}\left( \mathbf{h}_{1:T}^{l-1} \right) + \mathbf{h}_{1:T}^{l-1}
\tag{1}
$$

$$
\mathbf{h}_{t}^{l} = \operatorname{FFN}\left( \mathbf{u}_{t}^{l} \right) + \mathbf{u}_{t}^{l}
\tag{2}
$$



为简洁起见，我们在上述公式中省略了层归一化（LayerNorm）操作。

### 2.2 通用 MoE 层

构造 MoE 语言模型的一种典型做法是：按指定的间隔（specified intervals），将 Transformer 中的 FFN 替换为 MoE 层（Fedus et al. 2021；Lepikhin et al. 2021；Du et al. 2022；Zoph 2022）。一个 MoE 层由多个专家组成，每个专家在结构上与标准 FFN 完全相同。之后，每个 token 将被分配给一个（Fedus et al. 2021）或两个（Lepikhin et al. 2021）专家。

如果第 $l$ 个 FFN 被替换为 MoE 层，那么其输出隐藏状态 $\mathbf{h}_{t}^{l}$ 的计算可表示为：

$$
\mathbf{h}_{t}^{l} = \sum_{i=1}^{N} \left( g_{i,t} \, \operatorname{FFN}_{i}\left( \mathbf{u}_{t}^{l} \right) \right) + \mathbf{u}_{t}^{l}
\tag{3}
$$

$$
g_{i,t} =
\begin{cases}
s_{i,t}, & s_{i,t} \in \operatorname{Topk}\left( \left\{ s_{j,t} \mid 1 \le j \le N \right\}, \, K \right) \\
0, & \text{其他情况}
\end{cases}
\tag{4}
$$

$$
s_{i,t} = \operatorname{Softmax}_{i} \left( {\mathbf{u}_{t}^{l}}^{\top} \mathbf{e}_{i}^{l} \right)
\tag{5}
$$



注意，$g_{i,t}$ 是稀疏的，这意味着 $N$ 个门控值中只有 $K$ 个非零。这种稀疏性保证了 MoE 层内的计算效率，即每个 token 只会被分配到 $K$ 个专家中完成计算。同样地，为简洁起见，我们在上述公式中省略了层归一化操作。



## 3. DeepSeekMoE 架构

在第 2 节概述的通用 MoE 架构之上，我们提出 DeepSeekMoE——一种专门为发掘专家专业化潜力而设计的架构。如图 2 所示，我们的架构包含两大核心策略：**细粒度专家分割**与**共享专家隔离**。这两大策略都旨在提升专家专业化的水平。

![DeepSeekMoE 的细粒度专家分割与共享专家隔离架构](/img/notes/llm-agents/deepseek-moe/architecture.png)

### 3.1 细粒度专家分割

当专家数量有限时，被分配到某个特定专家的 token 更可能涵盖多种多样的知识。其结果是，该专家将倾向于在自己的参数中学习截然不同的知识类型，而这些知识难以被同时利用。然而，如果每个 token 可以被路由到更多的专家，多样化的知识就有潜力被分解开来，并在不同的专家中分别学习。在此情形下，每个专家仍能保持较高的专业化水平，从而促使知识在专家之间形成更聚焦的分布。

为实现这一目标，在保持专家参数量和计算成本不变的前提下，我们对专家进行更细粒度的分割。更细粒度的专家分割使得激活专家的组合更加灵活、更具适应性。具体而言，在图 2(a) 所示的典型 MoE 架构基础上，我们通过将 FFN 的**中间隐藏维度缩减为原来的 $1/m$**，把每个专家 FFN 分割成 $m$ 个更小的专家。由于每个专家变小了，为保持计算成本不变，我们相应地把激活专家数增加到 $m$ 倍，如图 2(b) 所示。

采用细粒度专家分割后，MoE 层的输出可表示为：

$$
\mathbf{h}_{t}^{l} = \sum_{i=1}^{mN}\left(g_{i,t}\,\operatorname{FFN}_{i}(\mathbf{u}_{t}^{l})\right) + \mathbf{u}_{t}^{l}
\tag{6}
$$

$$
g_{i,t} =
\begin{cases}
s_{i,t}, & s_{i,t} \in \operatorname{Topk}\left( \left\{ s_{j,t} \mid 1 \le j \le mN \right\}, \, mK \right) \\
0, & \text{其他情况}
\end{cases}
\tag{7}
$$

$$
s_{i,t} = \operatorname{Softmax}_{i}\left( {\mathbf{u}_{t}^{l}}^{\top} \mathbf{e}_{i}^{l} \right)
\tag{8}
$$

其中，专家参数总量等于 $N$ 倍标准 FFN 的参数数量，$mN$ 表示细粒度专家的总数。采用细粒度专家分割策略后，非零门控的数量也增加到 $mK$。

从组合学的角度来看，细粒度专家分割策略显著增强了激活专家的组合灵活性。举一个例子来说明：考虑 $N=16$ 的情形。典型的 top-2 路由策略可以产生 $\binom{16}{2}=120$ 种可能的组合；相比之下，如果将每个专家分割为 4 个更小的专家，细粒度路由策略可以产生 $\binom{64}{8}=4{,}426{,}165{,}368$ 种可能的组合。组合灵活性的激增，提升了实现更准确、更具针对性的知识获取的潜力。

### 3.2 共享专家隔离

在传统路由策略下，被分配到不同专家的 token 可能需要某些公共知识或信息。其结果是，多个专家可能在各自的参数中趋同地习得这些共享知识，从而导致专家参数冗余。然而，如果有专门的共享专家负责捕获并整合不同上下文中的公共知识，其他路由专家之间的参数冗余将得到缓解。这种冗余的缓解将有助于构建参数更高效、专家更专业化的模型。

为实现这一目标，在细粒度专家分割策略的基础上，我们进一步隔离出 $K_s$ 个专家作为共享专家。**无论路由器模块如何决策，每个 token 都会被确定性地分配给这些共享专家**。为保持计算成本恒定，其他路由专家中被激活的专家数量将相应减少 $K_s$ 个，如图 2(c) 所示。

融入共享专家隔离策略后，完整 DeepSeekMoE 架构中的 MoE 层可表示为：

$$
\mathbf{h}_{t}^{l} = \sum_{i=1}^{K_{s}}\operatorname{FFN}_{i}(\mathbf{u}_{t}^{l}) + \sum_{i=K_{s}+1}^{mN}\left(g_{i,t}\,\operatorname{FFN}_{i}(\mathbf{u}_{t}^{l})\right) + \mathbf{u}_{t}^{l}
\tag{9}
$$

$$
g_{i,t} =
\begin{cases}
s_{i,t}, & s_{i,t} \in \operatorname{Topk}\left( \left\{ s_{j,t} \mid K_{s}+1 \le j \le mN \right\}, \, mK - K_{s} \right) \\
0, & \text{其他情况}
\end{cases}
\tag{10}
$$

$$
s_{i,t} = \operatorname{Softmax}_{i}\left( {\mathbf{u}_{t}^{l}}^{\top} \mathbf{e}_{i}^{l} \right)
\tag{11}
$$

最后，在 DeepSeekMoE 中：共享专家的数量为 $K_s$，路由专家的总数为 $mN - K_s$，非零门控的数量为 $mK - K_s$。

值得注意的是，共享专家隔离的原型可归功于 **Rajbhandari et al. 2022**。关键区别在于：他们是从**工程角度**提出这一策略，而我们是从**算法角度**出发。

### 3.3 负载均衡考量

自动学习的路由策略可能会遇到负载不均衡的问题，这一问题表现出两个明显的缺陷。**其一**，存在**路由崩溃**（routing collapse，Shazeer et al. 2017）的风险，即模型总是只选择少数几个专家，导致其他专家无法得到充分的训练。**其二**，如果专家分布在多台设备上，负载不均衡会加剧计算瓶颈。

#### 专家级均衡损失（Expert-Level Balance Loss）

为降低路由崩溃的风险，我们还采用了专家级均衡损失。该均衡损失的计算如下：

$$
\mathcal{L}_{\mathrm{ExpBal}} = \alpha_{1}\sum_{i=1}^{N'} f_{i} P_{i}
\tag{12}
$$

$$
f_{i} = \frac{N'}{K'T}\sum_{t=1}^{T}\mathds{1}\left( \text{token } t \text{ 选择了专家 } i \right)
\tag{13}
$$

$$
P_{i} = \frac{1}{T}\sum_{t=1}^{T}s_{i,t}
\tag{14}
$$

其中，$\alpha_1$ 是名为**专家级均衡因子**的超参数；为简洁起见，$N'$ 等于 $(mN - K_s)$，$K'$ 等于 $(mK - K_s)$；$\mathds{1}(\cdot)$ 表示指示函数。

#### 设备级均衡损失（Device-Level Balance Loss）

除专家级均衡损失外，我们还引入了设备级均衡损失。当目标是缓解计算瓶颈时，没有必要在专家层面施加严格的均衡约束，因为对负载均衡的过度约束会损害模型性能。相反，我们的首要目标是确保设备之间的计算均衡。如果将全部路由专家划分为 $D$ 组 $\{\mathcal{E}_{1}, \mathcal{E}_{2}, \ldots, \mathcal{E}_{D}\}$，并将每组部署在一台设备上，那么设备级均衡损失的计算如下：

$$
\mathcal{L}_{\mathrm{DevBal}} = \alpha_{2}\sum_{i=1}^{D} f'_{i} P'_{i}
\tag{15}
$$

$$
f'_{i} = \frac{1}{|\mathcal{E}_{i}|}\sum_{j\in\mathcal{E}_{i}} f_{j}
\tag{16}
$$

$$
P'_{i} = \sum_{j\in\mathcal{E}_{i}} P_{j}
\tag{17}
$$

其中，$\alpha_2$ 是名为**设备级均衡因子**的超参数。在实践中，我们设置一个较小的专家级均衡因子以降低路由崩溃的风险，同时设置一个较大的设备级均衡因子，以促进设备之间的计算均衡。



## 4. 验证实验

### 4.1 实验设置

**训练数据与分词（4.1.1）**：从 DeepSeek-AI 自建的多语言语料（以中英为主，含网页、数学、代码、文献等）中采样 **100B tokens**；用 HuggingFace Tokenizer 训练 BPE 分词器，**词表 8K**。

**基础设施（4.1.2）**：基于自研的 HAI-LLM 训练框架，整合了张量并行、ZeRO 数据并行、流水线并行和**专家并行**；用 CUDA/Triton 自研了门控算法和专家间线性层融合的 GPU kernel；集群为 NVIDIA A100/H800，节点间 InfiniBand 互联。

**模型配置（4.1.3，关键数字）**：

| 项       | 配置                                                         |
| -------- | ------------------------------------------------------------ |
| 结构     | 9 层 Transformer，hidden 1280，10 头 × 128 维                |
| MoE 化   | **所有** FFN 替换为 MoE 层                                   |
| 参数锚点 | 专家总参数 = **16 倍**标准 FFN；激活参数 = **2 倍**标准 FFN  |
| 规模     | 总参数 ~2.0B，激活参数 ~0.3B                                 |
| 训练     | AdamW（β=0.9/0.95，wd=0.1），lr 1.08e-3（warmup 2K 步，80%/90% 处 ×0.316），梯度裁剪 1.0；batch 2K × seq 2K = 4M tokens/步，共 **25,000 步 = 100B tokens** |
| 正则     | 无 dropout；**单 GPU 部署**（全参数在一张卡）→ 不丢 token、**不用 device-level 均衡损失**，仅用 expert-level 均衡损失（因子 0.01） |

> 说明：单卡部署意味着不存在设备间负载问题，所以只用专家级均衡损失防路由崩溃——这与 3.3 节的"两级损失"设计对应。

**评测基准（4.1.4）**：语言建模用 Pile 测试集（交叉熵损失）；理解推理用 HellaSwag、PIQA、ARC-challenge/easy（准确率）；阅读理解用 RACE-high/middle；代码用 HumanEval、MBPP（Pass@1）；闭卷问答用 TriviaQA、NaturalQuestions（EM）。

### 4.2 评测（Baselines 与结果）

**五个对比模型**（同语料、同超参，MoE 模型总参数都相同，GShard 与 DeepSeekMoE 激活参数也相同）：

- Dense 0.2B（标准稠密）
- Hash Layer 2.0B（top-1 **哈希**路由，激活 0.2B）
- Switch 2.0B（top-1 可学习路由，激活 0.2B）
- GShard 2.0B（top-2 可学习路由，激活 0.3B）
- **DeepSeekMoE 2B：1 共享 + 63 路由专家（各 0.25×标准 FFN），激活 1+7**

![DeepSeekMoE 2B 与五个基线模型的评测结果](/img/notes/llm-agents/deepseek-moe/table-1.png)

**论文提炼的三条结论**：① 稀疏架构（Hash/Switch）在相同激活参数下显著强于 dense 基线；② GShard 激活参数更多，略优于 Switch；③ **在总参数、激活参数完全相同的前提下，DeepSeekMoE 对 GShard 呈现压倒性优势**——这是架构优势的直接证据。

### 4.3 DeepSeekMoE 贴近 MoE 模型上界

用"**要达到同等性能需要多大的对比模型**"来锚定优势：

- **对比 GShard ×1.5**（专家尺寸放大 1.5 倍 → 2.83B 专家参数、0.35B 激活、5.8T FLOPs）：DeepSeekMoE 2B 以 4.3T 计算追平其 Pile loss；
- **进一步放大**（附录 B）：把 DeepSeekMoE 总参数扩到 13.3B，与 GShard ×1.2（15.9B）、×1.5（19.8B）对比，**更大规模下 DeepSeekMoE 能明显胜过 GShard ×1.5**；
- **对比 Dense ×16**（注意力不变 + 16 倍 FFN 的稠密模型 = MoE 容量上界）：DeepSeekMoE 几乎追平（Pile loss 1.808 vs 1.806）。

![DeepSeekMoE、放大版 GShard 与稠密上界模型的对比](/img/notes/llm-agents/deepseek-moe/table-2.png)

**结论**：至少在 2B/100B tokens 这一规模下，**DeepSeekMoE 的性能与 MoE 理论容量上界高度吻合**。

### 4.4 消融实验（图 3，全部保持总参数与激活参数一致）

![细粒度专家分割与共享专家隔离的消融实验](/img/notes/llm-agents/deepseek-moe/ablation-studies.png)

- **共享专家隔离**：在 GShard 基础上隔离出 1 个共享专家 → 多数基准提升；
- **细粒度分割**：每个专家再切 2 倍或 4 倍（→ 32 个：1 共享 + 31 路由；或 64 个：1 共享 + 63 路由）→ **粒度越细，性能单调提升**；
- **共享:路由专家比例**：64 专家下分别隔离 1/2/4 个共享专家，Pile loss 为 1.808 / **1.806** / 1.811——差异不大，但 **1:3 比例略优，故后续扩展（16B）沿用 1:3**。

### 4.5 专家专业化分析（机制验证，均用 DeepSeekMoE 2B：1 共享 + 7/63 激活）

**① 路由专家冗余更低**：按比例"禁用"路由得分最高的专家后看 Pile loss 变化。与 Pile loss 相同的 GShard ×1.5 相比，DeepSeekMoE 对禁用**更敏感** → 每个路由专家更不可替代 = **参数冗余更低**（GShard 冗余高，能"缓冲"性能下降）。

![禁用高路由得分专家后的 Pile 损失变化](/img/notes/llm-agents/deepseek-moe/pile-loss-curve.png)

**② 共享专家不可替代**：禁用共享专家、同时多激活一个路由专家（计算量不变），Pile loss 从 1.808 **暴涨到 2.414** → 共享专家捕获的是路由专家不具备的基础知识，无法被路由专家替代。

**③ 知识获取更精准**：激活数从 3 调到 7，仅 **4 个路由专家**激活时 Pile loss 就追平 GShard；进一步从零训练一个**只激活 3 个路由专家**的模型，在相同总专家参数、仅一半激活参数的情况下**仍胜过 GShard** → 激活参数中"有效参数"占比远高于 GShard。

![激活不同比例路由专家时的 Pile 损失](/img/notes/llm-agents/deepseek-moe/routed-expert-ratios.png)
![减少激活参数后的 DeepSeekMoE 与 GShard 对比](/img/notes/llm-agents/deepseek-moe/vs-gshard.png)



## 5. 扩展到 DeepSeekMoE 16B

**开篇。** 依托 DeepSeekMoE 架构，将模型扩展到 16B 总参数，在 2T tokens 语料上训练。结果表明：相比 LLaMA2 7B，**DeepSeekMoE 16B 仅用约 40% 的计算量即取得更优性能**。

### 5.1 实验设置

**数据与分词（5.1.1）**：同一语料（同 4.1.1），但数据量放大到 **2T tokens**——刻意对齐 LLaMA2 7B 的训练量；BPE 词表放大到 **100K**。

**模型配置（5.1.2，关键数字）**：

| 项         | 配置                                                         |
| ---------- | ------------------------------------------------------------ |
| 结构       | 28 层，hidden 2048，16 头 × 128 维                           |
| MoE 化     | **除第一层外**所有 FFN 换为 MoE（观测到第一层负载均衡收敛明显更慢） |
| 专家配置   | 每层 **2 共享 + 64 路由**专家，各 0.25×标准 FFN；激活 **2 共享 + 6 路由**（贯彻 2B 消融得到的 1:3 比例） |
| 粒度选择   | 不再切更细（专家过小会降低计算效率）；论文明确说 16B 以上仍可继续细分 |
| 规模       | 总参数 ~16.4B，激活参数 ~2.8B                                |
| 训练       | lr 4.2e-4（warmup 2K 步，80%/90% ×0.316），batch 4.5K × seq 4K = 18M tokens/步，**106,449 步 = 2T tokens** |
| 并行与均衡 | pipeline 并行，**每层专家放同一设备** → 不丢 token、不用 device-level 均衡损失；expert-level 均衡因子降到 **0.001**（论文解释：在该并行策略下，更大的均衡因子无法提升计算效率，反而损害性能） |

**评测基准（5.1.3）**：在 4.1.4 基础上扩展——Pile 改用 **BPB**（因词表不同，需与 LLaMA2 7B 公平比较）；新增 **DROP**（阅读理解）、**GSM8K / MATH**（数学）、**MMLU**（多选题）、**WinoGrande**（消歧）；新增四个**中文基准**：CLUEWSC、CEval、CMMLU、CHID；另在 **Open LLM Leaderboard**（ARC、HellaSwag、MMLU、TruthfulQA、Winogrande、GSM8K 六项）上评估以便与开源模型对比。

### 5.2 评测结果

#### 5.2.1 内部对比：与 DeepSeek 7B（dense）比较

公平性设计：**两者同语料、同 2T tokens** → 排除数据差异，纯测架构。

![DeepSeekMoE 16B 与 DeepSeek 7B 的评测结果](/img/notes/llm-agents/deepseek-moe/table-3.png)

论文三条观察：

1. **整体**：仅约 40.5% 的计算量，性能与 DeepSeek 7B 相当；
2. **强项**：语言建模与知识密集任务（Pile、HellaSwag、TriviaQA、NaturalQuestions）明显占优——归因于 MoE 中 FFN 参数远重于注意力参数，契合"FFN 承担知识记忆功能"（Dai et al. 2022a）的论断；
3. **弱项**：多选题（如 MMLU 45.0 vs 48.2）落后——归因于 **DeepSeekMoE 16B 仅约 0.5B 注意力参数**（DeepSeek 7B 有 2.5B），且此前的实验表明注意力容量与多选题性能正相关（例证：DeepSeek 7B MQA 变体同样在 MMLU 类任务上挣扎）。

**部署亮点**：16B 可单卡 40GB 部署（无需量化），经算子优化后推理速度约为 7B dense 模型的 **2.5 倍**。

#### 5.2.2 对比开源模型

![DeepSeekMoE 16B 与开源模型的评测结果](/img/notes/llm-agents/deepseek-moe/table-4.png)

- 两者同为 2T tokens 预训练；DeepSeekMoE 有 LLaMA2 的 **245% 总参数**，但仅需 **39.6% 计算量**，且在多数基准上胜出；
- **数学与代码更强**（语料中数学、代码文本占比高）；
- **中文基准大幅领先**（语料含中文，LLaMA2 基本没有）；
- 尽管英文语料更少，英文理解/知识密集基准仍与 LLaMA2 相当或更好。

结论：**大幅优于激活参数相近的模型**，与激活参数约为其 2.5 倍的 LLaMA2 7B 相当。



## 6. DeepSeekMoE 16B 的对齐

此前研究（Fedus et al. 2021；Artetxe et al. 2022）认为 **MoE 模型通常无法从微调中获得显著收益**，但 Shen et al. 2023 发现 MoE 能从指令微调中受益。本节就是为了检验：DeepSeekMoE 16B 能否从微调中获益？

### 6.1 实验设置

- **数据**：自建 SFT 数据 **1.4M 条**（数学、代码、写作、问答、推理、摘要等；以中英为主）；
- **训练**：batch 1024 条，**8 个 epoch**，AdamW，max seq 4K（样本尽量密集打包），无 dropout，**恒定 lr 1e-5**（无调度）；
- **基准调整**：去掉 Pile（对话模型不做纯语言建模）、去掉 CHID（结果不稳定）、**新增 BBH**（更全面测推理）。

### 6.2 评测结果

公平性设计：对 LLaMA2 7B、DeepSeek 7B、DeepSeekMoE 16B **三个模型用完全相同的 SFT 数据**微调，再对比。

![DeepSeekMoE Chat 16B 与两个 7B 对话模型的评测结果](/img/notes/llm-agents/deepseek-moe/table-5.png)

四条观察：

1. **通用能力**：约 40% 计算量下，在语言理解/推理（PIQA、ARC、BBH）、阅读理解（RACE）、数学（GSM8K、MATH）、知识密集任务（TriviaQA、NQ）上与两个 7B dense 模型相当；
2. **代码能力**：HumanEval、MBPP 上**显著超越 LLaMA2 SFT 7B**，也超过 DeepSeek Chat 7B；
3. **多选题**（MMLU、CEval、CMMLU）：仍落后于 DeepSeek Chat 7B——与基座模型（5.2.1）的观察一致，但**注意 SFT 后差距明显缩小了**；
4. **中文基准**：受益于双语预训练，在全部中文基准上明显超越 LLaMA2 SFT 7B。

**结论**：对话模型评测表明 **DeepSeekMoE 16B 确实能从对齐中获益**，且"约 40% 计算量达到 dense 模型相当性能"的优势在微调后依然成立。



## 7. DeepSeekMoE 145B 正在路上

受 16B 出色表现的鼓舞，我们进一步开展了将 DeepSeekMoE 扩展到 **145B** 的初步尝试。在这项初步研究中，DeepSeekMoE 145B 仅在 **245B tokens** 上训练（注意：远少于 16B 的 2T——所以标题叫"进行中"，完整训练尚未完成），但已持续展现出对 GShard 架构的优势，并有希望匹配或超越 DeepSeek 67B（dense）。计划在最终版本与完整训练完成后公开模型。

**三条结论**：

1. 在总参数与计算量相当的前提下，**DeepSeekMoE 145B 显著优于 GShard 137B**——架构优势在大规模下再次得到验证；
2. 整体上，**仅用 28.5% 的计算量**，145B 达到与 DeepSeek 67B（dense）相当的性能；能力画像与 16B 一致——语言建模与知识密集任务突出、多选题偏弱；
3. **半激活版本的惊喜**：142B（Half Activated）与 145B 差距不大；**仅用一半激活专家参数、18.2% 的计算量，仍追平 DeepSeek 67B，并胜过 GShard 137B**——与第 4.5 节"激活参数中有效参数比例更高"的结论完全一致。

![DeepSeekMoE 145B、GShard 137B 与 DeepSeek 67B 的评测结果](/img/notes/llm-agents/deepseek-moe/table-6.png)



## 8. 相关工作

混合专家（MoE）技术最早由 **Jacobs et al. 1991** 与 **Jordan and Jacobs 1994** 提出，其思想是用相互独立的专家模块来处理不同的样本。**Shazeer et al. 2017** 将 MoE 引入语言模型训练，构建了基于 LSTM（Hochreiter and Schmidhuber 1997）的大规模 MoE 模型。

随着 Transformer 成为 NLP 最主流的架构，许多工作尝试将 Transformer 中的 FFN 扩展为 MoE 层以构建 MoE 语言模型。**GShard**（Lepikhin et al. 2021）与 **Switch Transformer**（Fedus et al. 2021）是其中的先驱，它们采用可学习的 top-2 或 top-1 路由策略，将 MoE 语言模型扩展到极大的规模。**Hash Layer**（Roller et al. 2021）与 **StableMoE**（Dai et al. 2022b）采用固定的路由策略，以获得更稳定的路由与训练。**Zhou et al. 2022** 提出了专家选择（expert-choice）路由策略，其中每个 token 可以被分配到不同数量的专家。**Zoph 2022** 关注 MoE 模型的训练不稳定与微调困难问题，提出了 **ST-MoE** 来克服这些挑战。

除了 MoE 架构与训练策略的研究外，近年来还涌现出大量基于现有 MoE 架构的大规模语言或多模态模型（Lin et al. 2021；Du et al. 2022；Ren et al. 2023；Xue et al. 2023）。

总体而言，以往的 MoE 模型大多基于传统的 top-1 或 top-2 路由策略，在提升专家专业化方面留有巨大的空间。对此，我们的 DeepSeekMoE 架构旨在将专家专业化提升到极致。



## 9. 结论

本文介绍了DeepSeekMoE架构，以达到实现最终专家专业化的目的。通过更细粒度的专家划分和共享专家隔离机制，DeepSeekMoE显著提升了专家专业化，并且让模型在性能上超过了主流的MoE架构的模型。在实验中，我们从2B的小模型验证了DeepSeekMoE达到了MoE模型的性能上界。此外，我们有力地证明了DeepSeekMoE在专家专业化方面远高于传统的MoE架构GShard。

扩展到16B总参数的更大范围，我们在2T tokens上训练DeepSeekMoE 16B，并展示了其与DeepSeek 7B和LLaMA 7B相当的出色性能，仅需约40%的计算。此外，我们还进行了监督微调，以此构建了DeepSeekMoE chat模型，进一步展示了其适应性和通用性。此外，我们还进行了初步探索，将DeepSeekMoE扩展到145B。我们发现，DeepSeekMoE 145B仍然比GShard架构具有实质性的优势，并且与DeepSeek 67B的性能相当，只使用了28.5%的计算量。

## 更新说明

- 2026-08-20：完成第一版精读笔记。
