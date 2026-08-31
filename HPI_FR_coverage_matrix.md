---
title: HPI FR-001～FR-024 实现、缺口与验证证据矩阵
document_id: HPI-FR-MATRIX-001
revision: 0.4
status: implementation-snapshot
updated: 2026-08-31
scope: HPI package 0.5.0 candidate; hpi/wire/v1 + preserved execution/v1 + current execution/v2; TS-001 pilot 0.1 and R-ICL v4 read-only Adapter
---

# HPI FR-001～FR-024 覆盖矩阵

## 1. 口径

本矩阵把 PRD 的功能需求逐项映射到当前可执行实现。它是实现快照，不是项目 canonical state、HumanResult 或完整 P0 验收。

状态词表：

- **试点已实现**：在当前声明范围内已有代码和自动证据；不外推到完整 Harness。
- **部分实现**：只覆盖需求的一部分，或只有试点级内部协议。
- **未实现**：当前包没有可执行闭环；文档、类型名或 validator 不算实现。

当前两个 Adapter：

1. `ts001-pilot/0.1.0`：只读当前目录的 PRD、技术设计和 TS-001 合同；权威机器状态保持 `NOT-RUN`。
2. `ricl-v4-readonly/0.1.0`：只读 R-ICL v4 的唯一当前指针、权威制度、worklog 合同、HEAD 和 LOG；不读取 `05_草稿箱` / `90_工作底稿_raw` 作为当前真源，不运行生成器或门禁。

## 2. 总览

| 状态 | 数量 | 说明 |
|---|---:|---|
| 试点已实现 | 5 | FR-007、008、010、017、021 |
| 部分实现 | 15 | 已有 schema、纯函数或垂直切片，但未满足完整 P0/P1 runtime 合同 |
| 未实现 | 4 | FR-005、019、023、024 |

## 3. 需求矩阵

| FR | PRD 要求摘要 | 当前状态 | 当前实现与证据 | 缺口 / 下一 Gate |
|---|---|---|---|---|
| FR-001 | Human Project State 展示目标、阶段、Pain、Design、工作、变化、未解决、下一决策和机器状态 | **部分实现** | `src/projector.mjs` 重建内容寻址 HPS；`schemas/hps.v1.schema.json` 固定 snake_case 外部形状；codec/fixture 互操作通过 | wire v1 已冻结，但当前仍是精简只读 profile；缺多工作项聚合、Requirement/Capability 和真实 runtime 状态源 |
| FR-002 | 每个 TaskSlice 至少关联 Pain、Requirement 或 Design，缺失时 orphaned | **部分实现** | Projector 对 Pain/Design 均为空的工作项 fail closed；`semantic trace and orphan protection` | 未建 Requirement 对象与跨 Adapter 通用关联解析；没有宿主 canonical orphan 处置事件 |
| FR-003 | Pain → Requirement → Design → Implementation → Test → Evidence 正反向查询 | **部分实现** | 当前支持 Pain → Task、Task → Design、MachineResult → Task；execution v2 对 Bundle 内 Task/Attempt/Evidence 使用完整 frozen identity；projector 在 Brief/Trace 前拒绝 duplicate logical ids | 尚未把 execution records 接入 Adapter/HPS；缺 Requirement、Implementation、Test 的完整 typed DAG 和反向索引 |
| FR-004 | MachineResult 记录 verdict、输入、命令、环境、证据、hash、side effect、限制和未验证项 | **部分实现** | `schemas/machine-result.v1.schema.json`、codec 与严格正/负校验已冻结；PASS 至少需要带 evidence 的 VERIFIED fact；非 PASS 权威状态不可升格 | schema 已预留 execution/changes/side_effects，但当前 Adapter 尚不产出真实命令、环境、artifact SHA、side effects 或独立验证层 |
| FR-005 | HumanResult 记录明确决定、范围、理由、影响、风险和 supersedes | **未实现** | `schemas/human-result.v1.schema.json` 已冻结，synthetic fixture 验证 explicit human actor 且不含 machine verdict；公共 API仍无 accept/commit/write-state | Schema 不等于 runtime；inbound 明确 `not_implemented`，仍需独立 Gate、事务、supersedes 与 canonical writer，且不得从 CandidateEvent 自动生成 |
| FR-006 | terminal、暂停、失败或待决状态自动生成 brief；首屏回答十个问题 | **部分实现** | 查询/lifecycle 可生成 Human Brief；L0/L1 保留 why/change/remaining/next、NOT-RUN 和风险 | 未接真实 task terminal/paused/failed runtime hooks；未验证多任务聚合和十问覆盖率 |
| FR-007 | Human Escalation Gate；机器事实不升级，证据不足返回机器不完整 | **试点已实现** | human escalation 只能绑定 projector 当前 `requestId + requestDigest + sourceDigest`；任意 DESIGN/RISK 自由文本不能 mint request；regex 只作额外拒绝；中英机器事实 paraphrase 负向覆盖 | 仍不替代宿主 filesystem/schema/reference 验证器；未来 projector request producer 需保持同一受信边界 |
| FR-008 | 默认语义摘要，按需展开结果、trace 和 raw evidence | **试点已实现** | `hpi-project` style 的 L0/L1 默认展示、L2–L4 折叠；浏览器渲染与事件路径已验证 | 尚缺真实用户对层级、密度和恢复时间的体验验收 |
| FR-009 | 每次更新说明 changed、why、impact、remaining 和 next | **部分实现** | TS-001 使用材料变化；R-ICL 读取最新类型化 LOG 事件；Brief 保留 changed/remaining/next | impact 尚不是独立 typed 字段；没有 last-seen per-user revision |
| FR-010 | Machine status 与 Human status 双轴存储，不互相覆盖 | **试点已实现** | 合同、HPS、talk payload 和 UI 使用闭集双轴；不存在 `overallStatus`；负向测试覆盖 | 后续 canonical HumanResult writer 仍需保持同一不变量 |
| FR-011 | 定义、需求、状态、决定使用 revision；新 revision 保留 supersedes | **部分实现** | execution v1 历史字节保留；v2 继续使用内容 revision、同 logical ID supersedes 和无环 RUNNING Result → terminal Attempt revision；上游变化只生成 `STALE` / `NEEDS_REVIEW` preview | 纯函数不追加 revision event；尚无定义/决定的 canonical transaction、expected-version lock 或下游状态写入 |
| FR-012 | Handoff/Result 包含身份、任务、版本、权限、证据和失败语义 | **部分实现** | execution v2 codec 校验身份分离、输入 SHA、host-independent path、完整 Task/Evidence frozen identity；PASS trust 必须由 VERIFIED fact 直接引用，旁挂 Evidence 不授予 PASS | R-ICL 权威读集仍无这些记录；缺真实 Implementation/Validation Agent dispatch、intake、permission Gate 和 commit |
| FR-013 | 重复提交幂等；retry 新 attempt；无第二次 commit | **部分实现** | Result idempotency key 绑定 frozen Task/Handoff/Attempt；classifier 先检查整个 existing ledger；same-key/same-ID divergent revisions 与数组顺序无关地 fail closed；retry 新 ID/ordinal | classifier/creator 不落盘也不 commit；缺并发 reservation、append-only receipt、事务 rollback 与 crash recovery |
| FR-014 | NOT-RUN/INCOMPLETE/DEVIATIONS/BLOCKED、恢复路径和 Reconciler | **部分实现** | outbox v2 将完整 candidate digest 绑定 receipt，malformed entry 单条隔离；失败 Attempt fixture；StaleReport 仍为 `PREVIEW_ONLY` / 不自动失效 | 尚无 event-store Reconciler、half-commit 扫描、恢复事务或下游状态更新 |
| FR-015 | 用户可创建新 Pain 并关联触发证据 | **部分实现** | `hpi_propose(op="pain")` 创建 source-bound session candidate | 候选没有项目 canonical writer；触发证据和范围裁决尚未正式入库 |
| FR-016 | 文件、Schema、hash、引用、路径、状态前置由确定性检查完成 | **部分实现** | interaction v1 + preserved execution v1 + current execution v2 严格编译；dependency/hash drift fail closed；v2 拒绝 drive/UNC/backslash/dot segments、timestamp drift、完整 ref 错绑与伪造 revision | 这些仍是合同/纯函数，不是宿主真实 artifact、permission/reference Gate 或 canonical transaction |
| FR-017 | HPS 是既有 canonical/worklog 的可追溯投影，不建第二真源 | **试点已实现** | 两个 Adapter 只读 declared set；读取拒绝 symlink、非普通文件、越界 realpath 和单文件 >2 MiB；R-ICL 只认唯一当前/worklog；query 不写 session | 仅证明两个 Adapter；新宿主仍需逐个声明真源映射与禁止路径 |
| FR-018 | 用户可询问来源、变化、设计和未解决项 | **部分实现** | `hpi_query brief/trace/evidence` 与 L2–L4 可展开 | 缺通用自然语言对象解析、分页和敏感 provenance 过滤策略 |
| FR-019 | 项目级 brief 频率、风险级别和摘要粒度设置 | **未实现** | 无配置 API | 需项目级偏好 Schema、权限和默认策略；不得改变事实轴 |
| FR-020 | 多项目边界视图，不混淆状态 | **部分实现** | Adapter registry 每次只选择一个根；多匹配时 fail closed | 没有多项目 dashboard、项目列表或跨项目待决聚合 |
| FR-021 | 图或表展示 Pain、TaskSlice、Evidence 关系 | **试点已实现** | `/talk` L2 node/trace 视图和 L4 provenance 表 | 目前是单项目、小图谱；未做大型图分页、过滤和用户可用性测试 |
| FR-022 | 长等待/人工待决恢复到相同 revision | **部分实现** | Pi session outbox 恢复、receipt 去重、source drift stale | 缺异步提醒、等待策略、跨设备 canonical request 和长期无人回答策略 |
| FR-023 | 用反馈优化 brief 重点但不改变事实权限 | **未实现** | 无学习/排序逻辑 | 需先完成体验评估和不可变事实边界；P2 后置 |
| FR-024 | 可审计跨项目模式复用，不把旧结论自动写入新项目 | **未实现** | Adapter registry 只隔离项目，没有知识迁移 | 需可审计模式对象、来源/适用范围和显式采用 Gate；P2 后置 |

## 4. 本轮确定性修复证据

| 问题 | 修复 | 负向证据 |
|---|---|---|
| `RUNNING` + 单个 VERIFIED fact 可升为 PASS | `deriveMachineVerdict` 规定任何非 PASS 权威 verdict 原样保留 | `tests/contracts.test.mjs` 覆盖 NOT-RUN/RUNNING/INCOMPLETE/DEVIATIONS/OUT_OF_SCOPE/BLOCKED |
| 伪造 `sourceDigest` 可通过 | digest 必须等于 `sha256({adapter, canonical sourceSnapshot})` | `tests/adapter-contract.test.mjs`、`tests/projector.test.mjs` |
| 安装器忽略 Pi 正式配置变量 | 优先级改为 HPI override → `PI_CODING_AGENT_DIR` → legacy `PI_AGENT_DIR` → default | `tests/install.test.mjs` |
| 测试固定 Homebrew loader 路径 | 从 `pi` executable、`PI_PACKAGE_DIR` 或显式 override 定位 package root | `src/pi-paths.mjs` 与安装/Extension 测试 |
| HULA 错引 `[E12]` | PRD 正文改为 `[E09]` | `human-project-interaction-skills-prd.md` 引用表与正文一致 |
| snake_case/camelCase 合同漂移 | 外部冻结为 `hpi/wire/v1` snake_case-only；内部 camelCase 只经显式 codec 导出 | 7 个 schema 严格编译；schema-set digest `1d08d1ac…264725`；mixed-key、缺字段、错类型、越界枚举和 hash tamper 负向测试 |
| execution Bundle 合同、retry 与 stale 语义缺失 | 保留 execution v1；当前 v2 继续内容 revision、retry 新 attempt 和保守 stale preview | v1 digest `450698c6…9e88d1` 原样回归；v2 digest `1f9a2e49…70d73a2`；两个版本与依赖/byte tamper 均验证 |
| PASS 可由错误 Evidence revision 或无关高信任 Evidence 获得 | v2 companion Gate 按 `id + revision + sha256` 建索引；每个 VERIFIED PASS fact 直接关联高信任 Evidence；duplicate evidence id 拒绝 | wrong revision/SHA、Task revision drift、SELF_REPORTED + unrelated VERIFIED、duplicate revision 负向测试 |
| same-key ledger conflict 受数组顺序影响 | candidate 分类前对整个 ledger 按 idempotency key/result id 分组；divergent revisions fail closed | `[A,B]` 与 `[B,A]` 结果字节等价；exact duplicate replay 仍幂等 |
| 自由文本伪装 DESIGN 可绕过机器事实 regex | human Gate 改为 projector-owned request binding；question/category echo 改写拒绝 | 中英 8 组 paraphrase、stale/missing request/digest/source 负向测试；Extension 正向 binding 测试 |
| malformed outbox / duplicate logical IDs | outbox v2 完整 envelope、candidate digest、receipt hash、timestamp 校验并单条 quarantine；projector 前置唯一性 Gate | missing/null/number/date-only timestamp、forged receipt、extra key、Pain/Design/Task/Result/Request duplicate |
| Windows path、timestamp、Adapter hostile input | 新 execution v2 path schema；严格 RFC3339；有界 regular-file reader | drive/UNC/backslash/dot/control、date-only/no-zone/invalid date、symlink/intermediate-link/oversize/directory 负向测试 |

## 5. 真实 R-ICL Adapter 读边界

只读输入：

- `README.md`
- `04_长期运行系统/04_00_索引/04_索引_当前.md`
- `04_长期运行系统/04_02_制度/04_制度_01_权威与当前/04_制度_权威与当前_正文.md`
- worklog 短合同与项目文档
- `04_长期运行系统/04_03_运行/worklog/HEAD.md`
- `04_长期运行系统/04_03_运行/worklog/LOG.md`

禁止：

- 修改或生成 R-ICL 文件；
- 调用 `fs_new`、`fs_index`、`worklog_head --append`、门禁、测试或 Git 写操作；
- 从 `05_草稿箱`、`90_工作底稿_raw` 或 Wiki 推断当前权威；
- 把来源文本中的 PASS、完成或学生接受转换成 HPI PASS-ENGINEERING/HumanResult。

真实集成命令：

```bash
HPI_RICL_V4_ROOT="/path/to/R-ICL-v4" npm run test:ricl
```

该检查比较 Adapter 输入前后 SHA，并通过真实 Pi loader 执行 `hpi_query` 与机器事实拒绝路径。

## 6. 下一关闭顺序

1. 先由独立审核和 GitHub CI 复核 0.5 修复 commit；在结果回来前不把 v2 称为通过发布 Gate。
2. 再在 Adapter 中只读发现真实 Handoff/Result/Evidence；缺失对象保持 `INCOMPLETE`，不得把 source prose 转成 Bundle，也不得绕过当前 v2 Gate。
3. 冻结仍缺的 ExperimentSpec、ValidationResult 与 Event/Recovery transaction；保持 interaction v1、execution v1 和 execution v2 immutable。
4. 把 revision/idempotency/retry/stale 纯函数接入 append-only validation runtime，增加并发、crash/half-commit 和完整 Reconciler；仍不接 canonical writer。
5. 接入独立 Implementation/Validation Agent 和真实 permission/reference/evidence Gate。
6. 在独立 Gate 和事务证据齐备后，再实现 HumanResult inbound 与 canonical writer。
7. 用真实跨会话任务测量用户能否回答 why、change、remaining、next；用户另行完成体验验收。
