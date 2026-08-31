# Human Project Interaction for Pi

Human Project Interaction（HPI）是面向多 Agent、跨会话项目的**只读交互层**。它从宿主项目声明的权威材料重建 Human Project State 与 Human Brief，让人理解 why、change、remaining、next，同时拒绝把测试、hash、Schema 和证据链等机器事实转嫁给人确认。

## 当前版本与冻结边界

- **TS-001 Adapter `ts001-pilot/0.1.0`**：冻结的自包含试点，只读本目录三份材料；机器状态保持 `NOT-RUN`。
- **Package `0.5.0` candidate**：修复前三次独立审核定位的 PASS provenance/coherence、幂等 ledger、Escalation Gate、恢复与路径合同缺口；保留 execution v1 历史字节并发布 `hpi/wire/execution/v2`。
- **完整 P0：未关闭**。详见 [FR-001～FR-024 覆盖矩阵](HPI_FR_coverage_matrix.md)。

已实现的试点能力：

- 内容寻址、可重建的 Human Project State / Human Brief；
- Machine Result / Human Result 双轴状态；
- 确定性 Human Escalation Gate；
- Pi session-only CandidateEvent outbox；
- `hpi_query`、`hpi_propose`、`/hpi` 和生命周期 hooks；
- task-layer `human-project-interaction` Skill；
- `hpi-project` `/talk` style，含 L0–L4 渐进披露和事件回传；
- TS-001 与 R-ICL v4 两个只读 Adapter；
- `hpi/wire/v1`：六类交互对象的 JSON Schema 2020-12、hash manifest 和 synthetic 正/负 fixtures；
- 历史 `hpi/wire/execution/v1`：原始 0.4.0 set 的 schema、manifest、fixture 和 digest 原样保留；
- 当前 `hpi/wire/execution/v2`：修正跨平台 scoped path，并锁定 interaction v1 + execution v1 的完整 digest；
- 完整 frozen Evidence identity、`claim_refs ↔ fact_id`、唯一且结构完整的全 VERIFIED PASS fact set、全 ledger 幂等、retry 和 stale preview；
- projector-owned EscalationRequest binding、candidate-digest-bound outbox v2、同 event ID divergent-content 冲突隔离、重复 logical ID 拒绝和有界 Adapter 读取；
- 自动测试、GitHub CI、严格 Skill 校验和可逆链接安装。

明确未实现：

- 完整多 Agent runtime / Harness Core；
- 项目 canonical transaction / writer；
- 独立 Validation Agent runtime；
- 真实 filesystem、permission、identity、artifact/reference Gate 与 Agent dispatch；
- Bundle runtime intake、append-only event store、事务 commit 和完整 Reconciler；
- ExperimentSpec、ValidationResult 与 Recovery transaction 的正式 schema/runtime；
- 从按钮、自然语言或 CandidateEvent 自动生成 HumanResult；
- TS-001 工程测试执行或 PASS 裁决。

外部合同使用 **snake_case-only**，并保留完整版本链：

1. `hpi/wire/v1`：交互对象；digest `1d08d1ac…264725`。
2. `hpi/wire/execution/v1`：0.4.0 历史执行合同；digest `450698c6…9e88d1`，保持不可修改。
3. `hpi/wire/execution/v2`：当前执行合同；digest `bccb3739…36439c`，manifest 同时锁定上述两个祖先 digest。

v2 没有原地修补 v1。它修正 host-independent scoped path，并由 companion codec 强制 Evidence/Task 的 `id + revision + sha256` 精确闭合。每条 Evidence ref 的 `claim_refs` 必须包含引用它的 `fact_id`；`PASS-ENGINEERING` 要求非空且全部为 VERIFIED 的事实集，每个事实都直接引用高信任 Evidence。全 ledger 在 replay 分类前检查既存 same-key/same-ID divergent revisions，结果不再依赖数组顺序。

当前 JavaScript camelCase 对象只是内部实现 profile，只能通过 `src/wire.mjs` / `src/execution.mjs` 的显式单向 codec 导出。所有 manifest 的 Inbound runtime 仍是 `not_implemented`。execution lifecycle 只做无副作用的 schema/内容 revision 校验、Result replay 分类、retry candidate 和 stale preview；它不会 dispatch Agent、append event、commit Result、修改下游状态或写 canonical。成功路径仍采用无环顺序：ResultBundle 先引用冻结的 `RUNNING` Attempt snapshot，随后 terminal Attempt 新 revision 才以 `supersedes` + `terminal_result_ref` 回指。

## Adapter 权威边界

### TS-001 试点

只读：

- `human-project-interaction-skills-prd.md`
- `human-project-interaction-skills-technical-design.md`
- `09_TS001_测试与回滚验收.md`

合同权威状态仍是 `test_status: NOT-RUN`。`117/117`、hash 或 Schema 描述最多为 `SELF_REPORTED`。Adapter 只读普通文件、拒绝 symlink/非普通文件/越界 realpath，并对每个权威输入施加 2 MiB 上限。

### R-ICL v4 真实项目

`ricl-v4-readonly/0.1.0` 只读：

- 根 `README.md`；
- 唯一 `04_索引_当前.md`；
- “权威与当前”制度；
- worklog 短合同/项目文档；
- 唯一活 worklog 的 `HEAD.md` 与 `LOG.md`。

它不运行 R-ICL 工具，不修改 current/worklog/index/`库.json`，不从 `05_草稿箱`、`90_工作底稿_raw` 或 Wiki 推断当前权威。来源中的 PASS、完成或学生接受保持材料声明，不会转为 HPI `PASS-ENGINEERING` 或 HumanResult。虽然 execution schema 已冻结，但该权威读集尚无可消费记录且 runtime intake 未实现，当前真实投影继续保守显示 `machine=INCOMPLETE`、`human=NOT_NEEDED`。

## 结构

```text
src/                                  确定性合同、投影、Gate、session outbox
src/adapters/                         Adapter contract、registry、有界权威文件读取、R-ICL 实现
src/wire.mjs                           interaction camelCase → snake_case codec
src/execution.mjs                      execution 公共 facade
src/execution/                         contract、codecs、retry/replay/stale 纯函数
src/wire-schema.mjs                    schema lineage manifest/hash/dependency fail-closed loader
schemas/                               冻结的 hpi/wire/v1 JSON Schema 与 manifest
schemas/execution-v1/                  保留的 hpi/wire/execution/v1 历史合同
schemas/execution-v2/                  当前 hpi/wire/execution/v2 合同与 manifest
extension/hpi/index.ts                Pi Extension
index.ts                              安装后的 package entry
skills/task/human-project-interaction/ task-layer Skill
talk/styles/hpi-project/              /talk html-js style pack
tests/                                单元、wire fixtures、负向、恢复、loader、style、安装测试
tests/integration/                    显式真实项目只读集成
scripts/                              可逆安装与 Skill 校验入口
.github/workflows/ci.yml               Linux Node 22.19/latest + Windows execution-contract CI
```

安装使用符号链接，不复制 Skill、Extension 或 style，因此只有一份源树。

## 安装

要求：Node.js 22.19+（与固定的 Pi `0.84.2` engine 一致）、Pi coding agent，以及现有 `/talk` extension。

```bash
cd <HPI checkout>
npm run verify
npm run link:install
```

目标根目录按以下优先级解析：

1. `HPI_PI_AGENT_DIR`（测试/显式 override）；
2. Pi 官方 `PI_CODING_AGENT_DIR`；
3. legacy `PI_AGENT_DIR`；
4. `~/.pi/agent`。

根目录下创建：

- `skills/task/human-project-interaction`
- `extensions/hpi`
- `talk/styles/hpi-project`

安装器先检查全部目标；有冲突时在写入前整体拒绝。完成后重载 Pi。

```bash
npm run link:status
npm run link:uninstall
```

卸载只删除仍准确指向本项目的受管链接。

## 使用

在支持的项目根目录启动 Pi：

```text
/hpi
/hpi status
/hpi brief
/hpi trace <object-id>
/hpi wire [object-id]
/hpi decisions
/hpi verify
```

`/hpi` 路由到 Skill。Skill 将 `hpi_query(op="brief")` 返回的 `talkContentJson` 原样交给 `talk_render(styleId="hpi-project")`。`/hpi wire [id]` 直接返回只读 interaction wire objects，并附当前 execution v2 set/digest、祖先依赖、`available_project_objects: 0` 与 runtime/writer 边界；它不启动 Agent turn，也不接受 inbound 数据。

`hpi_propose(op="escalation")` 不再从任意自然语言 mint HumanEscalationRequest。候选必须绑定 projector 当前产生的 `requestId + requestDigest + sourceDigest`；regex 仅作为额外机器事实拒绝层。`talk_poll_events` 返回的 HPI 事件仍必须完整传给 `hpi_propose(op="ingest_talk_event")`。

合法决策点击最多产生：

```text
CandidateEvent → Pi session outbox → PENDING_CANONICAL_WRITER
```

它不等于 accepted、committed 或 HumanResult。无支持 Adapter 的项目会 fail closed，不扫描全库猜测状态。

## 验证

```bash
npm test
npm run test:wire
npm run test:execution-wire
npm run validate:skill
npm run verify
```

真实 R-ICL 只读集成：

```bash
HPI_RICL_V4_ROOT="/path/to/R-ICL-v4" npm run test:ricl
```

该测试通过真实 Pi loader 执行 Adapter → projection → `hpi_query` → machine-fact rejection，并比较全部 Adapter 输入前后 SHA。

核心负向不变量：

1. 非 PASS 权威状态不能被声明或单个 evidence 升格；
2. `sourceDigest` 必须等于 Adapter + canonical source snapshot 的摘要；
3. 任一 schema byte、manifest hash、set dependency 或 trust-anchor digest 漂移时 fail closed；
4. 外部 wire 只接受 snake_case，混合 camelCase 键拒绝；
5. PASS facts 必须非空、fact id 唯一、结构完整且全部 VERIFIED；`deriveMachineVerdict` 与 MachineResult validator 使用同一 fact-set 合同；Evidence 必须按完整 frozen identity 解析，`claim_refs` 包含精确 `fact_id`，并直接具备高信任状态；
6. execution record revision 必须匹配内容；classifier 先检查完整 existing ledger，排序不能改变 conflict 结果；
7. retry 必须创建新 attempt 并保留旧 terminal record；上游 revision 只传播 `STALE` / `NEEDS_REVIEW` preview；
8. 任意自然语言不能绕过 projector-owned request binding 变成人类问题；
9. outbox v2 将完整 candidate digest 绑定到 receipt；同 `eventId` 不同 digest 产生确定性 `CANDIDATE_IDENTITY_CONFLICT` 且不恢复任一候选；malformed entry 只隔离单条；
10. scoped path 跨平台 fail closed，timestamp codec 成功的对象必须通过 frozen schema；
11. Adapter 不跟随 symlink、不读取非普通或超限权威输入；
12. `NOT-RUN` 不得显示为 PASS；Machine 与 Human 状态不得合并；HPI 不写项目 canonical。

GitHub 私有仓库：`https://github.com/xiangbianpangde/human-project-interaction-pi`。0.4.0 baseline `9b46061`、首个 0.5 修复 commit `0fdaf17` 与第二个候选 `b578cdf` 均被独立审核判定 BLOCK；当前 follow-up candidate 仍需新的独立复核与 CI 结果，不能据此宣称发布通过或完整 P0。
