# HPI execution wire contract v1

本目录冻结独立的 `hpi/wire/execution/v1` JSON Schema 2020-12 集。它扩展、但**不修改**已经冻结的 `hpi/wire/v1` 交互对象集。

## 覆盖对象

- `TaskSlice`：语义关联、冻结输入、权限、验收、失败和回滚边界；
- `HandoffBundle`：发送/接收身份、任务 revision、输入 SHA、权限、输出合同和 orientation-only 摘要；
- `Attempt`：不可覆盖的 attempt revision、terminal 状态和 `retry_of`；
- `Evidence`：pointer、SHA、验证层级、责任 Agent、限制和敏感级别；
- `ResultBundle`：MachineResult、Evidence、attempt、失败语义、未完成项和幂等键；
- `StaleReport`：上游 revision 漂移对下游对象的 `STALE` / `NEEDS_REVIEW` 保守传播预览。

`execution-common.v1.schema.json` 仅提供共享定义。`ResultBundle` 复用 `hpi/wire/v1` 的 `MachineResult`，所有冻结引用都必须同时携带逻辑 ID、revision 和 SHA-256。

## 冻结边界

| 边界 | 值 |
|---|---|
| Schema set | `hpi/wire/execution/v1` |
| 外部键名 | snake_case only |
| 依赖 | `hpi/wire/v1` 的固定 schema-set digest |
| 记录语义 | immutable revision；retry 新建 attempt |
| Result authority | `CANDIDATE_ONLY_NOT_PROJECT_CANONICAL` |
| Stale/Reconciler | `PREVIEW_ONLY`，不自动失效 canonical |
| Runtime intake | `not_implemented` |
| Canonical writer | `not_implemented` |

Schema 能校验形状，`src/execution.mjs` 额外校验 JSON Schema 无法表达的跨字段不变量：实现/验证身份分离、allow/deny 不重叠、同逻辑 ID 的 supersedes、内容 revision、Bundle 内 task/attempt/evidence 绑定、幂等冲突、retry 只能从失败 terminal attempt 创建，以及上游 logical ID 一致。

成功提交采用无环 revision 顺序：先冻结 `RUNNING` Attempt snapshot，ResultBundle 的 `attempt_ref` 指向它；随后创建同一 `attempt_id` 的 terminal `SUCCEEDED` revision，以 `supersedes` 指回 RUNNING snapshot，并用 `terminal_result_ref` 指向 ResultBundle。ResultBundle 不能反向引用这个尚未存在的 terminal revision。`retry_of` 则始终指向**不同**的旧 attempt ID。

ResultBundle 的幂等键只绑定 frozen `task_ref + handoff_ref + attempt_ref`，不绑定时间戳、摘要或结果正文。同一 attempt 的逐字 replay 返回既有 revision；同一键的不同内容是 conflict。retry 因为使用新的 attempt ID/revision，自然得到新的幂等键。

## 明确不声称

- 本集合不是 Agent dispatcher、event store、filesystem/permission Gate 或 canonical transaction；
- synthetic fixture 不是运行证据；
- `ResultBundle` schema 通过不等于结果已接受、已 commit 或已独立验证；
- `StaleReport` 只是确定性预览，不是完整 Reconciler，也不修改下游记录；
- R-ICL v4 当前权威读集仍没有可消费的这些对象，因此真实投影继续保持 `INCOMPLETE`；
- `ExperimentSpec`、ValidationResult、完整 Event/Recovery transaction 仍未冻结。

## 兼容与版本

本目录的 schema bytes、逐文件 SHA、依赖 digest 和完整集合摘要由 `manifest.v1.json` 与 `src/wire-schema.mjs` 的 trust anchor 固定。v1 不做原地字段或语义修改；破坏性变化发布新的 schema/object 版本或 schema set。

正负 fixture 位于 `tests/fixtures/execution-wire-contract/`；验证入口：

```bash
npm run test:execution-wire
npm run verify
```
