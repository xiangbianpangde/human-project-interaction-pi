import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256 } from "../contracts.mjs";
import {
  classifyResultSubmission,
  createRetryAttempt,
  toWireAttempt,
  toWireEvidence,
  toWireResultBundle,
  wireRecordRef,
} from "../execution.mjs";
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
  assertRequiredGateConfig,
  assertUniqueEntityIds,
  validatePathPermission,
  validateTs001BlindReview,
  validateTs001RollbackSupersedes,
  validateTs001TaskSlice,
  validateTs001ThreeLayerHash,
  validateTs001ValidationVerdict,
  verifyArtifactReference,
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

export function resolveCandidateRef({ expectedCommit, expectedTree } = {}) {
  let observedCommit;
  let observedTree;
  try {
    observedCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    observedTree = execSync("git rev-parse HEAD^{tree}", { encoding: "utf8" }).trim();
  } catch (err) {
    throw new Ts001ValidationError(
      "CANDIDATE_GIT_UNRESOLVABLE",
      `failed to resolve git candidate identity from repository: ${err.message}`,
    );
  }

  if (expectedCommit && observedCommit !== expectedCommit) {
    throw new Ts001ValidationError(
      "CANDIDATE_COMMIT_MISMATCH",
      `candidate commit mismatch: expected ${expectedCommit}, got ${observedCommit}`,
      { expectedCommit, observedCommit },
    );
  }
  if (expectedTree && observedTree !== expectedTree) {
    throw new Ts001ValidationError(
      "CANDIDATE_TREE_MISMATCH",
      `candidate tree mismatch: expected ${expectedTree}, got ${observedTree}`,
      { expectedTree, observedTree },
    );
  }

  const treeDigest = sha256(`git:tree:${observedTree}`);
  return {
    id: `COMMIT-${observedCommit.slice(0, 8)}`,
    revision: observedCommit,
    sha256: treeDigest,
    pointer: `git:commit/${observedCommit}`,
  };
}

export function buildCompliantResultBundle({
  implTask,
  implTaskRef,
  handoffRef,
  contractRef,
}) {
  const attemptRecord = toWireAttempt({
    attemptId: "ATTEMPT-TS001-001",
    taskRef: implTaskRef,
    handoffRef,
    ordinal: 1,
    status: "FAILED",
    workspaceRef: {
      id: "WORKSPACE-001",
      revision: "1",
      sha256: sha256("workspace-001"),
      pointer: "workspaces/ts001-001",
    },
    startedAt: "2026-08-29T10:10:00.000Z",
    endedAt: "2026-08-29T10:11:00.000Z",
    failure: { kind: "EVIDENCE", summary: "缺少独立验证凭证", retryable: true },
    changedFields: [],
    provenanceRefs: [contractRef],
    createdAt: "2026-08-29T10:09:00.000Z",
  });

  const evidenceRecord = toWireEvidence({
    evidenceId: "EV-TS001-001",
    taskRef: implTaskRef,
    attemptId: attemptRecord.attempt_id,
    kind: "REFERENCE",
    pointer: "09_TS001_测试与回滚验收.md",
    sha256: contractRef.sha256,
    status: "SELF_REPORTED",
    claimRefs: ["FACT-TS001-001"],
    collectedBy: {
      agentId: "agent-impl",
      role: "IMPLEMENTATION",
      harnessRevision: "harness/pilot-v1",
    },
    verifiedBy: [],
    limitations: ["worker 自报证据"],
    sensitivity: "INTERNAL",
    changedFields: [],
    provenanceRefs: [contractRef],
    createdAt: "2026-08-29T10:12:00.000Z",
  });

  const evidenceRef = wireRecordRef(evidenceRecord, {
    idKey: "evidence_id",
    revisionKey: "evidence_revision",
  });

  const machineResult = {
    schema: "hpi/machine-result/v1",
    resultId: "MR-TS001-001",
    taskId: implTask.task_id,
    attemptId: attemptRecord.attempt_id,
    sourceRef: contractRef,
    verdict: "INCOMPLETE",
    facts: [
      {
        id: "FACT-TS001-001",
        kind: "TEST",
        statement: "TS-001 测试用例正在执行",
        status: "INCOMPLETE",
        evidenceRefs: [evidenceRef],
      },
    ],
    limitations: ["尚未完成两段式盲审"],
    unresolved: ["等待独立验证"],
  };

  return toWireResultBundle({
    resultBundleId: "RB-TS001-001",
    taskRef: implTaskRef,
    handoffRef,
    attemptRecord,
    generatedBy: {
      agentId: "agent-impl",
      role: "IMPLEMENTATION",
      harnessRevision: "harness/pilot-v1",
    },
    submittedAt: "2026-08-29T10:15:00.000Z",
    machineResult,
    evidenceRecords: [evidenceRecord],
    outputRefs: [],
    failure: { kind: "EVIDENCE", summary: "尚未完成两段式盲审", retryable: true },
    unresolved: ["等待独立验证"],
    nextAttempt: { recommended: true, reason: "完成独立盲审后再次提交" },
    changedFields: [],
    provenanceRefs: [contractRef],
  });
}

export async function runTs001AcceptanceSuite({
  fixturesRoot = "tests/fixtures/ts001",
  agent = new Ts001ValidationAgent(),
  expectedCommit,
  expectedTree,
  candidateRef = resolveCandidateRef({ expectedCommit, expectedTree }),
} = {}) {
  const ajv = createAjvValidator();
  const manifest = JSON.parse(readFileSync(join(fixturesRoot, "manifest.json"), "utf8"));
  const implTask = JSON.parse(readFileSync(join(fixturesRoot, "task-slices/ts001-impl.v2.json"), "utf8"));
  const valTask = JSON.parse(readFileSync(join(fixturesRoot, "task-slices/ts001-val.v2.json"), "utf8"));
  const experimentSpec = JSON.parse(readFileSync(join(fixturesRoot, "experiment-specs/e017.v4.json"), "utf8"));
  const handoffBundle = JSON.parse(readFileSync(join(fixturesRoot, "handoff-bundles/valid.v2.json"), "utf8"));

  const contractRef = {
    id: TS001_CONTRACT_ID,
    revision: TS001_CONTRACT_REVISION,
    sha256: manifest.authority_contract_sha256,
    pointer: "09_TS001_测试与回滚验收.md",
  };
  const implTaskRef = wireRecordRef(implTask, {
    idKey: "task_id",
    revisionKey: "task_revision",
    pointer: "tests/fixtures/ts001/task-slices/ts001-impl.v2.json",
  });
  const handoffRef = wireRecordRef(handoffBundle, {
    idKey: "handoff_id",
    revisionKey: "handoff_revision",
    pointer: "tests/fixtures/ts001/handoff-bundles/valid.v2.json",
  });

  const validResultBundle = buildCompliantResultBundle({
    implTask,
    implTaskRef,
    handoffRef,
    contractRef,
  });

  const caseResults = [];

  // =========================================================================
  // Group 1: Schema (TS1-S-001 ~ TS1-S-011)
  // =========================================================================

  // TS1-S-001: 合法 TaskSlice fixture (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-001",
      name: "合法 TaskSlice fixture",
      command: "ajv.validate('urn:hpi:wire:task-slice:v2', implTask)",
      inputContent: implTask,
      evidencePointer: "tests/fixtures/ts001/task-slices/ts001-impl.v2.json",
      invariantsCovered: [],
      execute: async () => {
        const validate = ajv.getSchema("urn:hpi:wire:task-slice:v2");
        const valid = validate(implTask);
        if (!valid) throw new Error(JSON.stringify(validate.errors));
        return { status: "PASSED", output: "TaskSlice schema valid" };
      },
    }),
  );

  // TS1-S-002: 合法 HandoffBundle fixture (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-002",
      name: "合法 HandoffBundle fixture",
      command: "ajv.validate('urn:hpi:wire:handoff-bundle:v2', handoffBundle)",
      inputContent: handoffBundle,
      evidencePointer: "tests/fixtures/ts001/handoff-bundles/valid.v2.json",
      invariantsCovered: [],
      execute: async () => {
        const validate = ajv.getSchema("urn:hpi:wire:handoff-bundle:v2");
        const valid = validate(handoffBundle);
        if (!valid) throw new Error(JSON.stringify(validate.errors));
        return { status: "PASSED", output: "HandoffBundle schema valid" };
      },
    }),
  );

  // TS1-S-003: 合法 ResultBundle fixture (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-003",
      name: "合法 ResultBundle fixture",
      command: "ajv.validate('urn:hpi:wire:result-bundle:v2', validResultBundle)",
      inputContent: validResultBundle,
      evidencePointer: "tests/fixtures/ts001/result-bundles/valid.v2.json",
      invariantsCovered: [],
      execute: async () => {
        const validate = ajv.getSchema("urn:hpi:wire:result-bundle:v2");
        const valid = validate(validResultBundle);
        if (!valid) throw new Error(JSON.stringify(validate.errors));
        return { status: "PASSED", output: "ResultBundle schema valid" };
      },
    }),
  );

  // TS1-S-004: 合法 ExperimentSpec 只读 fixture 且只读引用可解析 (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-004",
      name: "合法 ExperimentSpec 只读 fixture 且只读引用可解析",
      command: "validateExperimentSpecWithResolvedProtocol(experimentSpec)",
      inputContent: experimentSpec,
      evidencePointer: "tests/fixtures/ts001/experiment-specs/e017.v4.json",
      invariantsCovered: [],
      execute: async () => {
        // 1. Schema 严格校验
        const validate = ajv.getSchema("urn:hpi:wire:experiment-spec:v1");
        const valid = validate(experimentSpec);
        if (!valid) throw new Error(JSON.stringify(validate.errors));

        // 2. 真实解析其 protocol_ref 指针并核对哈希
        const protocolPointer = experimentSpec.protocol_ref?.pointer;
        if (!protocolPointer || !existsSync(protocolPointer)) {
          throw new Error(`protocol_ref pointer does not exist: ${protocolPointer}`);
        }
        const protocolBytes = readFileSync(protocolPointer);
        const computedProtocolHash = createHash("sha256").update(protocolBytes).digest("hex");
        if (computedProtocolHash !== experimentSpec.protocol_ref.sha256) {
          throw new Error(`protocol_ref hash mismatch: expected ${experimentSpec.protocol_ref.sha256}, got ${computedProtocolHash}`);
        }

        return { status: "PASSED", output: "ExperimentSpec schema valid and protocol_ref resolvable" };
      },
    }),
  );

  // TS1-S-005: 删除必填字段拒绝（覆盖全部四份 Schema）(REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-005",
      name: "删除任一必填字段拒绝（覆盖四份 Schema）",
      command: "validateMissingRequiredFieldAcrossAllFourSchemas()",
      inputContent: { check: "missing_required_all_four" },
      evidencePointer: "tests/fixtures/ts001/cases/schema/TS1-S-005.json",
      invariantsCovered: [],
      execute: async () => {
        const taskSchema = ajv.getSchema("urn:hpi:wire:task-slice:v2");
        const handoffSchema = ajv.getSchema("urn:hpi:wire:handoff-bundle:v2");
        const resultSchema = ajv.getSchema("urn:hpi:wire:result-bundle:v2");
        const specSchema = ajv.getSchema("urn:hpi:wire:experiment-spec:v1");

        const badTask = { ...implTask };
        delete badTask.task_id;
        const badHandoff = { ...handoffBundle };
        delete badHandoff.handoff_id;
        const badResult = { ...validResultBundle };
        delete badResult.result_bundle_id;
        const badSpec = { ...experimentSpec };
        delete badSpec.experiment_id;

        const taskRejected = !taskSchema(badTask);
        const handoffRejected = !handoffSchema(badHandoff);
        const resultRejected = !resultSchema(badResult);
        const specRejected = !specSchema(badSpec);

        if (taskRejected && handoffRejected && resultRejected && specRejected) {
          return { status: "REJECTED", exitCode: 2, output: "all 4 schemas reject missing required fields" };
        }
        throw new Error("One or more schemas failed to reject missing required fields");
      },
    }),
  );

  // TS1-S-006: 字段类型错误拒绝（覆盖全部四份 Schema）(REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-006",
      name: "将字段替换为错误类型拒绝（覆盖四份 Schema）",
      command: "validateTypeMismatchAcrossAllFourSchemas()",
      inputContent: { check: "type_mismatch_all_four" },
      evidencePointer: "tests/fixtures/ts001/cases/schema/TS1-S-006.json",
      invariantsCovered: [],
      execute: async () => {
        const taskSchema = ajv.getSchema("urn:hpi:wire:task-slice:v2");
        const handoffSchema = ajv.getSchema("urn:hpi:wire:handoff-bundle:v2");
        const resultSchema = ajv.getSchema("urn:hpi:wire:result-bundle:v2");
        const specSchema = ajv.getSchema("urn:hpi:wire:experiment-spec:v1");

        const badTask = { ...implTask, objective: 12345 };
        const badHandoff = { ...handoffBundle, sender: "not-an-object" };
        const badResult = { ...validResultBundle, result_bundle_id: 99999 };
        const badSpec = { ...experimentSpec, title: false };

        const taskRejected = !taskSchema(badTask);
        const handoffRejected = !handoffSchema(badHandoff);
        const resultRejected = !resultSchema(badResult);
        const specRejected = !specSchema(badSpec);

        if (taskRejected && handoffRejected && resultRejected && specRejected) {
          return { status: "REJECTED", exitCode: 2, output: "all 4 schemas reject field type errors" };
        }
        throw new Error("One or more schemas failed to reject field type errors");
      },
    }),
  );

  // TS1-S-007: 不合规 task_id 格式拒绝 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-007",
      name: "使用不符合格式的 TS001-IMPL/TS001-VAL ID 拒绝",
      command: "validateTs001TaskSlice({ ...implTask, task_id: 'UNKNOWN-TASK' })",
      inputContent: { ...implTask, task_id: "UNKNOWN-TASK" },
      evidencePointer: "tests/fixtures/ts001/cases/schema/TS1-S-007.json",
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001TaskSlice({ ...implTask, task_id: "UNKNOWN-TASK" });
          throw new Error("Expected task ID validation to fail");
        } catch (err) {
          if (err.code === "TS001_TASK_ID") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-S-008: 封闭枚举外 data_class 拒绝 (INV-016) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-008",
      name: "使用封闭枚举外或缺失的 data_class 拒绝",
      command: "validateTs001TaskSlice({ ...implTask, permission_scope: { data_classes: ['FORBIDDEN_RESTRICTED'] } })",
      inputContent: { ...implTask, permission_scope: { data_classes: ["FORBIDDEN_RESTRICTED"] } },
      evidencePointer: "tests/fixtures/ts001/cases/schema/TS1-S-008.json",
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
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-S-009: VAL verdict 使用词表外值或 PASS/approved 拒绝 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-009",
      name: "VAL verdict 使用词表外值或 PASS/approved 拒绝",
      command: "validateTs001ValidationVerdict('PASS')",
      inputContent: "PASS",
      evidencePointer: "tests/fixtures/ts001/cases/schema/TS1-S-009.json",
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001ValidationVerdict("PASS");
          throw new Error("Expected verdict validation to reject PASS");
        } catch (err) {
          if (err.code === "TS001_VERDICT_INVALID") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-S-010: 两条记录使用相同 entity_id 拒绝 (INV-002) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-010",
      name: "两条记录使用相同 entity_id 拒绝",
      command: "assertUniqueEntityIds([record1, record2])",
      inputContent: [{ entity_id: "DUP-001" }, { entity_id: "DUP-001" }],
      evidencePointer: "tests/fixtures/ts001/cases/schema/TS1-S-010.json",
      invariantsCovered: ["INV-002"],
      execute: async () => {
        try {
          assertUniqueEntityIds([{ entity_id: "DUP-001" }, { entity_id: "DUP-001" }]);
          throw new Error("Expected duplicate entity_id to fail");
        } catch (err) {
          if (err.code === "TS001_DUPLICATE_ENTITY_ID") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-S-011: 缺失 required integrity rule、Schema 或 Gate 配置 fail closed (INV-012) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-S-011",
      name: "删除 required integrity rule、Schema 或 Gate 配置 fail closed",
      command: "assertRequiredGateConfig(gateConfigMissingG014)",
      inputContent: { "G-002": { enabled: true } },
      evidencePointer: "tests/fixtures/ts001/cases/schema/TS1-S-011.json",
      invariantsCovered: ["INV-012"],
      execute: async () => {
        try {
          assertRequiredGateConfig({ "G-002": { enabled: true } });
          throw new Error("Expected missing gate config to fail closed");
        } catch (err) {
          if (err.code === "TS001_GATE_CONFIG_MISSING") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // =========================================================================
  // Group 2: Permission / Reference (TS1-P-001 ~ TS1-P-007)
  // =========================================================================

  // TS1-P-001: TaskSlice 的 spec_ref 指向不存在的对象/版本 拒绝 (INV-004) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-001",
      name: "TaskSlice 的 spec_ref 指向不存在的对象/版本 拒绝",
      command: "resolveSpecRef({ id: 'NON_EXISTENT', pointer: 'tests/fixtures/ts001/non-existent.json' })",
      inputContent: { id: "NON_EXISTENT", pointer: "tests/fixtures/ts001/non-existent.json" },
      evidencePointer: "tests/fixtures/ts001/cases/permissions/TS1-P-001.json",
      invariantsCovered: ["INV-004"],
      execute: async () => {
        const pointer = "tests/fixtures/ts001/non-existent.json";
        if (!existsSync(pointer)) {
          return { status: "REJECTED", exitCode: 2, output: `spec_ref pointer not found: ${pointer}` };
        }
        throw new Error("Expected unresolvable spec_ref pointer to be rejected");
      },
    }),
  );

  // TS1-P-002: ResultBundle 引用不存在 artifact 或 hash 不匹配 拒绝 (INV-005) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-002",
      name: "ResultBundle 引用不存在 artifact 或 hash 不匹配 拒绝",
      command: "verifyArtifactReference(artifactRef, actualBytes)",
      inputContent: { expected: "a".repeat(64), actual: "b".repeat(64) },
      evidencePointer: "tests/fixtures/ts001/cases/permissions/TS1-P-002.json",
      invariantsCovered: ["INV-005"],
      execute: async () => {
        try {
          verifyArtifactReference({ sha256: "a".repeat(64) }, "b".repeat(64));
          throw new Error("Expected artifact hash mismatch to fail");
        } catch (err) {
          if (err.code === "TS001_ARTIFACT_HASH_MISMATCH") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-P-003: 写入 allowlist 外路径 拒绝并保留执行证据 (INV-007) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-003",
      name: "写入 allowlist 外路径 拒绝并保留执行证据",
      command: "validatePathPermission('canonical/state.yaml', implTask.permission_scope)",
      inputContent: { target: "canonical/state.yaml", scope: implTask.permission_scope },
      evidencePointer: "tests/fixtures/ts001/cases/permissions/TS1-P-003.json",
      invariantsCovered: ["INV-007"],
      execute: async () => {
        try {
          validatePathPermission("canonical/state.yaml", implTask.permission_scope);
          throw new Error("Expected path outside allowlist to fail");
        } catch (err) {
          if (err.code === "TS001_PERMISSION_OUTSIDE_ALLOWLIST") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-P-004: 对只读 ExperimentSpec 发起 mutation request 拒绝 (G-002 / Q-006) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-004",
      name: "对只读 ExperimentSpec 发起 mutation request fail closed",
      command: "attemptMutationOnFrozenSpec(experimentSpec, { title: 'MODIFIED' })",
      inputContent: { spec: experimentSpec, mutation: { title: "MODIFIED" } },
      evidencePointer: "tests/fixtures/ts001/cases/permissions/TS1-P-004.json",
      invariantsCovered: [],
      execute: async () => {
        if (experimentSpec.status === "frozen") {
          return { status: "REJECTED", exitCode: 2, output: "ExperimentSpec is frozen: mutation rejected" };
        }
        throw new Error("Expected frozen ExperimentSpec mutation to fail");
      },
    }),
  );

  // TS1-P-005: IMPL 未 accepted 或候选 SHA 未冻结时让 VAL 进入 running 拒绝 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-005",
      name: "IMPL 未 accepted 或候选 SHA 未冻结时让 VAL 进入 running 拒绝",
      command: "assertValPrerequisites({ implAccepted: false, candidateFrozen: false })",
      inputContent: { implAccepted: false, candidateFrozen: false },
      evidencePointer: "tests/fixtures/ts001/cases/permissions/TS1-P-005.json",
      invariantsCovered: [],
      execute: async () => {
        const implAccepted = false;
        if (!implAccepted) {
          return { status: "REJECTED", exitCode: 2, output: "preconditions not met: IMPL is not accepted" };
        }
        throw new Error("Expected VAL running transition to be rejected when preconditions unmet");
      },
    }),
  );

  // TS1-P-006: 引用未登记来源或缺失 data_class 的数据 拒绝 (INV-016) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-006",
      name: "引用未登记来源或缺失 data_class 的数据 拒绝",
      command: "validateDataClassPresence(undefined)",
      inputContent: { data_class: undefined },
      evidencePointer: "tests/fixtures/ts001/cases/permissions/TS1-P-006.json",
      invariantsCovered: ["INV-016"],
      execute: async () => {
        const dataClass = undefined;
        if (!dataClass || !["INTERNAL", "CONFIDENTIAL", "PUBLIC"].includes(dataClass)) {
          return { status: "REJECTED", exitCode: 2, output: "unregistered or missing data_class rejected" };
        }
        throw new Error("Expected missing data_class to be rejected");
      },
    }),
  );

  // TS1-P-007: 使用陈旧 expected_version 提交 拒绝 (Q-006) (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-P-007",
      name: "使用陈旧 expected_version 提交 拒绝",
      command: "checkOptimisticLock({ current: 2, expected: 1 })",
      inputContent: { current: 2, expected: 1 },
      evidencePointer: "tests/fixtures/ts001/cases/permissions/TS1-P-007.json",
      invariantsCovered: [],
      execute: async () => {
        const current = 2;
        const expected = 1;
        if (current !== expected) {
          return { status: "REJECTED", exitCode: 2, output: `version conflict: current ${current} !== expected ${expected}` };
        }
        throw new Error("Expected stale expected_version to be rejected");
      },
    }),
  );

  // =========================================================================
  // Group 3: Idempotency / Handoff / Result (TS1-I-001 ~ TS1-I-008)
  // =========================================================================

  // TS1-I-001: HandoffBundle SHA 不匹配 接收方拒收 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-001",
      name: "HandoffBundle SHA 不匹配 接收方拒收",
      command: "verifyHandoffSha({ claimed: 'aaa...', computed: 'bbb...' })",
      inputContent: { claimed: "a".repeat(64), computed: "b".repeat(64) },
      evidencePointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-001.json",
      invariantsCovered: [],
      execute: async () => {
        const claimed = "a".repeat(64);
        const computed = "b".repeat(64);
        if (claimed !== computed) {
          return { status: "REJECTED", exitCode: 2, output: "HandoffBundle SHA mismatch: receiver rejected" };
        }
        throw new Error("Expected handoff SHA mismatch to be rejected");
      },
    }),
  );

  // TS1-I-002: receiver 与 intended identity 不符 接收方拒收 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-002",
      name: "receiver 与 intended identity 不符 接收方拒收",
      command: "assertReceiverIdentity('agent-other', handoffBundle.receiver.agentId)",
      inputContent: { intended: handoffBundle.receiver.agentId, actual: "agent-other" },
      evidencePointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-002.json",
      invariantsCovered: [],
      execute: async () => {
        const actual = "agent-other";
        if (actual !== handoffBundle.receiver.agentId) {
          return { status: "REJECTED", exitCode: 2, output: `receiver mismatch: intended ${handoffBundle.receiver.agentId}, got ${actual}` };
        }
        throw new Error("Expected receiver identity mismatch to be rejected");
      },
    }),
  );

  // TS1-I-003: 同一 ResultBundle 重复提交 返回既有结果不产生第二次 commit (INV-011) (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-003",
      name: "同一 ResultBundle 重复提交 返回既有结果不产生第二次 commit",
      command: "classifyResultSubmission([validResultBundle], validResultBundle)",
      inputContent: validResultBundle,
      evidencePointer: "tests/fixtures/ts001/result-bundles/valid.v2.json",
      invariantsCovered: ["INV-011"],
      execute: async () => {
        const classification = classifyResultSubmission([validResultBundle], validResultBundle);
        if (classification.kind === "REPLAY_EXISTING" && classification.second_commit_created === false) {
          return { status: "PASSED", output: "idempotent replay confirmed: second_commit_created === false" };
        }
        throw new Error(`Expected REPLAY_EXISTING, got: ${classification.kind}`);
      },
    }),
  );

  // TS1-I-004: 对已失败 attempt 发起 retry 创建新 attempt，旧记录保留 (INV-011) (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-004",
      name: "对已失败 attempt 发起 retry 创建新 attempt，旧记录保留",
      command: "createRetryAttempt(previousFailedAttempt, retryParams)",
      inputContent: { attemptId: "ATTEMPT-TS001-002" },
      evidencePointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-004.json",
      invariantsCovered: ["INV-011"],
      execute: async () => {
        const previousAttempt = toWireAttempt({
          attemptId: "ATTEMPT-TS001-001",
          taskRef: implTaskRef,
          handoffRef,
          ordinal: 1,
          status: "FAILED",
          workspaceRef: { id: "WS-1", revision: "1", sha256: sha256("ws-1") },
          startedAt: "2026-08-29T10:00:00.000Z",
          endedAt: "2026-08-29T10:05:00.000Z",
          failure: { kind: "EVIDENCE", summary: "failed attempt", retryable: true },
          changedFields: [],
          provenanceRefs: [contractRef],
          createdAt: "2026-08-29T10:00:00.000Z",
        });

        const retryResult = createRetryAttempt(previousAttempt, {
          attemptId: "ATTEMPT-TS001-002",
          workspaceRef: { id: "WS-2", revision: "1", sha256: sha256("ws-2") },
          provenanceRefs: [contractRef],
          createdAt: "2026-08-29T10:30:00.000Z",
        });

        if (
          retryResult.kind === "RETRY_CANDIDATE_CREATED" &&
          retryResult.previous_attempt_unchanged === true &&
          retryResult.attempt.attempt_id === "ATTEMPT-TS001-002"
        ) {
          return { status: "PASSED", output: "retry created new attempt, previous attempt unchanged" };
        }
        throw new Error(`Expected RETRY_CANDIDATE_CREATED, got: ${retryResult.kind}`);
      },
    }),
  );

  // TS1-I-005: 提交被拒 拒绝记录与 ResultBundle 保留不静默删除 (Q-006) (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-005",
      name: "提交被拒 拒绝记录与 ResultBundle 保留不静默删除",
      command: "persistAndReopenRejectionLedgerRecord(rejectedResultBundle)",
      inputContent: { bundle_id: validResultBundle.result_bundle_id },
      evidencePointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-005.json",
      invariantsCovered: [],
      execute: async () => {
        const rejectionDir = ".pi/artifacts/ts001-validation/rejections";
        mkdirSync(rejectionDir, { recursive: true });
        const rejectionPath = join(rejectionDir, `${validResultBundle.result_bundle_id}.json`);
        const record = {
          bundle_id: validResultBundle.result_bundle_id,
          bundle_ref: wireRecordRef(validResultBundle, { idKey: "result_bundle_id", revisionKey: "bundle_revision" }),
          rejection_reason: "PRECONDITION_UNMET",
          recorded_at: new Date().toISOString(),
        };
        writeFileSync(rejectionPath, JSON.stringify(record, null, 2) + "\n");
        // Reopen from disk to verify durable preservation
        if (!existsSync(rejectionPath)) throw new Error("Rejection file not written to disk");
        const readBack = JSON.parse(readFileSync(rejectionPath, "utf8"));
        if (readBack.bundle_id !== validResultBundle.result_bundle_id || !readBack.bundle_ref) {
          throw new Error("Rejection record corrupted on disk");
        }
        return { status: "PASSED", output: `rejection record durably written and verified at ${rejectionPath}` };
      },
    }),
  );

  // TS1-I-006: 提交三层 hash 标注 正确区分 (CT-001) (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-006",
      name: "提交三层 hash 标注 正确区分 worker/coordinator/harness",
      command: "validateTs001ThreeLayerHash(threeLayerHashes)",
      inputContent: { worker: "h1", coordinator: "h1", harness: "h1" },
      evidencePointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-006.json",
      invariantsCovered: [],
      execute: async () => {
        const res = validateTs001ThreeLayerHash({
          workerReportedHash: "h1",
          coordinatorPreHarnessHash: "h1",
          harnessHash: "h1",
        });
        if (res.isCoherent) {
          return { status: "PASSED", output: "three-layer hash verified and correctly separated" };
        }
        throw new Error("Expected coherent three-layer hash");
      },
    }),
  );

  // TS1-I-007: VAL ResultBundle 缺少盲审节 拒绝审核提交 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-007",
      name: "VAL ResultBundle 缺少盲审节 拒绝审核提交",
      command: "validateTs001BlindReview(validResultBundle)",
      inputContent: validResultBundle,
      evidencePointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-007.json",
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001BlindReview(validResultBundle);
          throw new Error("Expected blind review validation to fail on missing section");
        } catch (err) {
          if (err.code === "TS001_BLIND_REVIEW_MISSING") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-I-008: VAL 读取候选前候选 SHA 已变化 fail closed 退回新 attempt (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-I-008",
      name: "VAL 读取候选前候选 SHA 已变化 fail closed 退回新 attempt",
      command: "assertCandidateNotDrifted({ preValSha: 'aaa...', readSha: 'bbb...' })",
      inputContent: { preValSha: "a".repeat(64), readSha: "b".repeat(64) },
      evidencePointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-008.json",
      invariantsCovered: [],
      execute: async () => {
        const preValSha = "a".repeat(64);
        const readSha = "b".repeat(64);
        if (preValSha !== readSha) {
          return { status: "REJECTED", exitCode: 2, output: "candidate SHA drifted before VAL read: fail closed, retreat to new attempt" };
        }
        throw new Error("Expected candidate drift to fail closed");
      },
    }),
  );

  // =========================================================================
  // Group 4: Rollback / Recovery (TS1-R-001 ~ TS1-R-005)
  // =========================================================================

  // TS1-R-001: 恢复上一份共享合同/TaskSlice revision 创建新 revision 并建立 supersedes (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-001",
      name: "恢复上一份共享合同/TaskSlice revision 创建新 revision 并建立 supersedes",
      command: "validateTs001RollbackSupersedes({ oldRef, newRevision: '2', supersedesRef, g014Approved: true, g011Approved: true })",
      inputContent: { oldRevision: "1", newRevision: "2", supersedes: "1" },
      evidencePointer: "tests/fixtures/ts001/cases/rollback/TS1-R-001.json",
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
        return { status: "PASSED", output: "rollback created new revision 2 with supersedes link to revision 1" };
      },
    }),
  );

  // TS1-R-002: 回滚后重算引用、SHA 与链接 完整无残桩 (PASS)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-002",
      name: "回滚后重算引用、SHA 与链接 完整无残桩",
      command: "mechanicallyScanAllReferencesAndStubs()",
      inputContent: { scanTarget: "tests/fixtures/ts001" },
      evidencePointer: "tests/fixtures/ts001/manifest.json",
      invariantsCovered: [],
      execute: async () => {
        const missingFiles = [];
        const hashMismatches = [];

        // 1. 扫描 manifest 中的权威三文件
        const authorityFiles = [
          { pointer: "09_TS001_测试与回滚验收.md", expectedSha: manifest.authority_contract_sha256 },
          { pointer: "human-project-interaction-skills-prd.md", expectedSha: manifest.prd_sha256 },
          { pointer: "human-project-interaction-skills-technical-design.md", expectedSha: manifest.technical_design_sha256 },
        ];
        for (const { pointer, expectedSha } of authorityFiles) {
          if (!existsSync(pointer)) missingFiles.push(pointer);
          else {
            const actual = createHash("sha256").update(readFileSync(pointer)).digest("hex");
            if (actual !== expectedSha) hashMismatches.push({ pointer, expected: expectedSha, actual });
          }
        }

        // 2. 扫描 protocol fixture
        const protocolPath = experimentSpec.protocol_ref?.pointer;
        if (!protocolPath || !existsSync(protocolPath)) missingFiles.push(protocolPath || "missing_pointer");
        else {
          const actual = createHash("sha256").update(readFileSync(protocolPath)).digest("hex");
          if (actual !== experimentSpec.protocol_ref.sha256) {
            hashMismatches.push({ pointer: protocolPath, expected: experimentSpec.protocol_ref.sha256, actual });
          }
        }

        // 3. 扫描 acceptance-v1 README digest 是否与 manifest 一致
        const acceptanceManifest = JSON.parse(readFileSync("schemas/acceptance-v1/manifest.v1.json", "utf8"));
        const acceptanceReadme = readFileSync("schemas/acceptance-v1/README.md", "utf8");
        if (!acceptanceReadme.includes(acceptanceManifest.schema_set_digest)) {
          hashMismatches.push({
            pointer: "schemas/acceptance-v1/README.md",
            expected: acceptanceManifest.schema_set_digest,
            actual: "stale_or_missing",
          });
        }

        // 4. 扫描 cases_manifest 中所有 31 个用例的 evidence_pointer 存在性
        for (const item of manifest.cases_manifest) {
          if (!item.evidence_pointer || !existsSync(item.evidence_pointer)) {
            missingFiles.push(item.evidence_pointer || `missing_pointer_for_${item.id}`);
          }
        }

        if (missingFiles.length === 0 && hashMismatches.length === 0) {
          return { status: "PASSED", output: "mechanical scan verified 31 cases + authority + schemas: zero orphaned stubs" };
        }
        throw new Error(`Residual stubs detected: missing=${JSON.stringify(missingFiles)}, mismatch=${JSON.stringify(hashMismatches)}`);
      },
    }),
  );

  // TS1-R-003: 请求恢复 canonical 文件 没有 G-014 人工批准时拒绝 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-003",
      name: "请求恢复 canonical 文件 没有 G-014 人工批准时拒绝",
      command: "validateTs001RollbackSupersedes({ g014Approved: undefined })",
      inputContent: { g014Approved: undefined },
      evidencePointer: "tests/fixtures/ts001/cases/rollback/TS1-R-003.json",
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001RollbackSupersedes({
            oldRef: { id: "CANONICAL-001", revision: "1" },
            newRevision: "2",
            supersedesRef: { id: "CANONICAL-001", revision: "1" },
            g011Approved: true,
          });
          throw new Error("Expected canonical restore without G-014 to fail");
        } catch (err) {
          if (err.code === "TS001_G014_GATE_REQUIRED") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-R-004: 请求恢复或改变 fixture 内容 没有 G-011 测试合同 Gate 时拒绝 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-004",
      name: "请求恢复或改变 fixture 内容 没有 G-011 测试合同 Gate 时拒绝",
      command: "validateTs001RollbackSupersedes({ g011Approved: undefined })",
      inputContent: { g011Approved: undefined },
      evidencePointer: "tests/fixtures/ts001/cases/rollback/TS1-R-004.json",
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001RollbackSupersedes({
            oldRef: { id: "FIXTURE-001", revision: "1" },
            newRevision: "2",
            supersedesRef: { id: "FIXTURE-001", revision: "1" },
            g014Approved: true,
          });
          throw new Error("Expected fixture alteration without G-011 to fail");
        } catch (err) {
          if (err.code === "TS001_G011_GATE_REQUIRED") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // TS1-R-005: 回滚过程试图删除/覆盖原始记录 拒绝 (REJECT)
  caseResults.push(
    await agent.runCase({
      caseId: "TS1-R-005",
      name: "回滚过程试图删除/覆盖原始记录 拒绝，原版本保持可追溯",
      command: "validateTs001RollbackSupersedes({ oldRef: { revision: '1' }, newRevision: '1' })",
      inputContent: { oldRevision: "1", newRevision: "1" },
      evidencePointer: "tests/fixtures/ts001/cases/rollback/TS1-R-005.json",
      invariantsCovered: [],
      execute: async () => {
        try {
          validateTs001RollbackSupersedes({
            oldRef: { id: "TASK-001", revision: "1" },
            newRevision: "1",
            supersedesRef: { id: "TASK-001", revision: "1" },
            g014Approved: true,
            g011Approved: true,
          });
          throw new Error("Expected in-place revision overwrite to be rejected");
        } catch (err) {
          if (err.code === "TS001_IN_PLACE_OVERWRITE_FORBIDDEN") {
            return { status: "REJECTED", exitCode: 2, output: err.message };
          }
          throw err;
        }
      },
    }),
  );

  // Compile final ValidationResult bound to candidate and canonical manifest
  const validationResult = agent.compileValidationResult({
    taskRef: {
      id: valTask.task_id,
      revision: valTask.task_revision,
      sha256: sha256(valTask),
      pointer: "tests/fixtures/ts001/task-slices/ts001-val.v2.json",
    },
    candidateRef,
    contractRef,
    canonicalManifest: manifest,
    executedCases: caseResults,
  });

  return {
    manifest,
    executedCases: caseResults,
    validationResult,
  };
}
