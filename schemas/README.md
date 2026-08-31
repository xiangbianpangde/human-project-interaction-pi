# HPI external wire contracts

本目录保存两个相互绑定、分别冻结的 JSON Schema 2020-12 外部合同集：

| Schema set | 路径 | 覆盖 | 状态 |
|---|---|---|---|
| `hpi/wire/v1` | 本目录根文件 | MachineResult、HPS、HumanBrief、EscalationRequest、HumanResult、TraceLink | immutable |
| `hpi/wire/execution/v1` | [`execution-v1/`](execution-v1/) | TaskSlice、HandoffBundle、Attempt、Evidence、ResultBundle、StaleReport | immutable；依赖前者固定 digest |

`common.v1.schema.json` 与 `execution-v1/execution-common.v1.schema.json` 只提供共享定义，不是独立业务记录。新增 execution set 没有修改 `hpi/wire/v1` 的任何 schema byte、manifest entry 或 trust-anchor digest。

## 唯一命名边界

| 边界 | 规则 |
|---|---|
| 外部 wire | **snake_case only** |
| 当前 JavaScript 内部模型 | camelCase |
| 跨边界 | 只能调用 `src/wire.mjs` / `src/execution.mjs` 中的显式单向 codec |
| 混合键 | `additionalProperties: false`，拒绝 |
| 外部对象标识 | `hpi/wire/<object>/v1` |
| JSON Schema `$id` | `urn:hpi:wire:<object>:v1` |

不支持自动大小写猜测、双读双写或“两个名称都接受”。这避免 snake_case/camelCase 同时成为公共真源。

当前 codec 只支持**内部对象 → 外部 wire**。两个 manifest 均声明 `inbound_runtime: not_implemented`；因此 schema 通过不会打开 Bundle/HumanResult intake、Agent dispatch、canonical writer 或项目状态写入。

## 冻结、依赖与兼容

每个 `manifest.v1.json` 固定：

1. schema 文件名与 `$id`；
2. 每个 schema 的 SHA-256；
3. schema 集摘要；
4. 命名和 inbound runtime 边界；
5. execution set 对 `hpi/wire/v1` 的精确 schema-set digest 依赖。

`src/wire-schema.mjs` 同时保存两个编译期 trust-anchor digest。manifest、schema 文件、依赖 digest 或 trust anchor 任一不一致都会 fail closed。

冻结集合不做原地结构修改。任何字段、必填性、枚举或语义变化都必须发布新的 schema/object 版本或 schema set；旧 v1 文件与 fixture 保留。内部 camelCase 可以重构，但只要 v1 codec 输出和 schema bytes 不变，就不构成外部破坏性变化。

## 与技术设计草案的关系

技术设计 §5 是“最小协议形状，不是最终 JSON Schema”。`hpi/wire/v1` 固化当前可执行只读交互 profile，并作以下显式收敛：

- HPS 使用内容寻址的 `projection_id`，不写入时间戳，因此相同来源可字节级重建；
- Human Brief 使用独立 `brief_id`，保留 `not_verified`、`remaining` 和 `risk_and_consequence` 必填字段；
- MachineResult 的 `result_revision` 是内部结果对象的内容摘要；当前 material snapshot 可不含 `execution`/`changes`，但 `PASS-ENGINEERING` 必须至少有一个带 evidence 的 `VERIFIED` fact；
- EscalationRequest 的 `category` 不包含 `MACHINE_FACT` 或 `EVIDENCE_GAP`；
- HumanResult 必须是 `explicitness: explicit` 且 `actor.kind: human`，但当前没有 intake/writer；
- TraceLink 保留完整 `SourceRef`，而不是只传展示 ID。

`hpi/wire/execution/v1` 在不改上述对象的前提下收敛执行边界：冻结引用同时需要 ID/revision/SHA；Result 只能是 candidate；retry 新建 attempt；上游变化只产生 `STALE` / `NEEDS_REVIEW` preview，不自动把历史记录判 false 或修改 canonical。跨字段规则由 `src/execution.mjs` 的纯函数补充。

本轮仍不包含 ExperimentSpec、ValidationResult、完整 Event/Recovery transaction、Agent runtime、真正的 Reconciler 或 canonical writer，不能据此宣称完整 P0 或 TS-001 四组工程测试已执行。

## Fixtures 与验证

- `tests/fixtures/wire-contract/`：`hpi/wire/v1` 六类交互对象的纯合成正/负数据；
- `tests/fixtures/execution-wire-contract/`：execution 六类对象的合成正/负数据，含失败 attempt、retry 和 stale preview；
- `tests/wire-contract.test.mjs`：交互 schemas、hash、enum 与 codec；
- `tests/execution-wire.test.mjs`：跨集合严格编译、依赖/hash tamper、内容 revision、身份/权限绑定、幂等 replay、retry 和 stale propagation。

所有 fixture 的 authority 固定为 `SYNTHETIC_TEST_ONLY_NOT_PROJECT_CANONICAL`。其中的 HumanResult、ResultBundle 或 Evidence 都不代表用户决定、真实执行或项目状态。

```bash
npm run test:wire
npm run test:execution-wire
npm run verify
```
