import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../../src/contracts.mjs";
import {
  toWireAttempt,
  toWireEvidence,
  toWireHandoffBundle,
  toWireResultBundle,
  toWireTaskSlice,
  wireRecordRef,
} from "../../src/execution.mjs";

const CONTRACT_SHA256 = "e0aeffc678717ba7416b5ff775683ec00919ecc9bdf6054327f6020dedfb9804";
const PRD_SHA256 = "b9cdff8541bc7809aad32025e3c530a48b9e774c70a0af3e6437310cfe4a6c26";
const DESIGN_SHA256 = "4a1e5c8720bce7cd5615f6e6de95854a7dcdddefb91915b6dd18f6667c1bfcf8";

export function buildTs001Fixtures() {
  const contractRef = {
    id: "TS1-TEST-001",
    revision: "1",
    sha256: CONTRACT_SHA256,
    pointer: "09_TS001_测试与回滚验收.md",
  };
  const prdRef = {
    id: "DOC-HPI-PRD",
    revision: "1",
    sha256: PRD_SHA256,
    pointer: "human-project-interaction-skills-prd.md",
  };
  const designRef = {
    id: "DOC-HPI-TECH-DESIGN",
    revision: "1",
    sha256: DESIGN_SHA256,
    pointer: "human-project-interaction-skills-technical-design.md",
  };
  const painRef = {
    id: "P-HPI-002",
    revision: "1",
    sha256: sha256("PAIN-002: AI 代替人签字审核测试、hash、Schema，导致形式合规"),
    pointer: "human-project-interaction-skills-prd.md",
  };

  const implTask = toWireTaskSlice({
    taskId: "TS001-IMPL",
    projectId: "HPI-TS001-PILOT",
    title: "TS-001 实现任务切片",
    objective: "在 runtime 实现前先固定 Schema、权限/引用、幂等与回滚合同及测试基线。",
    painRefs: [painRef],
    requirementRefs: [],
    designRefs: [
      {
        id: "D-HPI-DUAL-STATUS",
        revision: "1",
        sha256: sha256("双轴状态分离"),
        pointer: "human-project-interaction-skills-technical-design.md",
      },
    ],
    nonGoals: ["不写 project canonical 状态。", "不实现科学算法。"],
    permissionScope: {
      allowedPaths: ["09_TS001_测试与回滚验收.md", "schemas/**", "src/**", "tests/**"],
      forbiddenPaths: ["canonical/**"],
      dataClasses: ["INTERNAL"],
      network: { mode: "DENY", allowedHosts: [] },
    },
    inputRefs: [prdRef, designRef],
    sharedContractRef: contractRef,
    acceptanceRef: contractRef,
    failureSemantics: "测试失败保持 INCOMPLETE；不伪造 PASS。",
    rollback: "创建新 revision；不原地覆盖。",
    assignedRoles: {
      implementation: {
        agentId: "agent-impl",
        role: "IMPLEMENTATION",
        harnessRevision: "harness/pilot-v1",
      },
      validation: {
        agentId: "agent-ts001-validator",
        role: "VALIDATION",
        harnessRevision: "harness/pilot-v1",
      },
    },
    machineStatus: "NOT-RUN",
    humanStatus: "NOT_NEEDED",
    statusSource: contractRef,
    changedFields: [],
    provenanceRefs: [contractRef],
    createdAt: "2026-08-29T10:00:00.000Z",
  });

  const implTaskRef = wireRecordRef(implTask, {
    idKey: "task_id",
    revisionKey: "task_revision",
    pointer: "tests/fixtures/ts001/task-slices/ts001-impl.v2.json",
  });

  const valTask = toWireTaskSlice({
    taskId: "TS001-VAL",
    projectId: "HPI-TS001-PILOT",
    title: "TS-001 独立验证切片",
    objective: "独立运行 4 组 31 条用例清单，核验不变量并出具 CONFORMANT 凭据。",
    painRefs: [painRef],
    requirementRefs: [],
    designRefs: [],
    nonGoals: ["不替代人类最终业务验收。", "不修改代码或配置。"],
    permissionScope: {
      allowedPaths: ["tests/fixtures/ts001/**", ".pi/artifacts/ts001-validation/**"],
      forbiddenPaths: ["canonical/**", "schemas/**", "src/**"],
      dataClasses: ["INTERNAL"],
      network: { mode: "DENY", allowedHosts: [] },
    },
    inputRefs: [implTaskRef],
    sharedContractRef: contractRef,
    acceptanceRef: contractRef,
    failureSemantics: "任一用例失败即 NON-CONFORMANT；不自动跳过。",
    rollback: "测试记录隔离保留，不覆盖历史。",
    assignedRoles: {
      implementation: {
        agentId: "agent-impl",
        role: "IMPLEMENTATION",
        harnessRevision: "harness/pilot-v1",
      },
      validation: {
        agentId: "agent-ts001-validator",
        role: "VALIDATION",
        harnessRevision: "harness/pilot-v1",
      },
    },
    machineStatus: "NOT-RUN",
    humanStatus: "NOT_NEEDED",
    statusSource: contractRef,
    changedFields: [],
    provenanceRefs: [contractRef],
    createdAt: "2026-08-29T10:00:00.000Z",
  });

  const experimentSpec = {
    schema: "hpi/wire/experiment-spec/v1",
    experiment_id: "E017",
    version: "4",
    status: "frozen",
    title: "TS-001 模拟实验规范 E017",
    description: "只读实验规范 fixture，用于验证 G-002 只读对象防篡改 Gate。",
    protocol_ref: {
      id: "PROTO-E017",
      revision: "2",
      sha256: "622075004393c8139152afe6867c4541fd9c56b353c63a8a49d63bb4ca88bc93",
      pointer: "tests/fixtures/ts001/protocols/protocol-e017.md",
    },
    parameters: {
      temperature: 0.7,
      seed_policy: "fixed",
    },
    acceptance_criteria: [
      "三臂非 arm 字段指纹一致",
      "只读对象禁止 mutation 请求",
    ],
    created_by: "text-agent",
    created_at: "2026-08-29T10:00:00.000Z",
  };

  const handoffBundle = toWireHandoffBundle({
    handoffId: "HO-TS001-001",
    taskRef: implTaskRef,
    sender: {
      agentId: "agent-coordinator",
      role: "COORDINATOR",
      harnessRevision: "harness/pilot-v1",
    },
    receiver: {
      agentId: "agent-impl",
      role: "IMPLEMENTATION",
      harnessRevision: "harness/pilot-v1",
    },
    inputRevisions: [contractRef, prdRef, designRef, implTaskRef],
    objective: implTask.objective,
    nonGoals: ["不写 project canonical 状态。", "不实现科学算法。"],
    permissionScope: {
      allowedPaths: ["09_TS001_测试与回滚验收.md", "schemas/**", "src/**", "tests/**"],
      forbiddenPaths: ["canonical/**"],
      dataClasses: ["INTERNAL"],
      network: { mode: "DENY", allowedHosts: [] },
    },
    expectedOutput: "Schema、权限/引用、幂等与回滚测试用例及凭证。",
    acceptanceRef: contractRef,
    failureSemantics: "测试失败保持 INCOMPLETE；不伪造 PASS。",
    contextSummary: "执行 TS-001 实现任务切片，结构化字段优先。",
    changedFields: [],
    provenanceRefs: [contractRef],
    createdAt: "2026-08-29T10:05:00.000Z",
  });

  const handoffRef = wireRecordRef(handoffBundle, {
    idKey: "handoff_id",
    revisionKey: "handoff_revision",
    pointer: "tests/fixtures/ts001/handoff-bundles/valid.v2.json",
  });

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

  const resultBundle = toWireResultBundle({
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

  return {
    implTask,
    valTask,
    experimentSpec,
    handoffBundle,
    resultBundle,
    contractRef,
    prdRef,
    designRef,
  };
}

export function writeTs001Fixtures(targetRoot) {
  const fixtures = buildTs001Fixtures();

  const paths = {
    implTask: join(targetRoot, "task-slices/ts001-impl.v2.json"),
    valTask: join(targetRoot, "task-slices/ts001-val.v2.json"),
    experimentSpec: join(targetRoot, "experiment-specs/e017.v4.json"),
    handoffBundle: join(targetRoot, "handoff-bundles/valid.v2.json"),
    resultBundle: join(targetRoot, "result-bundles/valid.v2.json"),
    manifest: join(targetRoot, "manifest.json"),
  };

  for (const p of Object.values(paths)) {
    mkdirSync(dirname(p), { recursive: true });
  }

  writeFileSync(paths.implTask, JSON.stringify(fixtures.implTask, null, 2) + "\n");
  writeFileSync(paths.valTask, JSON.stringify(fixtures.valTask, null, 2) + "\n");
  writeFileSync(paths.experimentSpec, JSON.stringify(fixtures.experimentSpec, null, 2) + "\n");
  writeFileSync(paths.handoffBundle, JSON.stringify(fixtures.handoffBundle, null, 2) + "\n");
  writeFileSync(paths.resultBundle, JSON.stringify(fixtures.resultBundle, null, 2) + "\n");

  const caseStimuli = {
    "cases/schema/TS1-S-005.json": { stimulus: "missing_required_fields", schemas: ["task-slice", "handoff-bundle", "result-bundle", "experiment-spec"] },
    "cases/schema/TS1-S-006.json": { stimulus: "field_type_mismatch", schemas: ["task-slice", "handoff-bundle", "result-bundle", "experiment-spec"] },
    "cases/schema/TS1-S-007.json": { stimulus: "invalid_task_id", task_id: "UNKNOWN-TASK" },
    "cases/schema/TS1-S-008.json": { stimulus: "invalid_dataclass", data_class: "FORBIDDEN_RESTRICTED" },
    "cases/schema/TS1-S-009.json": { stimulus: "invalid_verdict", verdict: "PASS" },
    "cases/schema/TS1-S-010.json": { stimulus: "duplicate_entity_id", records: [{ entity_id: "DUP-001" }, { entity_id: "DUP-001" }] },
    "cases/schema/TS1-S-011.json": { stimulus: "missing_gate_config", required_gates: ["G-002", "G-011", "G-014", "G-SCHEMA", "G-PERMISSION"] },
    "cases/permissions/TS1-P-001.json": { stimulus: "unresolvable_spec_ref", pointer: "tests/fixtures/ts001/non-existent.json" },
    "cases/permissions/TS1-P-002.json": { stimulus: "artifact_hash_mismatch", expected: "a".repeat(64), actual: "b".repeat(64) },
    "cases/permissions/TS1-P-003.json": { stimulus: "outside_allowlist", path: "canonical/state.yaml", forbidden_paths: ["canonical/**"] },
    "cases/permissions/TS1-P-004.json": { stimulus: "readonly_spec_mutation", action: "MUTATE", spec_status: "frozen" },
    "cases/permissions/TS1-P-005.json": { stimulus: "unmet_preconditions", impl_accepted: false, candidate_frozen: false },
    "cases/permissions/TS1-P-006.json": { stimulus: "missing_dataclass", data_class: undefined },
    "cases/permissions/TS1-P-007.json": { stimulus: "stale_expected_version", current_version: 2, expected_version: 1 },
    "cases/idempotency/TS1-I-001.json": { stimulus: "handoff_sha_mismatch", claimed_sha: "a".repeat(64), actual_sha: "b".repeat(64) },
    "cases/idempotency/TS1-I-002.json": { stimulus: "receiver_mismatch", intended: "agent-impl", actual: "agent-other" },
    "cases/idempotency/TS1-I-004.json": { stimulus: "failed_attempt_retry", previous_attempt: "ATTEMPT-TS001-001", retry_attempt: "ATTEMPT-TS001-002" },
    "cases/idempotency/TS1-I-005.json": { stimulus: "rejection_ledger_retention", bundle_id: "RB-TS001-001" },
    "cases/idempotency/TS1-I-006.json": { stimulus: "three_layer_hash", layers: ["worker_reported", "coordinator_pre_harness", "harness_authoritative"] },
    "cases/idempotency/TS1-I-007.json": { stimulus: "missing_blind_review", bundle_id: "RB-TS001-001" },
    "cases/idempotency/TS1-I-008.json": { stimulus: "candidate_drift", pre_val_sha: "a".repeat(64), read_sha: "b".repeat(64) },
    "cases/rollback/TS1-R-001.json": { stimulus: "rollback_supersedes", old_revision: "1", new_revision: "2" },
    "cases/rollback/TS1-R-003.json": { stimulus: "missing_g014_approval", g014_approved: undefined },
    "cases/rollback/TS1-R-004.json": { stimulus: "missing_g011_gate", g011_approved: undefined },
    "cases/rollback/TS1-R-005.json": { stimulus: "in_place_overwrite", old_revision: "1", new_revision: "1" },
  };

  for (const [relPath, content] of Object.entries(caseStimuli)) {
    const fullPath = join(targetRoot, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(content, null, 2) + "\n");
  }

  const manifest = {
    contract_id: "TS1-TEST-001",
    revision: "1",
    authority_contract_sha256: CONTRACT_SHA256,
    prd_sha256: PRD_SHA256,
    technical_design_sha256: DESIGN_SHA256,
    cases_count: 31,
    cases_manifest: [
      { id: "TS1-S-001", group: "SCHEMA", name: "合法 TaskSlice fixture", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/task-slices/ts001-impl.v2.json" },
      { id: "TS1-S-002", group: "SCHEMA", name: "合法 HandoffBundle fixture", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/handoff-bundles/valid.v2.json" },
      { id: "TS1-S-003", group: "SCHEMA", name: "合法 ResultBundle fixture", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/result-bundles/valid.v2.json" },
      { id: "TS1-S-004", group: "SCHEMA", name: "合法 ExperimentSpec 只读 fixture", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/experiment-specs/e017.v4.json" },
      { id: "TS1-S-005", group: "SCHEMA", name: "删除必填字段拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/schema/TS1-S-005.json" },
      { id: "TS1-S-006", group: "SCHEMA", name: "字段类型错误拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/schema/TS1-S-006.json" },
      { id: "TS1-S-007", group: "SCHEMA", name: "不合规 task_id 格式拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/schema/TS1-S-007.json" },
      { id: "TS1-S-008", group: "SCHEMA", name: "封闭枚举外 data_class 拒绝 (INV-016)", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/schema/TS1-S-008.json" },
      { id: "TS1-S-009", group: "SCHEMA", name: "VAL verdict 非词表值拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/schema/TS1-S-009.json" },
      { id: "TS1-S-010", group: "SCHEMA", name: "重复 entity_id 拒绝 (INV-002)", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/schema/TS1-S-010.json" },
      { id: "TS1-S-011", group: "SCHEMA", name: "缺失 integrity rule/Gate 配置 fail closed (INV-012)", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/schema/TS1-S-011.json" },
      { id: "TS1-P-001", group: "PERMISSION_REF", name: "spec_ref 不存在时拒绝 (INV-004)", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/permissions/TS1-P-001.json" },
      { id: "TS1-P-002", group: "PERMISSION_REF", name: "artifact hash 不符时拒绝 (INV-005)", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/permissions/TS1-P-002.json" },
      { id: "TS1-P-003", group: "PERMISSION_REF", name: "写入 allowlist 外路径拒绝 (INV-007)", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/permissions/TS1-P-003.json" },
      { id: "TS1-P-004", group: "PERMISSION_REF", name: "只读 ExperimentSpec 发起 mutation 拒绝 (G-002)", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/permissions/TS1-P-004.json" },
      { id: "TS1-P-005", group: "PERMISSION_REF", name: "前置未满足时 VAL 拒绝进入 running", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/permissions/TS1-P-005.json" },
      { id: "TS1-P-006", group: "PERMISSION_REF", name: "引用未登记来源数据拒绝 (INV-016)", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/permissions/TS1-P-006.json" },
      { id: "TS1-P-007", group: "PERMISSION_REF", name: "陈旧 expected_version 提交拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/permissions/TS1-P-007.json" },
      { id: "TS1-I-001", group: "IDEMPOTENCY_HANDOFF", name: "HandoffBundle SHA 不匹配拒收", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-001.json" },
      { id: "TS1-I-002", group: "IDEMPOTENCY_HANDOFF", name: "receiver 与 intended 身份不符拒收", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-002.json" },
      { id: "TS1-I-003", group: "IDEMPOTENCY_HANDOFF", name: "重发 ResultBundle 幂等不二次 commit (INV-011)", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/result-bundles/valid.v2.json" },
      { id: "TS1-I-004", group: "IDEMPOTENCY_HANDOFF", name: "retry 创建新 attempt 保留旧记录 (INV-011)", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-004.json" },
      { id: "TS1-I-005", group: "IDEMPOTENCY_HANDOFF", name: "提交被拒留存记录不静默删除", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-005.json" },
      { id: "TS1-I-006", group: "IDEMPOTENCY_HANDOFF", name: "三层 hash 标注严格区分 (CT-001)", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-006.json" },
      { id: "TS1-I-007", group: "IDEMPOTENCY_HANDOFF", name: "VAL ResultBundle 缺盲审节拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-007.json" },
      { id: "TS1-I-008", group: "IDEMPOTENCY_HANDOFF", name: "候选 SHA 漂移 fail closed 退回新 attempt", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/idempotency/TS1-I-008.json" },
      { id: "TS1-R-001", group: "ROLLBACK_RECOVERY", name: "回滚创建新 revision 建立 supersedes 不原地覆盖", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/cases/rollback/TS1-R-001.json" },
      { id: "TS1-R-002", group: "ROLLBACK_RECOVERY", name: "回滚后重算引用 SHA 完整无残桩", expected: "PASS", evidence_pointer: "tests/fixtures/ts001/manifest.json" },
      { id: "TS1-R-003", group: "ROLLBACK_RECOVERY", name: "恢复 canonical 文件无 G-014 审批时拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/rollback/TS1-R-003.json" },
      { id: "TS1-R-004", group: "ROLLBACK_RECOVERY", name: "改变 fixture 无 G-011 Gate 拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/rollback/TS1-R-004.json" },
      { id: "TS1-R-005", group: "ROLLBACK_RECOVERY", name: "试图覆盖或删除原始历史记录拒绝", expected: "REJECT", evidence_pointer: "tests/fixtures/ts001/cases/rollback/TS1-R-005.json" },
    ],
  };

  manifest.manifest_digest = sha256(manifest);
  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
