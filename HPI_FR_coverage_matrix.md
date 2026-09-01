---
title: HPI FR-001～FR-024 实现、缺口与验证证据矩阵
document_id: HPI-FR-MATRIX-001
revision: 0.5
status: implementation-snapshot
updated: 2026-08-31
scope: HPI package 0.6.0 implementation candidate; interaction-v1 + preserved execution-v1 + execution-v2 + validation-runtime-v1; TS-001/R-ICL read-only Adapters
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
| FR-004 | MachineResult 记录 verdict、输入、命令、环境、证据、hash、side effect、限制和未验证项 | **部分实现** | interaction v1 schema 保持冻结；validation-runtime-v1 产生局部 MachineResult，PASS 必须一 Gate 一 VERIFIED fact 并引用 immutable RUNNING record；限制明确排除正式 TS-001 | 仍缺正式 runner 的命令/环境/log artifact、side effects 与独立 Validation Agent 层 |
| FR-005 | HumanResult 记录明确决定、范围、理由、影响、风险和 supersedes | **未实现** | `schemas/human-result.v1.schema.json` 已冻结，synthetic fixture 验证 explicit human actor 且不含 machine verdict；公共 API仍无 accept/commit/write-state | Schema 不等于 runtime；inbound 明确 `not_implemented`，仍需独立 Gate、事务、supersedes 与 canonical writer，且不得从 CandidateEvent 自动生成 |
| FR-006 | terminal、暂停、失败或待决状态自动生成 brief；首屏回答十个问题 | **部分实现** | validation terminal/rejected/interrupted history 可重建受限 HPS/Brief；L0/L1 同时保留局部 verdict、正式 NOT-RUN、remaining 与风险 | 只覆盖 validation attempt；未接通用 task hooks，未验证多任务聚合和十问体验覆盖率 |
| FR-007 | Human Escalation Gate；机器事实不升级，证据不足返回机器不完整 | **试点已实现** | human escalation 只能绑定 projector 当前 `requestId + requestDigest + sourceDigest`；任意 DESIGN/RISK 自由文本不能 mint request；regex 只作额外拒绝；中英机器事实 paraphrase 负向覆盖 | 仍不替代宿主 filesystem/schema/reference 验证器；未来 projector request producer 需保持同一受信边界 |
| FR-008 | 默认语义摘要，按需展开结果、trace 和 raw evidence | **试点已实现** | `hpi-project` style 的 L0/L1 默认展示、L2–L4 折叠；浏览器渲染与事件路径已验证 | 尚缺真实用户对层级、密度和恢复时间的体验验收 |
| FR-009 | 每次更新说明 changed、why、impact、remaining 和 next | **部分实现** | TS-001 使用材料变化；R-ICL 读取最新类型化 LOG 事件；Brief 保留 changed/remaining/next | impact 尚不是独立 typed 字段；没有 last-seen per-user revision |
| FR-010 | Machine status 与 Human status 双轴存储，不互相覆盖 | **试点已实现** | 合同、HPS、talk payload 和 UI 使用闭集双轴；不存在 `overallStatus`；负向测试覆盖 | 后续 canonical HumanResult writer 仍需保持同一不变量 |
| FR-011 | 定义、需求、状态、决定使用 revision；新 revision 保留 supersedes | **部分实现** | execution v1 历史字节保留；v2 继续使用内容 revision、同 logical ID supersedes 和无环 RUNNING Result → terminal Attempt revision；上游变化只生成 `STALE` / `NEEDS_REVIEW` preview | 纯函数不追加 revision event；尚无定义/决定的 canonical transaction、expected-version lock 或下游状态写入 |
| FR-012 | Handoff/Result 包含身份、任务、版本、权限、证据和失败语义 | **部分实现** | execution v2 校验完整 Task/Evidence frozen identity、`claim_refs ↔ fact_id`、all-VERIFIED PASS coherence；旁挂或错误 claim Evidence 不授予 PASS | R-ICL 权威读集仍无这些记录；缺真实 Implementation/Validation Agent dispatch、intake、permission Gate 和 commit |
| FR-013 | 重复提交幂等；retry 新 attempt；无第二次 commit | **部分实现** | 通用 Result classifier 仍为 pure preview；validation attempt 使用 exclusive lock + append-only records，exact replay 零追加，same-ID divergent input conflict，retry 新 ID 并精确绑定旧 latest record | 仅为隔离 validation ledger；缺项目级并发 transaction、Bundle commit、expected-version lock 与 canonical rollback |
| FR-014 | NOT-RUN/INCOMPLETE/DEVIATIONS/BLOCKED、恢复路径和 Reconciler | **部分实现** | validation fresh process 将 non-terminal 固定解释为 INCOMPLETE_INTERRUPTED，残留 lock/unknown/temp/chain drift fail closed且不夺锁；outbox conflict 与 StaleReport preview 保留 | 不实现自动续跑、stale-lock reclaim、通用 Reconciler、项目 half-commit 扫描或下游状态更新 |
| FR-015 | 用户可创建新 Pain 并关联触发证据 | **部分实现** | `hpi_propose(op="pain")` 创建 source-bound session candidate | 候选没有项目 canonical writer；触发证据和范围裁决尚未正式入库 |
| FR-016 | 文件、Schema、hash、引用、路径、状态前置由确定性检查完成 | **部分实现** | 四套 schema lineage 严格编译；validation V1 对显式 TS-001 refs 执行 bounded regular/no-symlink/raw-byte SHA Gate、read-set closure、固定 write root/network DENY 和 authority Gate | Gate 仅覆盖 closed TS-001 validation slice，不是通用 artifact/permission/evidence sandbox 或 canonical transaction |
| FR-017 | HPS 是既有 canonical/worklog 的可追溯投影，不建第二真源 | **试点已实现** | 两个 Adapter 只读 declared set；读取拒绝 symlink、非普通文件、越界 realpath 和单文件 >2 MiB；R-ICL 只认唯一当前/worklog；query 不写 session | 仅证明两个 Adapter；新宿主仍需逐个声明真源映射与禁止路径 |
| FR-018 | 用户可询问来源、变化、设计和未解决项 | **部分实现** | `hpi_query brief/trace/evidence` 与 L2–L4 可展开 | 缺通用自然语言对象解析、分页和敏感 provenance 过滤策略 |
| FR-019 | 项目级 brief 频率、风险级别和摘要粒度设置 | **未实现** | 无配置 API | 需项目级偏好 Schema、权限和默认策略；不得改变事实轴 |
| FR-020 | 多项目边界视图，不混淆状态 | **部分实现** | Adapter registry 每次只选择一个根；多匹配时 fail closed | 没有多项目 dashboard、项目列表或跨项目待决聚合 |
| FR-021 | 图或表展示 Pain、TaskSlice、Evidence 关系 | **试点已实现** | `/talk` L2 node/trace 视图和 L4 provenance 表 | 目前是单项目、小图谱；未做大型图分页、过滤和用户可用性测试 |
| FR-022 | 长等待/人工待决恢复到相同 revision | **部分实现** | Pi outbox 继续按 digest 恢复；validation attempt 通过真实 process A/B 测试重建 exact terminal 或 interrupted revision，`/reload` 不作为恢复证明 | 缺异步提醒、跨设备 canonical request、长期无人回答策略与通用 task recovery |
| FR-023 | 用反馈优化 brief 重点但不改变事实权限 | **未实现** | 无学习/排序逻辑 | 需先完成体验评估和不可变事实边界；P2 后置 |
| FR-024 | 可审计跨项目模式复用，不把旧结论自动写入新项目 | **未实现** | Adapter registry 只隔离项目，没有知识迁移 | 需可审计模式对象、来源/适用范围和显式采用 Gate；P2 后置 |

## 4. 本轮确定性修复证据

| 问题 | 修复 | 负向证据 |
|---|---|---|
| 单个 VERIFIED fact 掩盖 FAILED/NOT_RUN/INCOMPLETE/SELF_REPORTED，或重复/无身份 fact 可升为 PASS | `deriveMachineVerdict` 与 MachineResult companion validator 共享非空、结构完整、fact id 唯一且全部 VERIFIED 的 fact-set 合同；任一不一致保持/降为 INCOMPLETE | `tests/contracts.test.mjs` 覆盖四类 mixed-status、空、重复/缺失 id 与 malformed Evidence ref；execution test 覆盖 derivation、validator、interaction/execution codec 和 v2 schema |
| 伪造 `sourceDigest` 可通过 | digest 必须等于 `sha256({adapter, canonical sourceSnapshot})` | `tests/adapter-contract.test.mjs`、`tests/projector.test.mjs` |
| 安装器忽略 Pi 正式配置变量 | 优先级改为 HPI override → `PI_CODING_AGENT_DIR` → legacy `PI_AGENT_DIR` → default | `tests/install.test.mjs` |
| uninstall/rollback 按旧 pathname classification 删除并发替换后的非 HPI entry | 同一 Agent 根用 fail-closed lock 串行化；目标先原子移动到随机 quarantine，再重新验证 link target 与 entry identity；ownership drift 保留并报告，不删除 | regular file、foreign symlink/junction、quarantine final-check、rollback 与 residual-lock 负向测试；exact candidate `8393d3d…` 经 Sol follow-up `38ed711f…` 关闭原 P2，PR #8 merge tree 相同，exact-head/post-merge Linux/Windows CI `33487922214` / `33489305184` 全绿 |
| 测试固定 Homebrew loader 路径 | 从 `pi` executable、`PI_PACKAGE_DIR` 或显式 override 定位 package root | `src/pi-paths.mjs` 与安装/Extension 测试 |
| HULA 错引 `[E12]` | PRD 正文改为 `[E09]` | `human-project-interaction-skills-prd.md` 引用表与正文一致 |
| snake_case/camelCase 合同漂移 | 外部冻结为 `hpi/wire/v1` snake_case-only；内部 camelCase 只经显式 codec 导出 | 7 个 schema 严格编译；schema-set digest `1d08d1ac…264725`；mixed-key、缺字段、错类型、越界枚举和 hash tamper 负向测试 |
| execution Bundle 合同、retry 与 stale 语义缺失 | 保留 execution v1；当前 v2 继续内容 revision、retry 新 attempt 和保守 stale preview | v1 digest `450698c6…9e88d1` 原样回归；v2 digest `bccb3739…36439c`；两个版本与依赖/byte tamper 均验证 |
| PASS 可由错误 Evidence revision、错误 claim 或无关高信任 Evidence 获得 | v2 Gate 按完整 identity 建索引；每条 ref 的 `claim_refs` 含精确 fact id；每个 PASS fact 直接关联高信任 Evidence；duplicate fact/evidence id 拒绝 | wrong revision/SHA、Task drift、wrong claim、旁挂 VERIFIED、duplicate fact/evidence 负向测试 |
| same-key ledger conflict 受数组顺序影响 | candidate 分类前对整个 ledger 按 idempotency key/result id 分组；divergent revisions fail closed | `[A,B]` 与 `[B,A]` 结果字节等价；exact duplicate replay 仍幂等 |
| 自由文本伪装 DESIGN 可绕过机器事实 regex | human Gate 改为 projector-owned request binding；question/category echo 改写拒绝 | 中英 8 组 paraphrase、stale/missing request/digest/source 负向测试；Extension 正向 binding 测试 |
| malformed/divergent outbox / duplicate logical IDs | outbox v2 完整 envelope/digest/receipt/timestamp 校验；same-event divergent digest 整组 quarantine；projector 前置唯一性 Gate | malformed envelope、candidate tamper、`[A,B]`/`[B,A]` conflict 等价、Pain/Design/Task/Result/Request duplicate |
| Windows path、timestamp、Adapter hostile input | 新 execution v2 path schema；严格 RFC3339；有界 regular-file reader | drive/UNC/backslash/dot/control、date-only/no-zone/invalid date、symlink/intermediate-link/oversize/directory 负向测试 |
| Validation attempt replay/recovery 被误当项目权威 | 独立 validation set/authority；cwd-anchored atomic-no-replace store；完整五 Gate chain；persisted success 与 canonical Gate/fact derivation精确相等；runtime/status 重跑 current Gates，restricted projector 在 Gate/base drift/unavailable 时 fail closed；正式 TS-001 保留 NOT-RUN | zero-write preview、store-only diff、parent swap、concurrent target、mode/link count、五 Gate forged PASS、current-result/gate drift、exact replay、divergent conflict、retry success/non-latest/locked、workspace/authority expansion、snapshot cardinality、ref TOCTOU、R-ICL rejection、Linux normal/crash fresh-process 与 Windows runtime tests |

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

1. 关闭全仓 Sol job `2a80405f…` 的 package-level Issue #7：installer ownership-preserving removal 须通过精确提交复审与 Linux/Windows CI；VRS1 RELEASE 不受该包级 P2 影响。
2. 解决或界定 Issue #2；安装/升级后的可靠 fallback 是 fresh Pi process/session，`/reload` 只作 fail-safe 负向，不当恢复证明。
3. 保持 developer conformance 与正式 TS-001 lane 分离；后者必须补齐授权来源与独立 Validation Agent，当前合同继续 `NOT-RUN`。
4. 再在 Adapter 中只读发现真实 Handoff/Result/Evidence；缺失保持 `INCOMPLETE`，不得把 source prose 转成 Bundle。
5. 冻结仍缺的 ExperimentSpec、ValidationResult 与项目 Event/Recovery transaction；既有四套 wire set immutable。
6. 接入独立 Implementation/Validation Agent 与通用 permission/reference/evidence Gate；之后才设计 HumanResult inbound 与受保护 canonical writer。
7. 用真实跨会话任务完成用户体验验收，测量 why/change/remaining/next 恢复成本。
