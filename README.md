# Human Project Interaction for Pi

Human Project Interaction（HPI）是面向多 Agent、跨会话项目的**只读交互层**。它从宿主项目声明的权威材料重建 Human Project State 与 Human Brief，让人理解 why、change、remaining、next，同时拒绝把测试、hash、Schema 和证据链等机器事实转嫁给人确认。

## 当前版本与冻结边界

- **TS-001 Adapter `ts001-pilot/0.1.0`**：冻结的自包含试点，只读本目录三份材料；机器状态保持 `NOT-RUN`。
- **Package `0.5.0` 只读基线**：精确提交 `c79542b…` 经独立复审给出 RELEASE，并以 merge commit `5cbc57a…` 合入 `main`；TS-001 仍为 `NOT-RUN`。
- **Package `0.6.0` Validation Runtime Slice V1**：Sol 对初始 merge tree 的 BLOCK 已由 corrective commit `cd64c07…` 关闭；同线程复审给出 VRS1-only RELEASE、无剩余 P1/P2，PR #5 以 merge commit `3bbbc42…` 合入 `main`，post-merge Linux/Windows CI 全绿。
- **完整 P0：未关闭**。详见 [FR-001～FR-024 覆盖矩阵](HPI_FR_coverage_matrix.md)。

已实现的试点能力：

- 内容寻址、可重建的 Human Project State / Human Brief；
- Machine Result / Human Result 双轴状态；
- 确定性 Human Escalation Gate；
- Pi session-only CandidateEvent outbox；
- `hpi_query`、`hpi_propose`、`hpi_validation`、`/hpi` 和生命周期 hooks；
- task-layer `human-project-interaction` Skill；
- `hpi-project` `/talk` style，含 L0–L4 渐进披露和事件回传；
- TS-001 与 R-ICL v4 两个只读 Adapter；
- `hpi/wire/v1`：六类交互对象的 JSON Schema 2020-12、hash manifest 和 synthetic 正/负 fixtures；
- 历史 `hpi/wire/execution/v1`：原始 0.4.0 set 的 schema、manifest、fixture 和 digest 原样保留；
- 当前 `hpi/wire/execution/v2`：修正跨平台 scoped path，并锁定 interaction v1 + execution v1 的完整 digest；
- 完整 frozen Evidence identity、`claim_refs ↔ fact_id`、唯一且结构完整的全 VERIFIED PASS fact set、全 ledger 幂等、retry 和 stale preview；
- projector-owned EscalationRequest binding、candidate-digest-bound outbox v2、同 event ID divergent-content 冲突隔离、重复 logical ID 拒绝和有界 Adapter 读取；
- `hpi/wire/validation-runtime/v1`：显式 ValidationAttemptInput/Record、完整 schema-set lineage 与 companion validators；
- `hpi_validation` 的 preview/run/status：局部 Schema/Identity/Reference/Workspace/Authority Gate、隔离 append-only attempt store、exact replay、divergent conflict、retry-new-ID 和 fresh-process interruption recovery；
- validation-only MachineResult → 受限 HPS/Human Brief 投影；局部 PASS 始终与正式 TS-001 `NOT-RUN` 并列展示；
- 自动测试、GitHub CI、严格 Skill 校验和可逆链接安装。

明确未实现：

- 完整多 Agent runtime / Harness Core；
- 项目 canonical transaction / writer；
- 正式 TS-001 runner 与独立 Validation Agent runtime；
- 通用 filesystem sandbox、完整 permission/identity/artifact/evidence Gate 与 Agent dispatch；
- Bundle runtime intake、项目级 event store、事务 commit 和完整 Reconciler（V1 只有隔离 attempt ledger）；
- ExperimentSpec、ValidationResult 与 Recovery transaction 的正式 schema/runtime；
- 从按钮、自然语言或 CandidateEvent 自动生成 HumanResult；
- TS-001 工程测试执行或 PASS 裁决。

外部合同使用 **snake_case-only**，并保留完整版本链：

1. `hpi/wire/v1`：交互对象；digest `1d08d1ac…264725`。
2. `hpi/wire/execution/v1`：0.4.0 历史执行合同；digest `450698c6…9e88d1`，保持不可修改。
3. `hpi/wire/execution/v2`：当前通用执行合同；digest `bccb3739…36439c`，manifest 同时锁定上述两个祖先 digest。
4. `hpi/wire/validation-runtime/v1`：隔离验证尝试合同；digest `598e1ca9…92d3fa`，锁定 interaction v1 与 execution v2。

v2 没有原地修补 v1。它修正 host-independent scoped path，并由 companion codec 强制 Evidence/Task 的 `id + revision + sha256` 精确闭合。每条 Evidence ref 的 `claim_refs` 必须包含引用它的 `fact_id`；`PASS-ENGINEERING` 要求非空且全部为 VERIFIED 的事实集，每个事实都直接引用高信任 Evidence。全 ledger 在 replay 分类前检查既存 same-key/same-ID divergent revisions，结果不再依赖数组顺序。

当前 JavaScript camelCase 对象只是内部实现 profile。interaction 与通用 execution 仍只能经 `src/wire.mjs` / `src/execution.mjs` 单向导出，其 manifest 的 Inbound runtime 保持 `not_implemented`；通用 execution lifecycle 仍只做无副作用 preview。独立 validation manifest 才声明 `inbound_runtime: validation_attempt_input_only`，且只接受一个显式输入，写入 `.pi/artifacts/hpi-validation/v1/<attempt_id>/`。它不 dispatch Agent、不接收 HumanResult/CandidateEvent、不写项目 canonical，也不改变正式 TS-001。通用 execution 成功路径仍采用无环顺序：ResultBundle 先引用冻结的 `RUNNING` Attempt snapshot，随后 terminal Attempt 新 revision才回指结果。

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

它不运行 R-ICL 工具，不修改 current/worklog/index/`库.json`，不从 `05_草稿箱`、`90_工作底稿_raw` 或 Wiki 推断当前权威。来源中的 PASS、完成或学生接受保持材料声明，不会转为 HPI `PASS-ENGINEERING` 或 HumanResult。虽然 execution schema 已冻结，但该权威读集尚无可消费记录且通用 runtime intake 未实现，当前真实投影继续保守显示 `machine=INCOMPLETE`、`human=NOT_NEEDED`。

## Validation Runtime Slice V1

完整设计与权威矩阵见 [`validation-runtime-slice-v1-design.md`](validation-runtime-slice-v1-design.md)。V1 固定状态机为 `DECLARED → ACCEPTED → RUNNING → TERMINAL`，并只对自身 attempt history、receipt 与 replay identity 有权威。五个局部 Gate 为 `V1_SCHEMA`、`V1_IDENTITY`、`V1_REFERENCE`、`V1_WORKSPACE`、`V1_AUTHORITY`。

attempt store 使用 exclusive lock、0700 store 目录和 0600 文件。写入由隔离子进程从经 device/inode + realpath 核对的 cwd 逐段锚定，temp 写入并 fsync 后以 hard-link 发布实现 atomic no-replace；目标出现、目录替换、unsafe mode/link count 均 fail closed。crash 后保留 non-terminal/lock 证据，不实现 stale-lock reclaim 或自动续跑。受限投影使用 Adapter label `ts001-validation-runtime/0.1.0`，primary task 的 human axis 固定 `NOT_NEEDED`，同时保留正式 TS-001 work item 的 `NOT-RUN`；历史局部 PASS 只有在 persisted Gate/fact 与共享 canonical derivation 精确一致、当前五 Gate 重新验证通过且 Adapter source 未漂移时才保持 current PASS，否则降为 `INCOMPLETE` 或 `null`。删除隔离 store 只删除验证历史，不回滚或修改项目语义状态。

## 结构

```text
src/                                  确定性合同、投影、Gate、session outbox
src/adapters/                         Adapter contract、registry、有界权威文件读取、R-ICL 实现
src/wire.mjs                           interaction camelCase → snake_case codec
src/execution.mjs                      execution 公共 facade
src/execution/                         contract、codecs、retry/replay/stale 纯函数
src/validation-runtime/                intake、Gate、contract/codecs、canonical semantics、cwd-anchored store worker、runtime 与受限投影
src/validation-runtime.mjs             validation runtime 公共 facade
src/wire-schema.mjs                    schema lineage manifest/hash/dependency fail-closed loader
schemas/                               冻结的 hpi/wire/v1 JSON Schema 与 manifest
schemas/execution-v1/                  保留的 hpi/wire/execution/v1 历史合同
schemas/execution-v2/                  当前 hpi/wire/execution/v2 合同与 manifest
schemas/validation-runtime-v1/         ValidationAttemptInput/Record v1 与独立 manifest
extension/hpi/index.ts                Pi Extension
index.ts                              安装后的 package entry
skills/task/human-project-interaction/ task-layer Skill
talk/styles/hpi-project/              /talk html-js style pack
tests/                                单元、wire fixtures、负向、恢复、loader、style、安装测试
tests/integration/                    显式真实项目只读集成
scripts/                              可逆安装与 Skill 校验入口
.github/workflows/ci.yml               Linux Node 22.19/latest + Windows execution/validation runtime CI
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

`/hpi` 路由到 Skill。Skill 将 `hpi_query(op="brief")` 返回的 `talkContentJson` 原样交给 `talk_render(styleId="hpi-project")`。`/hpi wire [id]` 直接返回只读 interaction wire objects，并附 execution v2 与 validation-runtime-v1 lineage；它不启动 Agent turn。

`hpi_validation` 只接受调用方明确给出的 project-relative manifest：

```text
hpi_validation(op="preview", manifestPath=".pi/validation-inputs/<manifest>.json")
hpi_validation(op="run", manifestPath=".pi/validation-inputs/<manifest>.json")
hpi_validation(op="status", attemptId="<attempt-id>")
```

先 preview 再 run。preview 零写入；run 只写 attempt 专属隔离根。相同 input 的 terminal replay 不追加；同 attempt ID 的 divergent input 返回 conflict；non-terminal history 只解释为 `INCOMPLETE_INTERRUPTED`，重试必须使用新 ID 与精确 `retry_of`。`runtime.machineResult` / status 顶层 `machineResult` 始终重新验证当前五 Gate 与 TS-001 read-only snapshot；不可用时为 `null`，任一 Gate 或 source 漂移时降为 `INCOMPLETE`。`history.machineResult` / `historicalMachineResult` 只是不可变历史，不得作为当前 PASS。该工具的 `PASS-ENGINEERING` 只属于 V1 局部 Gate，不是正式 TS-001、P0、HumanResult 或 canonical 接受。

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
npm run test:validation-runtime
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
11. Adapter 与 validation intake 不跟随 symlink、不读取非普通或超限输入；ref SHA 必须等于原始 bytes；
12. validation record 必须连续、内容寻址并完整绑定五个 Gate；所有成功 code/evidence 与 MachineResult kind/statement/evidence/limitations 必须等于共享 canonical derivation；
13. exact replay 零追加；divergent attempt conflict；fresh process 中 non-terminal 永不恢复成完成，残留 lock 不自动夺取；
14. write worker 必须逐段锚定 cwd，atomic no-replace，不跟随替换后的 parent/target；POSIX reopen 必须验证 0700/0600、owner 与单 link；
15. store 外项目权威文件前后 SHA 不变；historical PASS 在 current Gate/source 漂移或不可用时不得由 runtime 或投影显示为当前 PASS；`NOT-RUN` 不得显示为正式 PASS；Machine 与 Human 状态不得合并。

GitHub 私有仓库：`https://github.com/xiangbianpangde/human-project-interaction-pi`。0.5 只读基线候选 `c79542b…` 经独立复审 RELEASE，合并树为 `5cbc57a…`，post-merge CI 全绿。0.6 初始 VRS1 merge commit `5c10b42…`（tree `54b6573…`）的早期本地 RELEASE 曾被 Sol job `29d0ee3f…` 的 BLOCK 覆盖；corrective commit `cd64c07…` 随后经独立精确提交确认和 Sol 同线程 job `2579940c…` 复审均给出 VRS1-only RELEASE、无剩余 P1/P2，以 `3bbbc42…` 合入 `main`，post-merge CI run `33466115725` 三项全绿。该 RELEASE 不得外推为正式 TS-001、完整 P0、HumanResult 或 canonical 接受。
