---
title: 多 Agent / 长程项目人类交互 Skill 产品需求文档
document_id: HPI-PRD-001
revision: 0.1
status: proposed
created: 2026-08-30
language: zh-CN
scope: 设计阶段，不代表已经实现或部署
---

# 多 Agent / 长程项目人类交互 Skill

## 产品需求文档（PRD）

## 0. 文档状态与证据边界

本文件是一个可评审的产品需求基线，暂不授权实现、安装插件、改变现有项目的 canonical 状态或替换项目已有的真源。

文中使用三种证据标签：

- **[M] 材料事实**：来自用户在本轮或参考对话中提供的描述，或来自用户上传的 TS-001 文件。它描述当前材料说了什么，不等于系统已实现。
- **[E] 外部调研结论**：来自公开标准、论文、政府指南或厂商官方工程资料。它是设计参考，不自动成为本项目事实。
- **[D] 本项目设计推导**：基于 [M] 与 [E] 得出的需求、架构或验收假设。它需要后续由用户确认、实现和验证。

特别说明：

1. 用户上传的 09_TS001_测试与回滚验收.md 的 front matter 标记为 TS1-TEST-001、revision 1、status approved、test_status NOT-RUN。[M]
2. 因此，本文件不把参考对话中出现的 31/31、32/32、117/117 等数字视为当前已经验证的工程结果；除非未来有对应的 ResultBundle、命令、日志、SHA 和独立复核证据，它们只能作为未证实的对话内容。[M]
3. 本文件提出的 Human Project State、Human Brief、Human Escalation Gate 等名称是本项目的设计术语，不声称它们是现有项目中已经存在的文件或标准。[D]

## 1. 一句话定义

Human Project Interaction Skill（以下简称 HPI Skill）是一个面向多 Agent、跨会话、长程项目的人类交互层：

> 它把 Agent 的执行进展投影回人的痛点、需求、设计和决策，使人不再是 Agent 之间搬运消息的管道，也不再被要求重复签署机器可以自行验证的事实。

HPI Skill 不代替 Harness 的身份、权限、事务、证据和状态能力；它消费由 Harness 产生的结构化状态，生成适合人理解的项目视图，并在确实需要人类判断时提出窄而明确的问题。[D]

## 2. 背景与当前问题

### 2.1 当前协作方式

参考对话描述了如下工作流：[M]

1. 用户在项目开始阶段与 Agent A 讨论背景、问题和技术方案；
2. 项目转交 Agent B 开发；
3. 完成后再交回 Agent A 审核；
4. 用户负责在多个 Agent 之间复制文件、转交结果和回答验收问题；
5. 当项目由多个部分组成时，用户逐渐失去整体认知，只能在某个具体功能或测试失败点重新介入。

用户在 Note Skill 开发中的有效参与方式不同：[M]

1. 用户明确项目背景和预期结果；
2. 用户围绕自己提出的痛点，检查测试是否解决；
3. 出现新痛点时，要求 Agent 说明是否能解决、设计稿中的哪一个设计点负责解决、测试如何证明；
4. 用户主要判断“问题是否真的被解决”和“设计方向是否符合预期”，而不是逐行审查实现。

### 2.2 TS-001 暴露的交互缺口

用户上传的 TS-001 合同规定了清晰的工程范围：[M]

- 覆盖 Schema、权限与引用、Handoff / Result 幂等、回滚与恢复程序四组用例；
- 明确只测试合同、纯数据 fixture、提交流程和回滚验收；
- 明确不实现或测试 filesystem gate、Run、Evidence、Claim、Research Event 的完整运行时闭环；
- 所有用例当前为 NOT-RUN；
- 每条用例必须记录输入 fixture、输入 SHA、实际命令、运行时与版本、输出或日志 SHA、退出码和起止时间；
- 工具退出 0 不能单独证明合同通过；
- 只有四组用例、正负向语义、直接覆盖不变量、回滚约束、无越界写入、无真实数据、无网络获取、Validation Agent CONFORMANT 和用户另行完成人类验收等条件同时满足，才能报告 PASS-ENGINEERING；
- 通过 TS-001 不批准 TaskSlice、ExperimentSpec 或 Claim，不产生科学或临床主张，不把测试 workspace、索引或日志当作 canonical 研究状态。

然而，参考对话中的人类验收问题把以下机器可验证事实交给用户判断：[M]

- 是否相信 RB-0001 → CF-0001/HO-0003 → RB-0002 的证据链；
- 是否接受若干测试数量；
- 是否相信 hash、引用和记录一致；
- 是否确认没有发生越界写入。

这产生了一个反模式：

> 工程验证没有被系统真正完成时，人被要求用“我相信”替代证据；工程验证已经完成时，人又被要求重复签署证据。

HPI Skill 必须把两类问题分开：

- **机器事实**：由 Harness、测试、校验器和 Reconciler 负责；证据不足时输出 NOT-RUN、INCOMPLETE 或 DEVIATIONS_FOUND，不把问题升级为“请人相信”。
- **人类判断**：由用户判断目标、优先级、语义、设计权衡、风险接受以及“这是否真正解决了原始痛点”。[D]

### 2.3 问题陈述

当前缺的不是更多结果文件，而是一个能持续维护人类项目模型的交互层：

> 在多个 Agent 连续执行、跨会话切换、项目由多个 TaskSlice 组成的情况下，用户无法低成本回答“我们为什么做这件事、刚刚改变了什么、解决了哪个痛点、还剩什么、下一步需要我决定什么”。

## 3. 用户与角色

| 角色 | 关心的问题 | 应拥有的权限 | 不应承担的工作 |
|---|---|---|---|
| 人类项目负责人 / 研究者 | 为什么做、是否解决痛点、设计是否合理、风险是否可接受 | 意图、范围、设计、风险和最终语义接受 | 逐条复核机器能验证的 hash、schema 和计数 |
| 项目协调 Agent | 把全局状态投影给人、编排任务、识别真正需要升级的问题 | 读取项目状态、生成 brief、提交结构化协调事件 | 代表人做价值判断；把自报结果写成事实 |
| 实现 Agent | 在冻结边界内完成一个 TaskSlice | 受限 workspace、任务范围内的工具 | 修改 canonical 状态、改变需求、替自己验收 |
| 验证 Agent | 独立检查合同、测试、证据和偏差 | 读取候选与测试输入、产生 Validation Result | 代替用户接受设计或风险 |
| Harness 核心 | 身份、版本、权限、事务、证据、状态、恢复和一致性 | 通过 Gate 修改受管状态 | 依赖模型记忆维护关键不变量 |
| Note / Memory / Retrieval Skill | 捕获、组织、召回内容 | 在各自边界内读写或检索 | 成为项目 canonical 状态、授权或 provenance 真源 |

## 4. 产品目标

### 4.1 P0 目标

P0 只解决用户与多 Agent 项目之间的认知和决策断裂：

1. 用户重新进入项目时，能先看到一页 Human Project State；
2. 每个 TaskSlice 的结果都能投影回 Pain → Requirement → Design → Implementation → Test → Evidence 链；
3. 每个完成或暂停的 TaskSlice 都自动产生 Human Brief；
4. 工程事实与人类判断分别记录，不能用一个 PASS 或一个“已接受”混在一起；
5. 所有向用户发出的验收问题先经过 Human Escalation Gate；
6. 机器可验证的问题不升级给人；证据不足时停在机器状态；
7. 用户只在目标、范围、设计权衡、风险、不可逆操作和“痛点是否被解决”等问题上做判断；
8. 用户提出新痛点后，系统能把它挂回现有设计或形成待讨论的新需求；
9. Agent 间传递结构化任务和结果，不要求用户充当消息总线；
10. 中断、失败、重试和回滚不会覆盖历史，也不会虚构完成状态。

### 4.2 成功假设

如果用户每次只需先阅读项目语义状态和 Human Brief，再按需展开机器证据，那么用户能够在不掌握所有实现细节的情况下持续参与跨模块开发，并且人类判断会集中在真正不可自动化的决策上。[D]

## 5. 非目标

P0 不做以下事情：

1. 不实现通用自主项目管理平台；
2. 不替代现有项目的 canonical state、Worklog、Registry、Wiki 或研究数据树；
3. 不自动推断“用户已经认可”；
4. 不把模型自报、对话中的数字、dry-run、合成 fixture 或目录索引当成工程或科学证据；
5. 不允许 Skill 直接绕过 Harness 修改 canonical 文件；
6. 不把所有人类参与都归类为 HITL；
7. 不要求用户阅读所有 raw log；
8. 不在 P0 选择固定的数据库、图数据库、云调度平台或网络沙箱实现；
9. 不生成真实医疗数据、网络研究结果或科学结论；
10. 不通过增加审批弹窗数量来制造“人在环中”的假象；
11. 不把摘要文本作为唯一状态源；
12. 不把多 Agent 并行能力本身当作产品成功指标。

## 6. 核心概念与认知单位

### 6.1 两套循环

人的认知循环：

    Pain / Problem → Requirement → Design → Human Decision

机器的执行循环：

    TaskSlice → Agent Work → Test / Validation → Machine Result → Evidence

Harness 的治理循环：

    Event → Hook → Gate → Revisioned State → Reconciler

核心设计推导是：

- TaskSlice 是 Agent 的执行单位；
- Pain、Requirement、Design、Capability 和 Decision 是人的认知单位；
- Human Project State 是把机器执行状态映射回人的语义状态；
- Human Brief 是面向人的可读投影，不是新的事实源。[D]

### 6.2 结果双层模型

| 层 | 内容 | 责任者 | 是否需要人签字 |
|---|---|---|---|
| Machine Result | 测试、命令、环境、hash、权限、引用、失败、偏差、side effect、证据指针 | Harness / Validation Agent | 否；证据不足就保持非通过状态 |
| Human Result | 对目标、设计、风险、痛点解决程度、下一步的明确判断 | 人类项目负责人 | 是；仅在 Gate 判断确有必要时 |

## 7. 典型使用场景

### S01：重新进入长程项目

**触发**：用户数天后回到项目，或上下文窗口切换。

**系统展示**：

1. 项目目标和当前阶段；
2. 最近一次重要变化；
3. 各核心痛点当前是未处理、部分解决、已解决、待复核还是被新版本替代；
4. 当前活动 TaskSlice 及其对应的 Pain / Design；
5. 仍未解决的问题；
6. 下一次真正需要人决定的事项；
7. 机器结果和证据状态的简短汇总；
8. 可展开的 provenance 和 raw evidence 入口。

**用户应能回答**：

> 我们现在处于哪个阶段，最近改变了什么，为什么下一步做这个？

**完成条件**：用户无需先翻阅 Agent 对话或 raw log，就能复述当前项目方向和下一步。[D]

### S02：从痛点进入需求和设计

**触发**：用户提出“模型过几天就不知道为什么这样设计”或“我不想继续做信息管道”等痛点。

**系统行为**：

1. 给出已有相近 Pain 的匹配；
2. 展示已关联 Requirement、Design 和 Capability；
3. 标出仍未解决的缺口；
4. 允许用户确认“这是原痛点的补充”“这是新痛点”或“这是对现有设计的反对”；
5. 只有用户确认后，才产生新的 Human Decision 或需求 revision。

### S03：冻结一个可交给实现 Agent 的任务

**触发**：设计方向已被用户确认，协调 Agent 准备派发实现。

**系统必须生成**：

- 目标；
- 非目标；
- 允许路径和禁止路径；
- 输入 revision 与 SHA；
- 任务对应的 Pain / Requirement / Design；
- 测试与验收条件；
- 失败语义；
- 输出格式；
- 回滚和恢复规则；
- 需要实现 Agent 与验证 Agent 共同遵守的共享合同。

**人类介入**：判断任务边界和设计方向，不审查每个实现步骤。

### S04：多个 Agent 协作与交接

**触发**：实现 Agent、验证 Agent、研究 Agent 或不同会话之间交接。

**系统行为**：

1. 通过结构化 Handoff Bundle 传递任务、版本、约束和上下文；
2. 通过 Result Bundle 传递结果、证据和未完成项；
3. 协调 Agent 只把经过结构化校验的状态更新入项目；
4. 用户只看到对 Pain / Design 的影响；
5. 如果交接内容缺少身份、版本、证据或权限信息，系统拒收或标记 INCOMPLETE。

### S05：TaskSlice 完成后的 Human Brief

**触发**：机器结果进入 terminal、暂停、失败或需要用户决策。

**Human Brief 首屏必须回答**：

1. 这次做了什么；
2. 为什么现在做；
3. 它解决了哪个痛点；
4. 采用了哪一个设计点；
5. 相对于上一个版本改变了什么；
6. 什么已经由机器验证；
7. 什么仍未解决；
8. 下一步为什么是这个；
9. 哪些事情真的需要用户决定；
10. 详细证据在哪里。

### S06：机器事实不完整或矛盾

**触发**：测试未运行、输入 SHA 漂移、结果 Bundle 缺少证据、两个 Agent 的状态冲突、发生越界写入或 Reconciler 检出漂移。

**系统行为**：

- 机器状态保持 NOT-RUN、INCOMPLETE、DEVIATIONS_FOUND 或 BLOCKED；
- 明确缺少什么证据；
- 自动停止会造成不可逆影响的动作；
- 提供可执行的恢复路径；
- 不把“你是否相信这个结果”发给用户。

**只有在以下情况才升级给人**：

- 证据缺口会改变用户的风险选择；
- 需要决定是否改变范围或设计；
- 需要批准不可逆操作；
- 需要判断某个新问题是否意味着原始痛点仍未解决。

### S07：用户提出新痛点

**触发**：用户在测试、brief 或使用过程中发现新问题。

**系统行为**：

1. 把新痛点作为独立对象记录；
2. 关联触发它的版本、TaskSlice、Human Brief 和机器证据；
3. 判断它是现有 Requirement 的缺口、Design 的副作用还是全新目标；
4. 给出候选处理方式；
5. 等待用户选择是否纳入当前范围、后续范围或暂不处理。

### S08：失败、暂停、重试和恢复

**触发**：Agent 中断、工具失败、网络或环境不可用、结果被拒、用户暂时未回答。

**系统行为**：

- 保留原 attempt、日志和失败原因；
- retry 创建新 attempt，不覆盖旧 attempt；
- 状态引用具体 revision 和 SHA；
- 恢复先重建状态、重新执行 Gate 和 Reconciler；
- 人类决定未完成时，项目进入 human_pending，不被自动解释为同意；
- 任何恢复或 canonical 写入都遵守对应人工 Gate。

### S09：TS-001 案例

基于用户上传的 TS-001 文件，首屏应当呈现为：

    Human Brief：TS-001 当前是合同与测试基线设计

    为什么做：
    在进入 runtime 层之前，固定 Schema、权限、引用、交接幂等和回滚语义。

    解决的痛点：
    Agent 交接格式不能随意变化；非法引用、越权路径、重复提交和覆盖历史必须可拒绝。

    当前不解决：
    filesystem gate、完整 Run、Evidence / Claim runtime、Research Event 闭环和真实实验数据。

    机器状态：
    NOT-RUN。附件要求四组用例逐条执行，并记录 fixture、命令、环境、SHA、日志和退出码。

    现在需要人判断：
    是否接受“先固定合同与测试基线，再进入 runtime 实现”的设计路线。

    不能从本 brief 推断：
    P0 完整 MVP 已验收、候选已进入 canonical、已产生科学或临床结论。

这个例子把用户需要判断的“设计路线”与机器需要完成的“测试是否通过”分开。用户不需要为当前尚未运行的测试签字，也不应把未提供的计数当作已验证事实。[M][D]

## 8. 交互原则

### P01：人掌握语义，机器承担可验证事实

用户判断目标、优先级、设计和风险；Harness 负责身份、版本、权限、测试和状态一致性。[D]

### P02：不给人“相信证据”的问题

“是否相信 hash / 计数 / 引用链”不是合格的人类问题。若机器没有完成验证，就输出证据不足；若机器已经完成验证，就展示证据状态而不是要求人重复背书。[D]

### P03：先显示项目意义，再显示工程细节

首屏以 Pain、Design、Change、Remaining、Next Decision 为主，Machine Result 和 raw evidence 按需展开。这是 progressive disclosure 在项目协作中的应用。[E][D]

### P04：人类参与应尽量前移到计划和设计

在代码产生之前，让用户审查目标、范围、文件影响和关键权衡；实现之后，主要处理偏差和无法自动验证的判断。HULA 的公开研究采用了先设定上下文、生成并审查 coding plan、再生成代码的流程，为这一方向提供了相关案例。[E09]

### P05：一题一答，避免复合式批准

一个 Human Escalation Gate 只提出一个核心决策；相关影响和选项可以同时展示，但不能要求用户一次性签署多个独立事实或权限。

### P06：状态有来源，摘要不是真源

Human Brief 可以自动生成，但它必须指向结构化状态、事件和证据；摘要文本不能反向改变状态。[D]

### P07：不能解决就明确保留

“部分解决”“待复核”“证据不足”“超出范围”是有效状态，不强行压成已完成。

### P08：用户可以纠正、撤回和追问

每个 brief 应能回到对应 Pain、Design、Machine Result、Evidence 和 revision；用户可以提出更正或新痛点。

### P09：风险决定交互强度

低风险、可逆、机器可验证的动作可自动执行；中风险动作需要通知或监督；高风险、不可逆或改变 canonical 语义的动作需要明确人工批准。[E03][E04]

### P10：跨 Agent 传递状态，不传递“印象”

Agent 交接以结构化 bundle、版本和 provenance 为主，聊天摘要只能作为辅助。

### P11：失败关闭，而不是默认为成功

缺少规则、schema、身份、权限、版本或证据时，系统拒绝、暂停或返回不完整状态。

### P12：维护人的项目心智模型

系统要持续告诉用户“为什么现在做这个”和“这改变了什么”，而不仅是“某个任务通过了”。

## 9. 功能需求

优先级：P0 为首个可用闭环；P1 为增强可用性；P2 为规模化和高级自动化。

| ID | 需求 | 优先级 | 验收要点 |
|---|---|---|---|
| FR-001 | Human Project State | P0 | 能展示目标、阶段、Pain、Design、当前工作、最近变化、未解决项、下一次人类决策和机器状态 |
| FR-002 | 单一语义索引 | P0 | 每个 TaskSlice 必须至少关联一个 Pain、Requirement 或 Design；缺失时标记 orphaned |
| FR-003 | 追踪链 | P0 | 支持 Pain → Requirement → Design → Implementation → Test → Evidence 的正向和反向查询 |
| FR-004 | Machine Result 协议 | P0 | 记录 verdict、输入、命令、环境、证据、hash、side effect、限制和未验证项 |
| FR-005 | Human Result 协议 | P0 | 记录明确的决策、范围、理由、影响、接受风险和 supersedes |
| FR-006 | Human Brief 自动生成 | P0 | 每个 terminal、暂停、失败或待决状态都生成 brief；首屏包含十个核心问题 |
| FR-007 | Human Escalation Gate | P0 | 对升级问题分类；机器事实不升级；证据不足返回机器不完整状态 |
| FR-008 | 渐进式披露 | P0 | 默认显示语义摘要，按需展开结构化结果、trace 和 raw evidence |
| FR-009 | 明确的变化摘要 | P0 | 每次状态更新说明 changed、why、impact、remaining 和 next |
| FR-010 | 双轴状态 | P0 | Machine status 与 Human status 分开存储，不能以一个字段互相覆盖 |
| FR-011 | 版本和修订 | P0 | 定义、需求、状态和决策采用 revision；修改生成新 revision，保留 supersedes |
| FR-012 | 结构化交接 | P0 | Handoff / Result 包含身份、任务、版本、权限、证据和失败语义 |
| FR-013 | 幂等与重试 | P0 | 重复提交返回已有结果；retry 使用新 attempt；不产生第二次 commit |
| FR-014 | 失败和恢复 | P0 | 支持 NOT-RUN、INCOMPLETE、DEVIATIONS_FOUND、BLOCKED、恢复路径和 Reconciler |
| FR-015 | 新痛点捕获 | P0 | 用户能从 brief 或任务中创建新 Pain，并关联触发证据 |
| FR-016 | 机器事实预检 | P0 | 文件、schema、hash、引用、路径、状态前置条件由确定性检查完成 |
| FR-017 | 不建立第二真源 | P0 | HPS 是可追溯的投影；在已有项目中映射到既有 canonical state / worklog |
| FR-018 | 可展开解释 | P1 | 用户能询问某个结论的来源、变化、关联设计和未解决项 |
| FR-019 | 项目级关注设置 | P1 | 用户能设置 brief 频率、风险级别和希望看到的摘要粒度 |
| FR-020 | 多项目视图 | P1 | 以项目为边界展示待决事项，不混淆不同项目的状态 |
| FR-021 | 可视化追踪图 | P1 | 以图或表展示 Pain 与 TaskSlice、Evidence 的关系 |
| FR-022 | 自动提醒与异步恢复 | P1 | 长时间等待或人工待决能够恢复到相同 revision |
| FR-023 | 经验性关注排序 | P2 | 基于用户反馈优化 brief 重点，但不改变事实和权限 |
| FR-024 | 跨项目知识迁移 | P2 | 提供可审计的模式复用，不自动把旧项目结论写入新项目 |

## 10. Human Project State

### 10.1 状态必须回答的问题

Human Project State 至少回答：

1. 项目要解决什么；
2. 哪些 Pain 是当前范围；
3. 每个 Pain 采用什么 Requirement 和 Design；
4. 当前处于设计、实现、验证、决策还是恢复阶段；
5. 最近一次有意义的变化是什么；
6. 哪些结果由机器验证，哪些尚未运行或存在偏差；
7. 哪些问题仍未解决；
8. 当前有哪些风险和依赖；
9. 下一步为什么做；
10. 需要哪个人类决定。

### 10.2 人类状态与机器状态

建议的机器状态词表：

    NOT-RUN
    RUNNING
    PASS-ENGINEERING
    INCOMPLETE
    DEVIATIONS_FOUND
    OUT_OF_SCOPE
    BLOCKED

建议的人类状态词表：

    NOT_NEEDED
    HUMAN_PENDING
    HUMAN_ACCEPTED
    HUMAN_REJECTED
    CHANGES_REQUESTED
    HUMAN_ACCEPTED_WITH_CONDITIONS

两套状态不能互相推断：

- PASS-ENGINEERING 不等于 HUMAN_ACCEPTED；
- HUMAN_ACCEPTED 不等于 PASS-ENGINEERING；
- NOT-RUN 不能由用户“认可”变成已运行；
- OUT_OF_SCOPE 不等于问题已经解决；
- HUMAN_ACCEPTED_WITH_CONDITIONS 必须记录条件、范围和失效时间。

## 11. Human Escalation Gate

### 11.1 Gate 目的

在 Agent 将问题呈现给用户前，先判断：

1. 这是机器可以确定回答的事实吗？
2. 如果可以，证据是否已完整、稳定且可复核？
3. 如果证据缺失，是否应保持 NOT-RUN 或 INCOMPLETE？
4. 这是否会改变项目意图、范围、设计、风险或不可逆操作？
5. 用户要做的是否是“判断意义”，而不是“重复读取日志”？

### 11.2 允许升级的类别

| 类别 | 示例 | 默认交互 |
|---|---|---|
| INTENT | 是否仍以原始痛点为目标 | HITL |
| SCOPE | 是否把新痛点纳入当前切片 | HITL |
| DESIGN | 采用 immutable revision 还是 inplace mutation | HITL |
| RISK | 是否接受已声明的残余风险 | HITL |
| IRREVERSIBLE | 是否批准恢复或改变 canonical 文件 | HITL，默认阻断 |
| SEMANTIC_OUTCOME | 这个功能是否真正解决原始痛点 | HITL |
| MACHINE_FACT | schema、hash、文件存在、测试计数 | 自动验证 |
| EVIDENCE_GAP | 结果没有命令或日志 | 机器保持不完整 |

### 11.3 升级请求的最小内容

一个合格的升级请求包含：

- request_id；
- 只包含一个核心决策；
- 决策所在的 Pain / Requirement / Design；
- 当前事实和它们的证据指针；
- 明确的选项；
- 每个选项的影响、风险和不可逆性；
- Agent 的建议及其理由；
- 不做决定时的安全默认动作；
- 受影响的 revision；
- 回答后会改变什么；
- 过期或失效条件。

禁止的提问形式：

- “你相信这条证据链吗？”
- “你接受所有测试都通过吗？”（当系统已经可以验证，或当前材料根本没有运行证据时）
- “你确认没有越界写入吗？”（应由权限和文件扫描验证）

推荐的提问形式：

> TS-001 目前只建立合同与测试基线，不实现完整 runtime；工程测试仍为 NOT-RUN。你是否接受先完成这层基线，再进入 TS-002 runtime 设计？

## 12. Human Brief 规范

### 12.1 首屏模板

    标题：
    当前阶段：
    一句话结论：

    为什么现在做：
    解决哪个痛点：
    采用哪个设计：
    相比上一版本改变了什么：

    机器已验证：
    机器未验证 / 存在偏差：
    仍未解决：

    下一步为什么是这个：
    现在真正需要你决定：
    影响范围与风险：

    详细证据：
    相关 revision：
    provenance：

### 12.2 Brief 的表达规则

1. 先说意义，再说状态，再说证据；
2. 用“已验证”“自报”“未运行”“待复核”“超出范围”等词标明证据强度；
3. 所有数字必须指向来源，不展示没有出处的汇总数字；
4. 不能通过隐藏缺口来保持摘要流畅；
5. 用户可以从任意一句话展开到结构化对象；
6. Brief 更新时显示变化，而不是重复整篇历史。

## 13. 追踪关系

每个项目任务应形成如下可逆链：

    P-xxx Pain
      ↓
    R-xxx Requirement
      ↓
    D-xxx Design decision
      ↓
    C-xxx Capability
      ↓
    TS-xxx TaskSlice
      ↓
    MR-xxx Machine Result
      ↓
    T-xxx Test / Validation
      ↓
    E-xxx Evidence
      ↓
    HR-xxx Human Result（如需要）

必须支持的查询：

- 某个 Pain 由哪些 Design、Capability 和 TaskSlice 处理；
- 某个 TaskSlice 为什么存在；
- 某个机器结果改变了哪个项目状态；
- 某个 Human Result 影响了哪些后续任务；
- 某个 brief 中的结论来自哪些证据；
- 某个上游 revision 变化后，哪些下游对象需要 stale / needs_review。

## 14. 验收指标

以下是待用户确认的 P0 目标值，不是当前测量结果。[D]

| 指标 | P0 目标 | 测量方式 |
|---|---:|---|
| TaskSlice 语义关联覆盖率 | 100% | terminal 或暂停任务中，关联 Pain / Requirement / Design 的比例 |
| Human Brief 覆盖率 | 100% | 每个 terminal、失败、暂停和 human_pending 状态均有 brief |
| 机器事实误升级率 | 0% | 验收集中的 schema、hash、文件存在、测试计数不产生“请相信”问题 |
| Machine / Human 状态串写 | 0 次 | 状态审计与负向测试 |
| 变化可解释率 | 100% | 每次更新都有 changed、why、impact 或 remaining |
| 人类一题多答率 | 0% | 每个 Gate 只有一个核心决策 |
| 新会话恢复时间 | 用户可接受 | 观察用户能否在不读 raw log 的情况下说出阶段、变化和下一步 |
| 人类真正判断占比 | 持续上升 | 统计升级问题中属于目标、设计、风险和语义结果的比例 |
| 证据不足误报通过率 | 0% | 注入 NOT-RUN、SHA 漂移、缺日志和权限失败 fixture |
| 恢复历史保留率 | 100% | 检查旧 attempt、旧 revision、原始记录和 supersedes 关系 |

## 15. P0 / P1 / P2 范围

### P0：可审计的人类项目闭环

- Human Project State 结构化模型；
- Pain / Requirement / Design / TaskSlice 追踪；
- Machine Result / Human Result 双层结果；
- Human Brief；
- Human Escalation Gate；
- 机器事实预检和 fail-closed；
- revision、attempt、幂等和恢复语义；
- 文件或现有项目状态上的最小 Harness 适配；
- 一个可用的文本交互入口；
- TS-001 反例回归测试。

### P1：可操作的项目视图

- 多项目入口；
- 语义追踪图；
- brief 的关注设置；
- 异步通知和待决队列；
- 更丰富的 Reconciler；
- 多种 Agent / Harness adapter；
- 对“部分解决”和“新痛点”的聚合分析。

### P2：规模化和高级辅助

- 多项目模式复用；
- 基于用户反馈的摘要个性化；
- 风险校准和升级频率优化；
- Agent-on-the-loop 的自动监控层；
- 更复杂的并行 Agent 协作；
- 面向研究、代码和其他领域的可插拔领域包。

## 16. 风险

| 风险 | 后果 | 约束或缓解 |
|---|---|---|
| Brief 过度压缩 | 用户误以为问题已解决 | 必须显示未解决项、证据状态和可展开来源 |
| Brief 过度详细 | 用户再次被 raw log 淹没 | 首屏固定为语义层，细节按需展开 |
| Agent 自报被采信 | 错误结果进入项目状态 | 结果必须区分 self-reported、pre-Harness、Harness verified |
| 用户过度依赖“已有人审” | 人类不再进行语义判断 | Gate 明确审查问题，禁止泛化的信任问题 |
| 人工升级过多 | 用户疲劳、审批机械化 | 机器事实自动处理；风险分级；一题一答 |
| 状态投影成为第二真源 | 状态分叉 | HPS 记录 source revision，不允许独立覆盖 canonical |
| 多 Agent 状态冲突 | 协调 Agent 选择错误赢家 | 保留各 Result，交给 Reconciler 和冲突 Gate |
| 模型更新导致交互变化 | 长程项目行为不稳定 | 记录模型、Skill、Harness revision；待决状态可版本化恢复 |
| provenance 泄露敏感信息 | 隐私或知识产权风险 | 最小化收集、权限分层、敏感字段脱敏和不可公开的证据指针 |
| 人类只会检查而不会判断 | 形成“橡皮图章” | 把计划和设计选择前移，要求用户能反驳或改变方案 |

## 17. 开放问题

1. Human Project State 在不同项目中应采用统一最小 schema，还是允许领域插件扩展？
2. 用户接受“设计方向”后，是否需要单独的“范围接受”和“风险接受”？
3. 如何把自然语言中的“可以”“先这样”“没问题”规范化为明确决策，避免误判？
4. 哪些低风险决策可以设置项目级默认规则，默认规则何时失效？
5. 用户希望 brief 每个 TaskSlice 都出现，还是按 Pain / Capability 聚合后出现？
6. 如何在不暴露敏感 raw log 的情况下保持 provenance 可审计？
7. 多 Agent 并行时，用户应该看到 Agent 角色、子任务和冲突，还是只看协调后的语义变化？
8. 当用户长期不响应时，哪些操作可以继续，哪些必须停住？
9. HPI Skill 与具体 Pi / Codex / 其他 Agent 平台的最小适配协议是什么？
10. “痛点已解决”的验收是否需要用户明确回答，还是可由领域测试加上用户抽样确认？

## 18. 外部调研结论与需求映射

| 编号 | 外部资料结论 | 对本产品的设计影响 |
|---|---|---|
| E01 | Microsoft HAX 以研究和用户研究为基础提出 18 条人类与 AI 交互准则，覆盖初次使用、交互中、出错时和长期变化；包括说明能力与限制、显示上下文、支持纠正、说明原因、记住近期交互、传达用户操作后果和通知变化。 | Human Brief 要说明能力边界、原因、变化、后果；支持纠正、追问和按需展开。 |
| E02 | Microsoft 对 Human-Agent Communication 的研究指出，多 Agent、自主工具调用和复杂失败模式带来新的信息传递、用户输入和透明度挑战。 | 需要显式的 agent-to-human 和 human-to-agent 协议，不能只靠自然语言转述。 |
| E03 | NIST AI RMF 要求明确和区分人类角色、责任与 Human-AI 配置，并按风险确定管理活动。 | 需要角色矩阵、风险分级、责任归属和独立的 Human Escalation Gate。 |
| E04 | 英国 NCSC 区分 HITL（事前批准）、HOTL（监控并可干预）和无人工审查，并建议高后果场景使用人类监督叠加技术控制、实时监控和可停止能力。 | 不把所有模式都叫 HITL；为自动、通知、监督、批准、阻断设置不同强度。 |
| E05 | W3C PROV 将 provenance 建模为实体、活动、Agent、派生、责任和委托关系，并支持 provenance-of-provenance。 | TraceLink 必须能表达谁、何时、用什么输入、经过什么活动产生了什么结果。 |
| E06 | Anthropic 的长程 Agent 工程资料指出，跨上下文工作需要增量推进、清晰 artifact、干净交接和可恢复状态；仅靠上下文压缩不够。 | 需要项目级状态、结构化 handoff、会话恢复和自动 progress projection。 |
| E07 | Anthropic 的长程 Harness 设计将规划、生成和评估分开，并指出自评容易宽松；结构化 artifact 和独立评估有助于持续工作。 | 实现 Agent 与验证 Agent 分责；用户接收的是设计语义和独立证据，而非自我表扬。 |
| E08 | OpenAI Agents SDK 的公开文档展示了 approval pause/resume、可序列化 RunState、sessions、handoffs 和 tracing。 | Human pending 必须可持久化、可恢复；Agent handoff 和 trace 是协议对象，不只是一段聊天。 |
| E09 | HULA 研究让工程师先提供上下文、审查 coding plan，再让 Agent 生成代码并接受工具反馈；研究同时报告代码质量仍需关注。 | 把人的判断前移到计划和设计；不要把“有人审过”泛化为所有工程事实都可靠。 |
| E10 | SWE-agent 研究显示 Agent-Computer Interface 的工具与交互格式会影响 Agent 的代码操作和测试表现。 | HPI Skill 不只是提示词；工具返回格式、错误语义和可导航的证据接口也要设计。 |
| E11 | Progressive disclosure 的经典设计原则是先显示少量最重要信息，按请求显示专门细节；研究资料同时提醒初始层与后续层的划分需要通过任务分析和测试确定。 | 首屏给项目语义，之后再进入 Machine Result、provenance 和 raw log；层级需要用真实用户测试校准。 |
| E12 | 英国政府关于 AI 辅助决策的公开指南指出，human oversight / HITL 必须具体定义；人类检查表现可能不同于完成原任务的表现，机械放行不能被视为有意义的判断。 | 禁止“请用户相信”的签字问题；Human Result 必须记录用户实际判断的对象、理由和影响。 |

## 19. 参考资料

以下链接是本轮调研截至 2026-08-30 的公开参考，不代表本项目采用这些产品或技术栈。

1. [E01] [Microsoft Research — Guidelines for Human-AI Interaction（CHI 2019 论文）](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
2. [E01] [Microsoft Research — 18 条人类与 AI 交互准则概览](https://www.microsoft.com/en-us/research/articles/guidelines-for-human-ai-interaction-eighteen-best-practices-for-human-centered-ai-design/)
3. [E02] [Microsoft Research — Challenges in Human-Agent Communication](https://www.microsoft.com/en-us/research/publication/human-agent-interaction-challenges/)
4. [E03] [NIST AI RMF 1.0](https://nvlpubs.nist.gov/nistpubs/ai/nist.ai.100-1.pdf)
5. [E03] [NIST AIRC — AI Risk Management and Human-AI Interaction](https://airc.nist.gov/airmf-resources/airmf/appendices/app-c-ai-risk-management-and-human-ai-interaction/)
6. [E04] [UK NCSC — Managing the cyber risk of agentic AI](https://www.ncsc.gov.uk/blogs/managing-the-cyber-risk-of-agentic-ai)
7. [E05] [W3C — PROV-DM: The PROV Data Model](https://www.w3.org/TR/prov-dm/)
8. [E05] [W3C — PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/)
9. [E06] [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
10. [E07] [Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
11. [E08] [OpenAI Agents SDK — Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/)
12. [E08] [OpenAI Agents SDK — Tracing](https://openai.github.io/openai-agents-python/tracing/)
13. [E08] [OpenAI Agents SDK — Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
14. [E09] [HULA — Human-In-The-Loop Software Development Agents](https://arxiv.org/abs/2411.12924)
15. [E09] [Atlassian — Human in the Loop Software Development Agents](https://www.atlassian.com/blog/atlassian-engineering/hula-blog-autodev-paper-human-in-the-loop-software-development-agents)
16. [E10] [SWE-agent — Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793)
17. [E11] [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
18. [E12] [UK Government — Principles of AI use in marking](https://www.gov.uk/government/publications/principles-of-ai-use-in-marking/principles-of-ai-use-in-marking)

## 20. 覆盖检查

| 用户要求 | 本文位置 | 状态 |
|---|---|---|
| 背景与问题定义 | §2 | 已覆盖 |
| 目标与非目标 | §4–§5 | 已覆盖 |
| 用户角色 | §3 | 已覆盖 |
| 核心场景 | §7 | 已覆盖 |
| 交互原则 | §8 | 已覆盖 |
| 功能需求 | §9 | 已覆盖 |
| 数据 / 状态模型 | §6、§10 | 已覆盖 |
| Human Escalation Gate | §11 | 已覆盖 |
| Human Brief | §12 | 已覆盖 |
| Pain → Requirement → Design → Implementation → Test → Evidence | §13 | 已覆盖 |
| 验收指标 | §14 | 已覆盖 |
| P0 / P1 / P2 | §15 | 已覆盖 |
| 风险与开放问题 | §16–§17 | 已覆盖 |
| 公开调研与资料区分 | §0、§18–§19 | 已覆盖 |
| TS-001 反例 / 案例 | §2.2、§7 S09 | 已覆盖 |

