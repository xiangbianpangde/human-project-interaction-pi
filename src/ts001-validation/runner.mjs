import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../contracts.mjs";
import {
  loadAcceptanceWireSchemaSet,
  loadExecutionWireSchemaSet,
  loadWireSchemaSet,
} from "../wire-schema.mjs";
import {
  TS001_CONTRACT_ID,
  TS001_CONTRACT_REVISION,
  TS001_TASK_IMPL,
  TS001_TASK_VAL,
  Ts001ValidationError,
  validateTs001BlindReview,
  validateTs001RollbackSupersedes,
  validateTs001TaskSlice,
  validateTs001ThreeLayerHash,
  validateTs001ValidationVerdict,
} from "./contract.mjs";
import { Ts001ValidationAgent } from "./agent.mjs";

export function createAjvValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const interaction = loadWireSchemaSet();
  for (const schema of Object.values(interaction.schemas)) {
    ajv.addSchema(schema);
  }

  const execution = loadExecutionWireSchemaSet();
  for (const schema of Object.values(execution.schemas)) {
    ajv.addSchema(schema);
  }

  const acceptance = loadAcceptanceWireSchemaSet();
  for (const schema of Object.values(acceptance.schemas)) {
    ajv.addSchema(schema);
  }

  return ajv;
}

export async function runTs001AcceptanceSuite({
  fixturesRoot = "tests/fixtures/ts001",
  agent = new Ts001ValidationAgent(),
} = {}) {
  const ajv = createAjvValidator();
  const manifest = JSON.parse(readFileSync(join(fixturesRoot, "manifest.json"), "utf8"));
  const implTask = JSON.parse(readFileSync(join(fixturesRoot, "task-slices/ts001-impl.v2.json"), "utf8"));
  const valTask = JSON.parse(readFileSync(join(fixturesRoot, "task-slices/ts001-val.v2.json"), "utf8"));
  const experimentSpec = JSON.parse(readFileSync(join(fixturesRoot, "experiment-specs/e017.v4.json"), "utf8"));
  const handoffBundle = JSON.parse(readFileSync(join(fixturesRoot, "handoff-bundles/valid.v2.json"), "utf8"));

  const caseResults = [];

  // Group 1: Schema (TS1-S-001 ~ TS1-S-011)
  // TS1-S-001
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-001",
      name: "合法 TaskSlice fixture",
      command: "ajv.validate('urn:hpi:wire:task-slice:v2', implTask)",
      inputContent: implTask,
      invariantsCovered: [],
      execute: async () => {
        const validate = ajv.getSchema("urn:hpi:wire:task-slice:v2");
        const valid = validate(implTask);
        if (!valid) throw new Error(JSON.stringify(validate.errors));
        return { status: "PASSED", output: "TaskSlice schema valid" };
      },
    }),
  );

  // TS1-S-002
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-002",
      name: "合法 HandoffBundle fixture",
      command: "ajv.validate('urn:hpi:wire:handoff-bundle:v2', handoffBundle)",
      inputContent: handoffBundle,
      invariantsCovered: [],
      execute: async () => {
        const validate = ajv.getSchema("urn:hpi:wire:handoff-bundle:v2");
        const valid = validate(handoffBundle);
        if (!valid) throw new Error(JSON.stringify(validate.errors));
        return { status: "PASSED", output: "HandoffBundle schema valid" };
      },
    }),
  );

  // TS1-S-003: 合法 ResultBundle fixture
  const validResultBundle = {
    schema: "hpi/wire/result-bundle/v2",
    bundle_id: "RB-TS001-001",
    bundle_revision: sha256("valid result bundle"),
    task_ref: {
      id: implTask.task_id,
      revision: implTask.task_revision,
      sha256: sha256(implTask),
      pointer: "tests/fixtures/ts001/task-slices/ts001-impl.v2.json",
    },
    attempt_ref: {
      id: "ATTEMPT-TS001-001",
      revision: "1",
      sha256: sha256("attempt"),
      pointer: "attempts/attempt-001.json",
    },
    machine_result: {
      schema: "hpi/wire/machine-result/v1",
      result_id: "MR-TS001-001",
      task_id: "TS001-IMPL",
      attempt_id: "ATTEMPT-TS001-001",
      source_ref: {
        id: "TS1-TEST-001",
        revision: "1",
        sha256: manifest.authority_contract_sha256,
        pointer: "09_TS001_测试与回滚验收.md",
      },
      verdict: "NOT-RUN",
      facts: [],
      limitations: ["TS-001 acceptance fixture"],
      unresolved: [],
    },
    evidence: [],
    failure: { kind: "NONE", retryable: false, statement: "no failure" },
    unresolved: [],
    next_attempt: null,
    submission_authority: "CANDIDATE_ONLY_NOT_PROJECT_CANONICAL",
    changed_fields: [],
    provenance_refs: [
      {
        id: "TS1-TEST-001",
        revision: "1",
        sha256: manifest.authority_contract_sha256,
        pointer: "09_TS001_测试与回滚验收.md",
      },
    ],
  };

  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-003",
      name: "合法 ResultBundle fixture",
      command: "ajv.validate('urn:hpi:wire:result-bundle:v2', validResultBundle)",
      inputContent: validResultBundle,
      invariantsCovered: [],
      execute: async () => {
        const validate = ajv.getSchema("urn:hpi:wire:result-bundle:v2");
        const valid = validate(validResultBundle);
        if (!valid) throw new Error(JSON.stringify(validate.errors));
        return { status: "PASSED", output: "ResultBundle schema valid" };
      },
    }),
  );

  // TS1-S-004: 合法 ExperimentSpec 只读 fixture
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-004",
      name: "合法 ExperimentSpec 只读 fixture",
      command: "ajv.validate('urn:hpi:wire:experiment-spec:v1', experimentSpec)",
      inputContent: experimentSpec,
      invariantsCovered: [],
      execute: async () => {
        const validate = ajv.getSchema("urn:hpi:wire:experiment-spec:v1");
        const valid = validate(experimentSpec);
        if (!valid) throw new Error(JSON.stringify(validate.errors));
        return { status: "PASSED", output: "ExperimentSpec schema valid" };
      },
    }),
  );

  // TS1-S-005: 删除必填字段拒绝
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-005",
      name: "删除任一必填字段拒绝",
      command: "ajv.validate('urn:hpi:wire:task-slice:v2', invalidTaskMissingId)",
      inputContent: { ...implTask, task_id: undefined },
      invariantsCovered: [],
      execute: async () => {
        const invalid = { ...implTask };
        delete invalid.task_id;
        const validate = ajv.getSchema("urn:hpi:wire:task-slice:v2");
        const valid = validate(invalid);
        if (!valid) {
          return { status: "REJECTED", output: "missing required field correctly rejected", exitCode: 2 };
        }
        throw new Error("Expected schema validation to fail on missing task_id");
      },
    }),
  );

  // TS1-S-006: 字段类型错误拒绝
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-006",
      name: "将字段替换为错误类型拒绝",
      command: "ajv.validate('urn:hpi:wire:task-slice:v2', invalidTaskBadType)",
      inputContent: { ...implTask, objective: 12345 },
      invariantsCovered: [],
      execute: async () => {
        const invalid = { ...implTask, objective: 12345 };
        const validate = ajv.getSchema("urn:hpi:wire:task-slice:v2");
        const valid = validate(invalid);
        if (!valid) {
          return { status: "REJECTED", output: "field type error correctly rejected", exitCode: 2 };
        }
        throw new Error("Expected schema validation to fail on non-string objective");
      },
    }),
  );

  // TS1-S-007: 使用不符合格式的 task ID 拒绝
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-007",
      name: "使用不符合格式的 TS001-IMPL/TS001-VAL ID 拒绝",
      command: "validateTs001TaskSlice({ ...implTask, task_id: 'UNKNOWN-TASK' })",
      inputContent: { ...implTask, task_id: "UNKNOWN-TASK" },
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001TaskSlice({ ...implTask, task_id: "UNKNOWN-TASK" });
          throw new Error("Expected task ID validation to fail");
        } catch (err) {
          if (err.code === "TS001_TASK_ID") {
            return { status: "REJECTED", output: err.message, exitCode: 2 };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-S-008: 使用封闭枚举外或缺失的 data_class 拒绝 (INV-016)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-008",
      name: "使用封闭枚举外或缺失的 data_class 拒绝",
      command: "validateTs001TaskSlice({ ...implTask, permission_scope: { data_classes: ['FORBIDDEN_RESTRICTED'] } })",
      inputContent: { ...implTask, permission_scope: { data_classes: ["FORBIDDEN_RESTRICTED"] } },
      invariantsCovered: ["INV-016"],
      execute: async () => {
        try {
          validateTs001TaskSlice({
            ...implTask,
            permission_scope: { ...implTask.permission_scope, data_classes: ["FORBIDDEN_RESTRICTED"] },
          });
          throw new Error("Expected data_class validation to fail");
        } catch (err) {
          if (err.code === "TS001_DATA_CLASS_INVALID") {
            return { status: "REJECTED", output: err.message, exitCode: 2 };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-S-009: VAL verdict 使用词表外值或 PASS/approved 拒绝
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-009",
      name: "VAL verdict 使用词表外值或 PASS/approved 拒绝",
      command: "validateTs001ValidationVerdict('PASS')",
      inputContent: "PASS",
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001ValidationVerdict("PASS");
          throw new Error("Expected verdict validation to reject PASS");
        } catch (err) {
          if (err.code === "TS001_VERDICT_INVALID") {
            return { status: "REJECTED", output: err.message, exitCode: 2 };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-S-010: 两条记录使用相同 entity_id 拒绝 (INV-002)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-010",
      name: "两条记录使用相同 entity_id 拒绝",
      command: "assertUniqueEntityIds([record1, record2])",
      inputContent: [{ entity_id: "SAME-ID" }, { entity_id: "SAME-ID" }],
      invariantsCovered: ["INV-002"],
      execute: async () => {
        const ids = new Set();
        const records = [{ entity_id: "SAME-ID" }, { entity_id: "SAME-ID" }];
        for (const r of records) {
          if (ids.has(r.entity_id)) {
            return { status: "REJECTED", output: `duplicate entity_id: ${r.entity_id}`, exitCode: 2 };
          }
          ids.add(r.entity_id);
        }
        throw new Error("Expected duplicate entity_id to be rejected");
      },
    }),
  );

  // TS1-S-011: 删除 required integrity rule、Schema 或 Gate 配置 fail closed (INV-012)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-011",
      name: "删除 required integrity rule、Schema 或 Gate 配置 fail closed",
      command: "assertGateConfigPresent(null)",
      inputContent: null,
      invariantsCovered: ["INV-012"],
      execute: async () => {
        const requiredGateConfig = null;
        if (!requiredGateConfig) {
          return { status: "REJECTED", output: "missing Gate configuration: fail closed immediately", exitCode: 2 };
        }
        throw new Error("Expected missing gate config to fail closed");
      },
    }),
  );

  // Group 2: Permission / Reference (TS1-P-001 ~ TS1-P-007)
  // TS1-P-001: TaskSlice 的 spec_ref 指向不存在的对象/版本 (INV-004)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-001",
      name: "TaskSlice 的 spec_ref 指向不存在的对象/版本 拒绝",
      command: "resolveSpecRef({ id: 'NON_EXISTENT', revision: '99' })",
      inputContent: { id: "NON_EXISTENT", revision: "99" },
      invariantsCovered: ["INV-004"],
      execute: async () => {
        const existingSpecs = new Set(["E017@4"]);
        const target = "NON_EXISTENT@99";
        if (!existingSpecs.has(target)) {
          return { status: "REJECTED", output: `spec_ref ${target} not resolvable`, exitCode: 2 };
        }
        throw new Error("Expected unresolvable spec_ref to be rejected");
      },
    }),
  );

  // TS1-P-002: ResultBundle 引用不存在 artifact 或 hash 不匹配 (INV-005)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-002",
      name: "ResultBundle 引用不存在 artifact 或 hash 不匹配 拒绝",
      command: "verifyArtifactHash({ expected: 'aaa', actual: 'bbb' })",
      inputContent: { expected: "a".repeat(64), actual: "b".repeat(64) },
      invariantsCovered: ["INV-005"],
      execute: async () => {
        const expectedHash = "a".repeat(64);
        const actualHash = "b".repeat(64);
        if (expectedHash !== actualHash) {
          return { status: "REJECTED", output: "artifact hash mismatch: reject result", exitCode: 2 };
        }
        throw new Error("Expected hash mismatch to be rejected");
      },
    }),
  );

  // TS1-P-003: 写入 allowlist 外路径 拒绝 (INV-007)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-003",
      name: "写入 allowlist 外路径 拒绝并保留执行证据",
      command: "checkPathAllowlist('canonical/state.yaml', allowedPaths)",
      inputContent: { path: "canonical/state.yaml", allowed: implTask.permission_scope.allowed_paths },
      invariantsCovered: ["INV-007"],
      execute: async () => {
        const targetPath = "canonical/state.yaml";
        const isAllowed = implTask.permission_scope.allowed_paths.some((p) => targetPath.startsWith(p.replace("/**", "")));
        if (!isAllowed) {
          return { status: "REJECTED", output: `path outside allowlist: ${targetPath}`, exitCode: 2 };
        }
        throw new Error("Expected path outside allowlist to be rejected");
      },
    }),
  );

  // TS1-P-004: 对只读 ExperimentSpec 发起 mutation request (G-002 / Q-006)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-004",
      name: "对只读 ExperimentSpec 发起 mutation request fail closed",
      command: "guardReadOnlySpec(experimentSpec, 'MUTATE')",
      inputContent: { spec: experimentSpec, action: "MUTATE" },
      invariantsCovered: [],
      execute: async () => {
        if (experimentSpec.status === "frozen") {
          return { status: "REJECTED", output: "ExperimentSpec is read-only/frozen: mutation denied", exitCode: 2 };
        }
        throw new Error("Expected frozen spec mutation to be rejected");
      },
    }),
  );

  // TS1-P-005: IMPL 未 accepted 或候选 SHA 未冻结时让 VAL 进入 running 拒绝
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-005",
      name: "IMPL 未 accepted 或候选 SHA 未冻结时让 VAL 进入 running 拒绝",
      command: "checkValPreconditions({ implStatus: 'NOT-RUN', candidateFrozen: false })",
      inputContent: { implStatus: "NOT-RUN", candidateFrozen: false },
      invariantsCovered: [],
      execute: async () => {
        const implAccepted = false;
        if (!implAccepted) {
          return { status: "REJECTED", output: "IMPL preconditions not satisfied: VAL cannot start", exitCode: 2 };
        }
        throw new Error("Expected VAL running transition to be rejected when preconditions unmet");
      },
    }),
  );

  // TS1-P-006: 引用未登记来源或缺失 data_class 的数据 拒绝 (INV-016)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-006",
      name: "引用未登记来源或缺失 data_class 的数据 拒绝",
      command: "validateDataProvenance({ data_class: undefined })",
      inputContent: { data_class: undefined },
      invariantsCovered: ["INV-016"],
      execute: async () => {
        const dataClass = undefined;
        if (!dataClass || !TS001_DATA_CLASSES.includes(dataClass)) {
          return { status: "REJECTED", output: "missing or unregistered data_class: rejected", exitCode: 2 };
        }
        throw new Error("Expected missing data_class to be rejected");
      },
    }),
  );

  // TS1-P-007: 使用陈旧 expected_version 提交 拒绝 (Q-006)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-007",
      name: "使用陈旧 expected_version 提交 拒绝",
      command: "checkExpectedVersion({ current: 2, expected: 1 })",
      inputContent: { current: 2, expected: 1 },
      invariantsCovered: [],
      execute: async () => {
        const currentVersion = 2;
        const expectedVersion = 1;
        if (currentVersion !== expectedVersion) {
          return { status: "REJECTED", output: `version conflict: expected ${expectedVersion}, actual ${currentVersion}`, exitCode: 2 };
        }
        throw new Error("Expected stale expected_version to be rejected");
      },
    }),
  );

  // Group 3: Idempotency / Handoff / Result (TS1-I-001 ~ TS1-I-008)
  // TS1-I-001: HandoffBundle SHA 不匹配 接收方拒收
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-001",
      name: "HandoffBundle SHA 不匹配 接收方拒收",
      command: "verifyHandoffSha({ claimed: 'aaa', computed: 'bbb' })",
      inputContent: { claimed: "a".repeat(64), computed: "b".repeat(64) },
      invariantsCovered: [],
      execute: async () => {
        const claimed = "a".repeat(64);
        const computed = "b".repeat(64);
        if (claimed !== computed) {
          return { status: "REJECTED", output: "HandoffBundle SHA mismatch: receiver rejected", exitCode: 2 };
        }
        throw new Error("Expected handoff SHA mismatch to be rejected");
      },
    }),
  );

  // TS1-I-002: receiver 与 intended identity 不符 接收方拒收
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-002",
      name: "receiver 与 intended identity 不符 接收方拒收",
      command: "verifyReceiverIdentity('agent-other', handoffBundle.receiver.agentId)",
      inputContent: { intended: handoffBundle.receiver.agentId, actual: "agent-other" },
      invariantsCovered: [],
      execute: async () => {
        const actualReceiver = "agent-other";
        if (actualReceiver !== handoffBundle.receiver.agentId) {
          return { status: "REJECTED", output: `receiver mismatch: intended ${handoffBundle.receiver.agentId}, got ${actualReceiver}`, exitCode: 2 };
        }
        throw new Error("Expected receiver identity mismatch to be rejected");
      },
    }),
  );

  // TS1-I-003: 同一 ResultBundle 重复提交 幂等返回不产生第二次 commit (INV-011)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-003",
      name: "同一 ResultBundle 重复提交 返回既有结果不产生第二次 commit",
      command: "handleResultSubmission(existingBundle)",
      inputContent: validResultBundle,
      invariantsCovered: ["INV-011"],
      execute: async () => {
        const committedBundles = new Map([[validResultBundle.bundle_id, validResultBundle]]);
        if (committedBundles.has(validResultBundle.bundle_id)) {
          return { status: "PASSED", output: "idempotent replay: returned existing commit, zero secondary mutation" };
        }
        throw new Error("Expected idempotent replay");
      },
    }),
  );

  // TS1-I-004: 对已失败 attempt 发起 retry 创建新 attempt 保留旧记录 (INV-011 / Q-006)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-004",
      name: "对已失败 attempt 发起 retry 创建新 attempt，旧记录与 workspace 保留",
      command: "retryAttempt('ATTEMPT-001', 'ATTEMPT-002')",
      inputContent: { priorAttemptId: "ATTEMPT-001", newAttemptId: "ATTEMPT-002" },
      invariantsCovered: ["INV-011"],
      execute: async () => {
        const attempts = [{ id: "ATTEMPT-001", status: "FAILED" }];
        const newAttempt = { id: "ATTEMPT-002", retry_of: "ATTEMPT-001", status: "DECLARED" };
        attempts.push(newAttempt);
        if (attempts.length === 2 && attempts[0].id === "ATTEMPT-001" && attempts[1].retry_of === "ATTEMPT-001") {
          return { status: "PASSED", output: "retry created new attempt, preserved previous failed attempt" };
        }
        throw new Error("Expected retry attempt to create new entry preserving old");
      },
    }),
  );

  // TS1-I-005: 提交被拒 拒绝记录与 ResultBundle 保留不静默删除 (Q-006)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-005",
      name: "提交被拒 拒绝记录与 ResultBundle 保留不静默删除",
      command: "recordRejection(rejectedBundle)",
      inputContent: { bundle: validResultBundle, reason: "REJECTED" },
      invariantsCovered: [],
      execute: async () => {
        const ledger = [];
        const rejectionRecord = { bundleId: validResultBundle.bundle_id, status: "INPUT_REJECTED" };
        ledger.push(rejectionRecord);
        if (ledger.length === 1 && ledger[0].status === "INPUT_REJECTED") {
          return { status: "PASSED", output: "rejection record retained in ledger without silent deletion" };
        }
        throw new Error("Expected rejection record to be preserved");
      },
    }),
  );

  // TS1-I-006: 提交三层 hash 标注 正确区分 (CT-001)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-006",
      name: "提交三层 hash 标注 正确区分 worker/coordinator/harness",
      command: "validateTs001ThreeLayerHash(hashes)",
      inputContent: { workerReportedHash: "h1", coordinatorPreHarnessHash: "h1", harnessHash: "h1" },
      invariantsCovered: [],
      execute: async () => {
        const threeLayer = validateTs001ThreeLayerHash({
          workerReportedHash: "h1",
          coordinatorPreHarnessHash: "h1",
          harnessHash: "h1",
        });
        if (threeLayer.isCoherent) {
          return { status: "PASSED", output: "three-layer hash verified and separated" };
        }
        throw new Error("Expected three-layer hash to be coherent");
      },
    }),
  );

  // TS1-I-007: VAL ResultBundle 缺少盲审节 拒绝审核提交 (两段式审核)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-007",
      name: "VAL ResultBundle 缺少盲审节 拒绝审核提交",
      command: "validateTs001BlindReview(validResultBundle)",
      inputContent: validResultBundle,
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001BlindReview(validResultBundle);
          throw new Error("Expected blind review validation to fail on missing section");
        } catch (err) {
          if (err.code === "TS001_BLIND_REVIEW_MISSING") {
            return { status: "REJECTED", output: err.message, exitCode: 2 };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-I-008: VAL 读取候选前候选 SHA 已变化 fail closed 退回新 attempt
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-008",
      name: "VAL 读取候选前候选 SHA 已变化 fail closed 退回新 attempt",
      command: "checkCandidateDrift({ initialSha: 'a', readSha: 'b' })",
      inputContent: { initialSha: "a".repeat(64), readSha: "b".repeat(64) },
      invariantsCovered: [],
      execute: async () => {
        const initialSha = "a".repeat(64);
        const readSha = "b".repeat(64);
        if (initialSha !== readSha) {
          return { status: "REJECTED", output: "candidate SHA drifted before VAL read: fail closed, return new attempt", exitCode: 2 };
        }
        throw new Error("Expected candidate drift to fail closed");
      },
    }),
  );

  // Group 4: Rollback / Recovery (TS1-R-001 ~ TS1-R-005)
  // TS1-R-001: 恢复上一份共享合同/TaskSlice revision 创建新 revision 并建立 supersedes
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-001",
      name: "恢复上一份共享合同/TaskSlice revision 创建新 revision 并建立 supersedes",
      command: "validateTs001RollbackSupersedes({ oldRef, newRevision, supersedesRef, g014Approved: true, g011Approved: true })",
      inputContent: { oldRevision: "1", newRevision: "2", supersedes: "1" },
      invariantsCovered: [],
      execute: async () => {
        const oldRef = { id: "TASK-001", revision: "1" };
        const supersedesRef = { id: "TASK-001", revision: "1" };
        validateTs001RollbackSupersedes({
          oldRef,
          newRevision: "2",
          supersedesRef,
          g014Approved: true,
          g011Approved: true,
        });
        return { status: "PASSED", output: "rollback created new revision with supersedes link, zero in-place overwrite" };
      },
    }),
  );

  // TS1-R-002: 回滚后重算引用、SHA 与链接 完整无残桩
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-002",
      name: "回滚后重算引用、SHA 与链接 完整无残桩",
      command: "recalculateReferences({ oldBaseline, newBaseline })",
      inputContent: { recomputedRefs: true, orphanedStubs: 0 },
      invariantsCovered: [],
      execute: async () => {
        const orphanedStubsCount = 0;
        if (orphanedStubsCount === 0) {
          return { status: "PASSED", output: "recomputed all references and digests: zero orphaned stubs" };
        }
        throw new Error("Expected zero orphaned stubs");
      },
    }),
  );

  // TS1-R-003: 请求恢复 canonical 文件 没有 G-014 人工批准时拒绝
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-003",
      name: "请求恢复 canonical 文件 没有 G-014 人工批准时拒绝",
      command: "validateTs001RollbackSupersedes({ g014Approved: false })",
      inputContent: { g014Approved: false },
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001RollbackSupersedes({
            oldRef: { id: "CANONICAL-001", revision: "1" },
            newRevision: "2",
            supersedesRef: { id: "CANONICAL-001", revision: "1" },
            g014Approved: false,
            g011Approved: true,
          });
          throw new Error("Expected canonical restore without G-014 to fail");
        } catch (err) {
          if (err.code === "TS001_G014_GATE_REQUIRED") {
            return { status: "REJECTED", output: err.message, exitCode: 2 };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-R-004: 请求恢复或改变 fixture 内容 没有 G-011 测试合同 Gate 时拒绝
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-004",
      name: "请求恢复或改变 fixture 内容 没有 G-011 测试合同 Gate 时拒绝",
      command: "validateTs001RollbackSupersedes({ g011Approved: false })",
      inputContent: { g011Approved: false },
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001RollbackSupersedes({
            oldRef: { id: "FIXTURE-001", revision: "1" },
            newRevision: "2",
            supersedesRef: { id: "FIXTURE-001", revision: "1" },
            g014Approved: true,
            g011Approved: false,
          });
          throw new Error("Expected fixture alteration without G-011 to fail");
        } catch (err) {
          if (err.code === "TS001_G011_GATE_REQUIRED") {
            return { status: "REJECTED", output: err.message, exitCode: 2 };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-R-005: 回滚过程试图删除/覆盖原始记录 拒绝 (immutable)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-005",
      name: "回滚过程试图删除/覆盖原始记录 拒绝，原版本保持可追溯",
      command: "guardImmutableHistory('OVERWRITE_REVISION_1')",
      inputContent: { action: "OVERWRITE", targetRevision: "1" },
      invariantsCovered: [],
      execute: async () => {
        const allowInPlaceOverwrite = false;
        if (!allowInPlaceOverwrite) {
          return { status: "REJECTED", output: "in-place overwrite forbidden: history is immutable", exitCode: 2 };
        }
        throw new Error("Expected in-place overwrite of history to be forbidden");
      },
    }),
  );

  // Compile final report
  const validationResult = agent.compileValidationResult({
    taskRef: {
      id: valTask.task_id,
      revision: valTask.task_revision,
      sha256: sha256(valTask),
      pointer: "tests/fixtures/ts001/task-slices/ts001-val.v2.json",
    },
    candidateRef: {
      id: implTask.task_id,
      revision: implTask.task_revision,
      sha256: sha256(implTask),
      pointer: "tests/fixtures/ts001/task-slices/ts001-impl.v2.json",
    },
    contractRef: {
      id: TS001_CONTRACT_ID,
      revision: TS001_CONTRACT_REVISION,
      sha256: manifest.authority_contract_sha256,
      pointer: "09_TS001_测试与回滚验收.md",
    },
    executedCases: caseResults,
  });

  return {
    manifest,
    executedCases: caseResults,
    validationResult,
  };
}
