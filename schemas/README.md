# HPI external wire contracts

本目录保存不可原地修改的 JSON Schema 2020-12 外部合同链：

| Schema set | 路径 | 覆盖 | 状态 |
|---|---|---|---|
| `hpi/wire/v1` | 本目录根文件 | MachineResult、HPS、HumanBrief、EscalationRequest、HumanResult、TraceLink | immutable / current interaction |
| `hpi/wire/execution/v1` | [`execution-v1/`](execution-v1/) | TaskSlice、HandoffBundle、Attempt、Evidence、ResultBundle、StaleReport | immutable / superseded history |
| `hpi/wire/execution/v2` | [`execution-v2/`](execution-v2/) | 同一 execution object family，修正 scoped-path 合同 | immutable / current execution |

execution v1 的 schema bytes、manifest、digest 和 static fixtures 保持 0.4.0 commit 原样。独立审核发现 v1 的路径 schema 无法拒绝 Windows drive、UNC 和 backslash traversal；由于 v1 已冻结，修复发布为 v2，而非修改 v1。

## 唯一命名边界

| 边界 | 规则 |
|---|---|
| 外部 wire | **snake_case only** |
| 当前 JavaScript 内部模型 | camelCase |
| 跨边界 | 只能调用 `src/wire.mjs` / `src/execution.mjs` 中的显式单向 codec |
| 混合键 | `additionalProperties: false`，拒绝 |
| 交互对象 | `hpi/wire/<object>/v1` |
| 当前 execution 对象 | `hpi/wire/<object>/v2` |
| JSON Schema `$id` | `urn:hpi:wire:<object>:<version>` |

不支持自动大小写猜测、双读双写或“两个名称都接受”。当前 codec 只支持**内部对象 → 外部 wire**。全部 manifest 均声明 `inbound_runtime: not_implemented`；schema 通过不会打开 Bundle/HumanResult intake、Agent dispatch、canonical writer 或项目状态写入。

## 冻结、依赖与兼容

每个 manifest 固定：

1. schema 文件名与 `$id`；
2. 每个 schema 的 SHA-256；
3. schema 集摘要；
4. 命名和 inbound runtime 边界；
5. 精确上游 schema-set digest。

当前 dependency chain：

```text
hpi/wire/v1
  └─ hpi/wire/execution/v1
       └─ hpi/wire/execution/v2
```

v2 manifest 同时钉住 interaction v1 和 execution v1 digest。`src/wire-schema.mjs` 保存全部 trust anchor；manifest、schema byte、依赖 digest 或 trust anchor 任一不一致都会 fail closed。

任何字段、必填性、枚举或语义变化都必须发布新的 schema/object 版本或 schema set。旧版本及其 fixture 必须保留。

## JSON Schema 与 companion validator

JSON Schema 校验单对象形状；`src/execution/` 负责无法由 JSON Schema 表达的跨记录不变量。当前 v2 要求：

- frozen identity 等于 `id + revision + sha256`，pointer 不参与身份；
- Evidence 的 Task ref 必须精确匹配 ResultBundle Task revision；
- MachineResult 的每个 Evidence ref 必须精确解析到 bundle 携带的一条 Evidence revision；
- 每条 Evidence ref 的 `claim_refs` 必须包含引用它的精确 `fact_id`；
- `PASS-ENGINEERING` 必须有非空、全部为 VERIFIED 的事实集，且每个 fact **直接**引用 `HARNESS_VERIFIED` 或 `INDEPENDENTLY_VALIDATED` Evidence；
- 重复 `fact_id` 或相同 `evidence_id` 的多个 revision 视为歧义并拒绝；
- classifier 在判断 candidate replay 前先检查完整 existing ledger；same-key 或 same-ID divergent revisions 与数组顺序无关地 fail closed；
- codec timestamp 采用带显式 timezone 的严格 RFC3339；任何 codec 成功对象必须通过当前 frozen schema；
- scoped path 采用 host-independent POSIX project-relative grammar，拒绝 backslash、drive/UNC、control chars、空 segment、`.` 和 `..`。

Schema 单独通过不等于这些跨对象 Gate 已通过。

## 状态与权限边界

- ResultBundle：`CANDIDATE_ONLY_NOT_PROJECT_CANONICAL`；
- StaleReport：`PREVIEW_ONLY`、`automatic_invalidation: false`；
- retry：创建不同 attempt ID；
- terminal Attempt revision：可以 supersede 同一 attempt ID 的 RUNNING snapshot；
- execution runtime intake、event append、commit、Reconciler、HumanResult intake、canonical writer：仍未实现。

本目录不能用于宣称真实 ResultBundle 已执行、独立 Validation Agent 已运行、TS-001 已 PASS 或完整 P0 已关闭。

## Fixtures 与验证

- `tests/fixtures/wire-contract/`：interaction v1；
- `tests/fixtures/execution-wire-contract/`：保留的 execution v1 fixture；
- `tests/fixtures/execution-wire-contract-v2/`：当前 execution v2 fixture；
- `tests/wire-contract.test.mjs`：interaction schemas/hash/codec；
- `tests/execution-wire.test.mjs`：v1 历史保留、v2 strict compile、dependency/hash tamper、完整 Evidence/claim binding、PASS coherence、ledger conflict、retry、stale、path 与 timestamp。

所有 fixture authority 均为 `SYNTHETIC_TEST_ONLY_NOT_PROJECT_CANONICAL`。

```bash
npm run test:wire
npm run test:execution-wire
npm test
```
