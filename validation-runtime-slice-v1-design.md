---
type: validation-runtime-design
contract_id: HPI-VRS1-DESIGN
revision: 1
status: implementation-authorized
created: 2026-08-31
updated: 2026-08-31
authority: MACHINE_VALIDATION_ONLY
formal_ts001_status: NOT-RUN
---

# Validation Runtime Slice V1 设计与权威合同

## 1. 决策与边界

本里程碑实现一个**隔离的机器验证尝试 runtime**，不是正式 TS-001 执行，也不是 Harness Core、canonical writer 或 HumanResult runtime。

用户已批准基线优先路线与本修订范围。该批准只授权实现方向；它不自动生成 HPI CandidateEvent、HumanResult、P0 接受、TS-001 PASS 或 canonical 入库授权。

端到端路径固定为：

```text
显式 ValidationAttempt manifest
→ 确定性 intake
→ V1 局部 integrity / reference / workspace Gate
→ append-only ValidationAttemptRecord
→ MachineResult
→ 受限 HPS 投影
→ Human Brief
```

## 2. 权威矩阵

| 对象/字段 | V1 权威 | 明确无权 |
|---|---|---|
| ValidationAttemptInput | 声明一次机器验证输入、冻结引用和隔离写根 | 改变项目 Intent、Pain、Design、Task 接受状态 |
| ValidationAttemptRecord | 本验证尝试的历史、phase、Gate 结果、receipt 与 replay identity | 成为项目 current/canonical/worklog、批准范围或语义结果 |
| MachineResult | V1 局部机器检查结果 | 代表正式 TS-001、独立 Validation Agent 或 P0 通过 |
| 受限 HPS / Human Brief | 展示机器尝试、证据、限制、remaining 和 next | 写 HumanResult、改变 human status、把来源 prose 变成 PASS |
| 隔离 store | 保存 validation-attempt immutable records 和结果快照 | 保存或覆盖项目 canonical 语义状态 |

固定 authority profile：

```json
{
  "mode": "MACHINE_VALIDATION_ONLY",
  "project_canonical_write": "FORBIDDEN",
  "project_semantic_state_write": "FORBIDDEN",
  "human_result_intake": "FORBIDDEN",
  "candidate_event_intake": "FORBIDDEN",
  "agent_dispatch": "FORBIDDEN",
  "automatic_canonical_invalidation": "FORBIDDEN",
  "network": "DENY"
}
```

任何字段缺失、值变化或 extra key 都 fail closed。

## 3. 唯一输入边界

V1 不做目录发现。唯一入口是调用方显式给出的一个 project-relative manifest 路径。

manifest 只能声明：

- 一个受支持项目：`HPI-TS001-PILOT`；
- 一个 Adapter：`ts001-pilot/0.1.0`；
- 一个 attempt family：`TS001_VALIDATION_RUNTIME_V1`；
- 一个 validation attempt ID；
- 一个 Task frozen ref；
- 非空 contract refs 与 input refs；
- 与全部 ref pointer 精确相等的 declared read set；
- 固定前缀下的唯一隔离写根；
- 当前 execution-v2 与 validation-runtime-v1 schema-set identity；
- 固定 authority profile；
- 可选 retry-of record ref；
- 明确时区的 RFC3339 declared time。

禁止从 PRD prose、Agent summary、聊天、草稿/raw tree、CandidateEvent、session outbox 或邻近文件推断额外输入。

## 4. 路径与文件 Gate

### 4.1 读取

- 只读 manifest 声明的普通文件；
- 所有路径必须是 host-independent POSIX project-relative path；
- 拒绝 absolute、drive、UNC、backslash、control、空段、`.` 与 `..`；
- 拒绝中间/最终 symlink、非普通文件、越界 realpath；
- 单文件最大 2 MiB；
- inspection-to-read 使用 device/inode 检查；
- ref SHA 必须匹配实际原始 bytes。

### 4.2 写入

唯一允许的项目内写根：

```text
.pi/artifacts/hpi-validation/v1/<validation_attempt_id>/
```

- 每一级必须是非 symlink 目录；
- 目录 mode 0700，文件 mode 0600（平台支持时）；
- 不允许调用方扩大写根；
- 不写 source、schema、fixture、README、canonical、worklog 或 Pi session 文件；
- network 固定 DENY。

## 5. 冻结 wire lineage

新增独立 schema set：

```text
hpi/wire/validation-runtime/v1
```

它依赖：

1. `hpi/wire/v1`；
2. `hpi/wire/execution/v2`，后者继续锁定 preserved execution-v1。

既有 interaction-v1、execution-v1、execution-v2 bytes 不得修改。新集合使用 snake_case-only 外部键，并冻结：

- `validation-runtime-common.v1.schema.json`；
- `validation-attempt-input.v1.schema.json`；
- `validation-attempt-record.v1.schema.json`；
- `manifest.v1.json`。

JSON Schema 只负责可表达的结构；完整 identity、digest、ref resolution、state transition、record revision 和 chain equality 由确定性 companion validator 强制。

## 6. ValidationAttemptInput V1

外部对象 schema：`hpi/wire/validation-attempt-input/v1`。

关键字段：

| 字段 | 语义 |
|---|---|
| `validation_attempt_id` | 安全、稳定、单次尝试唯一 ID |
| `attempt_family` | 固定 `TS001_VALIDATION_RUNTIME_V1` |
| `project_id` | 固定 `HPI-TS001-PILOT` |
| `adapter` | 固定 id/version |
| `task_ref` | 完整 `id + revision + sha256 + pointer` |
| `contract_refs` | 非空、无完整 identity 重复 |
| `input_refs` | 非空、无完整 identity 重复 |
| `declared_read_set` | 与全部 ref pointer 精确闭合，无旁读 |
| `isolated_write_root` | 固定为 attempt 专属根 |
| `input_digest` | 结构化输入身份摘要 |
| `input_revision` | 除自身外完整 manifest 的 immutable content revision |
| `execution_contract` | current execution-v2 set/digest |
| `validation_contract` | validation-runtime-v1 set/digest |
| `authority` | 固定 MACHINE_VALIDATION_ONLY profile |
| `retry_of` | 可选，必须精确指向旧 attempt 最新 record |
| `declared_at` | 严格 RFC3339 timestamp |

`input_digest` 不包含 `declared_at`、`input_revision` 或 `retry_of`；它绑定项目、Adapter、Task、contract/input refs、read set、write root、contract sets 与 authority profile。

`input_revision` 绑定除自身外的完整 manifest。

## 7. ValidationAttemptRecord V1

外部对象 schema：`hpi/wire/validation-attempt-record/v1`。

每次 phase 变化产生新的 immutable record 文件，不覆盖旧记录。

关键字段：

- `record_id`；
- `record_revision`；
- `validation_attempt_id`；
- `sequence`；
- `phase`；
- `outcome`；
- `input_ref`；
- `runtime`；
- `authority`；
- `gate_outcomes`；
- 可选 `machine_result_ref`；
- 可选 `previous_record_ref`；
- `recorded_at`。

`record_revision = sha256(record without record_revision)`。

## 8. 最小状态机

```text
DECLARED → ACCEPTED → RUNNING → TERMINAL
```

允许的 terminal outcome：

- `MACHINE_RESULT_PRODUCED`；
- `INPUT_REJECTED`；
- `INCOMPLETE_INTERRUPTED`；
- `BLOCKED_CONFLICT`。

规则：

1. sequence 从 0 开始且连续；
2. sequence > 0 必须精确引用前一 record；
3. 所有 record 必须绑定同一 attempt 和同一 input ref；
4. terminal 后不得追加；
5. exact replay 返回已有 terminal receipt/result，不追加；
6. 同 attempt ID 的 divergent input revision/digest 返回 deterministic conflict，不作为 replay；
7. 非 terminal history 在 fresh process 中只解释为 interrupted/incomplete，不恢复成成功；
8. retry 必须使用新 attempt ID，并以 `retry_of` 精确引用旧 attempt 最新 record；
9. V1 不从任意 partial phase 自动继续执行。

## 9. Store 与原子边界

布局：

```text
.pi/artifacts/hpi-validation/v1/<attempt_id>/
  input/
    manifest-<sha256>.json
  records/
    000000-<record_revision>.json
    000001-<record_revision>.json
  machine-results/
    <result_id>-<sha256>.json
  .lock/
    owner.json
```

- temp 文件先以 exclusive create 写入、fsync，再 atomic rename；
- accepted record 发布后 fsync 其目录；
- 目标文件存在时只允许 byte-equivalent replay；
- attempt lock 使用 atomic directory create；正常退出删除；异常残留不自动夺锁；
- 残留 lock、temp 文件、sequence 缺口、chain mismatch、未知文件或 revision mismatch 均 fail closed；
- crash 后以新 attempt retry，不实现 stale-lock reclaim 或通用 Reconciler。

Store 只对自身 attempt history 有权威。删除整个 store 必须只影响验证历史，不要求恢复项目语义状态。

## 10. V1 局部 Gate

| Gate | 检查 | 不声称 |
|---|---|---|
| `V1_SCHEMA` | manifest/record 严格结构与 closed keys | 完整 Harness G-SCHEMA |
| `V1_IDENTITY` | attempt、Task、ref、schema-set identity | Agent 身份/角色分离已完成 |
| `V1_REFERENCE` | 显式 pointer 存在、regular、hash 匹配 | 通用 reference/evidence runtime |
| `V1_WORKSPACE` | read set 闭合、write root 固定、network DENY | 完整 filesystem sandbox/G-PERMISSION |
| `V1_AUTHORITY` | 禁止 canonical/HumanResult/CandidateEvent/dispatch | 已实现 canonical transaction |

任何失败产生 BLOCKED/INCOMPLETE 机器结果或无写入拒绝，不产生 Human Escalation。

## 11. MachineResult 与受限投影

通过 V1-local Gates 只允许产生**范围限定**的 MachineResult。其事实必须明确说明：

- 检查对象是 validation-runtime attempt；
- 不是正式 TS-001；
- 没有独立 Validation Agent；
- 没有 canonical/HumanResult authority。

受限投影：

- 使用独立 Adapter label `ts001-validation-runtime/0.1.0`；
- source snapshot 包含 base read-only sources、attempt records 与 MachineResult snapshot；
- primary task 是 validation-only task，`humanStatus=NOT_NEEDED`；
- project/milestone authority 仍保持 `INCOMPLETE`，不得把 TS-001 `test_status` 改出 `NOT-RUN`；
- 可更新的只有 validation attempt status、machine evidence summary、limitations、unresolved 和 latest machine change；
- 当前 base source 若不再匹配历史 result 引用，ledger 保留历史字节，当前投影降为 `INCOMPLETE`，不得自动 invalidation 或改写历史；
- 不创建 HumanResult、Pain/Design 接受或 canonical provenance。

## 12. `/reload` 与 fresh-process 验收

Issue #2 不阻塞编码，但 `/reload` 不能作为 restart/replay 证据。

所有恢复验收跨真实进程边界：

1. process A fresh start；
2. 写入 attempt record；
3. process A 正常退出或在 non-terminal phase 停止；
4. 完全 fresh process B；
5. process B 读取 store；
6. exact replay、conflict 或 interrupted/incomplete 结果必须确定。

单独保留 stale `/reload` 负向测试：runtime/contract identity 不一致时零写入、fail closed。

## 13. Developer conformance 与正式 TS-001 分离

Developer conformance lane 可重复运行 TS-001 风格的 schema、ref、path、idempotency、retry 和 recovery 场景，但这些结果只属于 V1 实现任务。

正式 TS-001 lane 后置，必须同时具备 §9.1 的真实授权来源和独立 Validation Agent。不得复用 developer-run receipt 作为正式证据。直到该里程碑，`TS1-TEST-001.test_status` 始终为 `NOT-RUN`。

## 14. Stop 条件

出现任一情况立即停止 V1 扩展：

- replay 依赖 canonical 写入；
- chat、CandidateEvent 或 HumanResult 被用来证明 runtime 正确；
- 自报/prose 被提升为 PASS；
- conflict 被静默修复；
- crash-interrupted 无法与 completed 区分；
- store 写出隔离根；
- 实现需要通用 Reconciler、Agent dispatch 或 canonical transaction 才能继续；
- 既有 frozen schema bytes 需要原地修改。

## 15. 验收清单

- manifest closed schema 与 companion validator 一致；
- 全部 ref 原始 bytes hash 匹配；
- preview 零写入；
- run 只写隔离 store；
- exact replay 不追加；
- divergent attempt conflict；
- retry 新 attempt；
- crash/non-terminal 不伪造 terminal；
- fresh-process recovery 确定；
- source/canonical 文件前后 hash 不变；
- restricted HPS/Human Brief 可重建；
- Machine/Human 双轴不串写；
- formal TS-001 保持 NOT-RUN；
- Extension 在 unsupported/untrusted project fail closed；
- `/reload` stale identity 零写入；
- Windows/Linux 路径与 schema byte 验证通过。

## 16. 明确后置

- 正式 TS-001 runner 与独立 Validation Agent；
- HumanResult intake 和 canonical writer；
- Implementation Agent dispatch / full multi-Agent runtime；
- 通用 Reconciler / project transaction engine；
- 完整 filesystem permission/evidence runtime；
- 多项目、通知、RAG、个性化和更丰富可视化。
