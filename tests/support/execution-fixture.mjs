import {
  computeStaleReport,
  toWireAttempt,
  toWireEvidence,
  toWireHandoffBundle,
  toWireResultBundle,
  toWireTaskSlice,
  wireRecordRef,
} from "../../src/execution.mjs";

const digest = (character) => character.repeat(64);
const ref = (id, revision, character, pointer) => ({
  id,
  revision,
  sha256: digest(character),
  ...(pointer ? { pointer } : {}),
});

export function buildExecutionFixture() {
  const refs = {
    source: ref("SRC-FIXTURE-001", "1", "a", "fixtures/source.md"),
    pain: ref("P-FIXTURE-001", "1", "b", "fixtures/pain.md"),
    contract: ref("CONTRACT-FIXTURE-001", "1", "c", "fixtures/contract.json"),
    acceptance: ref("ACCEPT-FIXTURE-001", "1", "d", "fixtures/acceptance.md"),
    provenance: ref("PROV-FIXTURE-001", "1", "e", "fixtures/provenance.json"),
    statusSource: ref("STATUS-FIXTURE-001", "1", "f", "fixtures/status.json"),
    workspace: ref("WORKSPACE-FIXTURE-001", "1", "1", "workspaces/attempt-001"),
    retryWorkspace: ref("WORKSPACE-FIXTURE-002", "1", "2", "workspaces/attempt-002"),
  };
  const permissionScope = {
    allowedPaths: ["schemas/execution-v1/**", "src/execution.mjs", "tests/**"],
    forbiddenPaths: ["canonical/**"],
    dataClasses: ["INTERNAL"],
    network: { mode: "DENY", allowedHosts: [] },
  };
  const assignedRoles = {
    implementation: {
      agentId: "agent-impl",
      role: "IMPLEMENTATION",
      harnessRevision: "harness/fixture",
    },
    validation: {
      agentId: "agent-validation",
      role: "VALIDATION",
      harnessRevision: "harness/fixture",
    },
  };
  const commonTaskInput = {
    taskId: "TS-FIXTURE-EXEC-001",
    projectId: "HPI-FIXTURE-PROJECT",
    title: "冻结 execution wire 合同",
    painRefs: [refs.pain],
    requirementRefs: [],
    designRefs: [],
    nonGoals: ["不写 project canonical。"],
    permissionScope,
    inputRefs: [refs.source],
    sharedContractRef: refs.contract,
    acceptanceRef: refs.acceptance,
    failureSemantics: "缺少引用、身份、权限或 evidence 时保持 INCOMPLETE。",
    rollback: "删除派生候选；不覆盖旧 revision。",
    assignedRoles,
    machineStatus: "NOT-RUN",
    humanStatus: "NOT_NEEDED",
    statusSource: refs.statusSource,
    provenanceRefs: [refs.provenance],
    createdAt: "2026-08-30T01:00:00.000Z",
  };
  const oldTaskInput = {
    ...commonTaskInput,
    objective: "旧目标：仅描述 Bundle。",
    changedFields: [],
  };
  const oldTask = toWireTaskSlice(oldTaskInput);
  const oldTaskRef = wireRecordRef(oldTask, {
    idKey: "task_id",
    revisionKey: "task_revision",
    pointer: "fixtures/task-old.json",
  });
  const taskInput = {
    ...commonTaskInput,
    objective: "冻结 Bundle、Evidence、retry 与 stale preview。",
    supersedes: oldTaskRef,
    changedFields: ["objective"],
  };
  const task = toWireTaskSlice(taskInput);
  const taskRef = wireRecordRef(task, {
    idKey: "task_id",
    revisionKey: "task_revision",
    pointer: "fixtures/task.json",
  });
  const handoffInput = {
    handoffId: "HO-FIXTURE-001",
    taskRef,
    sender: {
      agentId: "agent-coordinator",
      role: "COORDINATOR",
      harnessRevision: "harness/fixture",
    },
    receiver: {
      agentId: "agent-impl",
      role: "IMPLEMENTATION",
      harnessRevision: "harness/fixture",
    },
    inputRevisions: [refs.source, taskRef],
    objective: task.objective,
    nonGoals: ["不执行真实项目测试。"],
    permissionScope,
    expectedOutput: "Schema、fixture 和纯 lifecycle 结果。",
    acceptanceRef: refs.acceptance,
    failureSemantics: "任何缺字段或 drift 均 fail closed。",
    contextSummary: "该摘要仅用于定向，结构化字段优先。",
    changedFields: [],
    provenanceRefs: [refs.provenance],
    createdAt: "2026-08-30T01:10:00.000Z",
  };
  const handoff = toWireHandoffBundle(handoffInput);
  const handoffRef = wireRecordRef(handoff, {
    idKey: "handoff_id",
    revisionKey: "handoff_revision",
    pointer: "fixtures/handoff.json",
  });
  const attemptInput = {
    attemptId: "ATTEMPT-FIXTURE-001",
    taskRef,
    handoffRef,
    ordinal: 1,
    status: "FAILED",
    workspaceRef: refs.workspace,
    startedAt: "2026-08-30T01:11:00.000Z",
    endedAt: "2026-08-30T01:12:00.000Z",
    failure: { kind: "EVIDENCE", summary: "缺少真实运行证据。", retryable: true },
    changedFields: [],
    provenanceRefs: [refs.provenance],
    createdAt: "2026-08-30T01:10:30.000Z",
  };
  const attempt = toWireAttempt(attemptInput);
  const attemptRef = wireRecordRef(attempt, {
    idKey: "attempt_id",
    revisionKey: "attempt_revision",
    pointer: "fixtures/attempt.json",
  });
  const evidenceInput = {
    evidenceId: "EV-FIXTURE-001",
    taskRef,
    attemptId: attempt.attempt_id,
    kind: "REFERENCE",
    pointer: "fixtures/source.md",
    sha256: refs.source.sha256,
    status: "PRE_HARNESS_CHECKED",
    claimRefs: ["FACT-FIXTURE-INCOMPLETE"],
    collectedBy: {
      agentId: "agent-impl",
      role: "IMPLEMENTATION",
      harnessRevision: "harness/fixture",
    },
    verifiedBy: [],
    limitations: ["仅为 synthetic fixture。"],
    sensitivity: "INTERNAL",
    changedFields: [],
    provenanceRefs: [refs.provenance],
    createdAt: "2026-08-30T01:12:00.000Z",
  };
  const evidence = toWireEvidence(evidenceInput);
  const evidenceRef = wireRecordRef(evidence, {
    idKey: "evidence_id",
    revisionKey: "evidence_revision",
    pointer: "fixtures/evidence.json",
  });
  const machineResult = {
    schema: "hpi/machine-result/v1",
    resultId: "MR-FIXTURE-EXEC-001",
    taskId: task.task_id,
    attemptId: attempt.attempt_id,
    sourceRef: taskRef,
    verdict: "INCOMPLETE",
    facts: [
      {
        id: "FACT-FIXTURE-INCOMPLETE",
        kind: "REFERENCE",
        statement: "只存在 synthetic fixture，未执行真实 Harness。",
        status: "INCOMPLETE",
        evidenceRefs: [evidenceRef],
      },
    ],
    limitations: ["不是运行证据。"],
    unresolved: ["需要真实 Implementation/Validation runtime。"],
  };
  const resultInput = {
    resultBundleId: "RB-FIXTURE-001",
    taskRef,
    handoffRef,
    attemptRecord: attempt,
    generatedBy: {
      agentId: "agent-impl",
      role: "IMPLEMENTATION",
      harnessRevision: "harness/fixture",
    },
    submittedAt: "2026-08-30T01:13:00.000Z",
    machineResult,
    evidenceRecords: [evidence],
    outputRefs: [],
    failure: { kind: "EVIDENCE", summary: "缺少真实运行证据。", retryable: true },
    unresolved: ["runtime intake 未实现。"],
    nextAttempt: { recommended: true, reason: "真实 runtime 可用后新建 attempt。" },
    changedFields: [],
    provenanceRefs: [refs.provenance],
  };
  const result = toWireResultBundle(resultInput);
  const resultRef = wireRecordRef(result, {
    idKey: "result_bundle_id",
    revisionKey: "bundle_revision",
    pointer: "fixtures/result.json",
  });
  const staleInput = {
    upstreamBefore: oldTaskRef,
    upstreamAfter: taskRef,
    dependents: [
      {
        targetRef: handoffRef,
        relation: "uses",
        reason: "Handoff 绑定了旧 TaskSlice revision。",
      },
      {
        targetRef: resultRef,
        relation: "implements",
        reason: "结果语义需对新目标复核。",
      },
    ],
    detectedAt: "2026-08-30T01:14:00.000Z",
    provenanceRefs: [refs.provenance],
  };
  const staleReport = computeStaleReport(staleInput).report;

  return {
    instances: {
      task_slice: task,
      handoff_bundle: handoff,
      attempt,
      evidence,
      result_bundle: result,
      stale_report: staleReport,
    },
    records: { oldTask, task, handoff, attempt, evidence, result, staleReport },
    refs: { ...refs, oldTaskRef, taskRef, handoffRef, attemptRef, evidenceRef, resultRef },
    inputs: { oldTaskInput, taskInput, handoffInput, attemptInput, evidenceInput, resultInput, staleInput },
  };
}
