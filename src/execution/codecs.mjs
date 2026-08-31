import { HUMAN_STATUSES, MACHINE_VERDICTS } from "../contracts.mjs";
import { toWireMachineResult } from "../wire.mjs";
import {
  ATTEMPT_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_STATUSES,
  SENSITIVITIES,
  TERMINAL_ATTEMPT_STATUSES,
  agent,
  arrayAt,
  assertWireRecordRevision,
  changedFields,
  ensureSha,
  enumValue,
  exactKeys,
  fail,
  failure,
  frozenIdentityKey,
  frozenRef,
  frozenRefs,
  idempotencyKey,
  nextAttempt,
  nonEmpty,
  permissionScope,
  sameFrozenIdentity,
  sameLogicalSupersedes,
  sealRecord,
  strings,
  timestamp,
  wireRecordRef,
} from "./contract.mjs";

export function toWireTaskSlice(value) {
  const object = exactKeys(
    value,
    [
      "taskId",
      "projectId",
      "title",
      "objective",
      "painRefs",
      "requirementRefs",
      "designRefs",
      "nonGoals",
      "permissionScope",
      "inputRefs",
      "sharedContractRef",
      "acceptanceRef",
      "failureSemantics",
      "rollback",
      "assignedRoles",
      "machineStatus",
      "humanStatus",
      "statusSource",
      "supersedes",
      "changedFields",
      "provenanceRefs",
      "createdAt",
    ],
    [
      "taskId",
      "projectId",
      "title",
      "objective",
      "painRefs",
      "requirementRefs",
      "designRefs",
      "nonGoals",
      "permissionScope",
      "inputRefs",
      "sharedContractRef",
      "acceptanceRef",
      "failureSemantics",
      "rollback",
      "assignedRoles",
      "machineStatus",
      "humanStatus",
      "statusSource",
      "changedFields",
      "provenanceRefs",
      "createdAt",
    ],
    "taskSlice",
  );
  const taskId = nonEmpty(object.taskId, "taskSlice.taskId");
  const painRefs = frozenRefs(object.painRefs, "taskSlice.painRefs");
  const requirementRefs = frozenRefs(object.requirementRefs, "taskSlice.requirementRefs");
  const designRefs = frozenRefs(object.designRefs, "taskSlice.designRefs");
  if (painRefs.length + requirementRefs.length + designRefs.length === 0) {
    fail("taskSlice", "must reference at least one Pain, Requirement, or Design revision");
  }
  const roles = exactKeys(
    object.assignedRoles,
    ["implementation", "validation"],
    ["implementation", "validation"],
    "taskSlice.assignedRoles",
  );
  const implementation = agent(roles.implementation, "taskSlice.assignedRoles.implementation");
  const validation = agent(roles.validation, "taskSlice.assignedRoles.validation");
  if (implementation.role !== "IMPLEMENTATION") {
    fail("taskSlice.assignedRoles.implementation.role", "must equal IMPLEMENTATION");
  }
  if (validation.role !== "VALIDATION") {
    fail("taskSlice.assignedRoles.validation.role", "must equal VALIDATION");
  }
  if (implementation.agent_id === validation.agent_id) {
    fail("taskSlice.assignedRoles", "implementation and validation must use different agent identities");
  }
  const supersedes = sameLogicalSupersedes(object.supersedes, taskId, "taskSlice.supersedes");
  const draft = {
    schema: "hpi/wire/task-slice/v2",
    task_id: taskId,
    project_id: nonEmpty(object.projectId, "taskSlice.projectId"),
    title: nonEmpty(object.title, "taskSlice.title"),
    objective: nonEmpty(object.objective, "taskSlice.objective"),
    pain_refs: painRefs,
    requirement_refs: requirementRefs,
    design_refs: designRefs,
    non_goals: strings(object.nonGoals, "taskSlice.nonGoals"),
    permission_scope: permissionScope(object.permissionScope, "taskSlice.permissionScope"),
    input_refs: frozenRefs(object.inputRefs, "taskSlice.inputRefs", { min: 1 }),
    shared_contract_ref: frozenRef(object.sharedContractRef, "taskSlice.sharedContractRef"),
    acceptance_ref: frozenRef(object.acceptanceRef, "taskSlice.acceptanceRef"),
    failure_semantics: nonEmpty(object.failureSemantics, "taskSlice.failureSemantics"),
    rollback: nonEmpty(object.rollback, "taskSlice.rollback"),
    assigned_roles: { implementation, validation },
    machine_status: enumValue(object.machineStatus, MACHINE_VERDICTS, "taskSlice.machineStatus"),
    human_status: enumValue(object.humanStatus, HUMAN_STATUSES, "taskSlice.humanStatus"),
    status_source: frozenRef(object.statusSource, "taskSlice.statusSource"),
    ...(supersedes === undefined ? {} : { supersedes }),
    changed_fields: changedFields(object.changedFields, "taskSlice.changedFields", supersedes),
    provenance_refs: frozenRefs(object.provenanceRefs, "taskSlice.provenanceRefs", { min: 1 }),
    created_at: timestamp(object.createdAt, "taskSlice.createdAt"),
  };
  return sealRecord(draft, "task_revision");
}

export function toWireHandoffBundle(value) {
  const object = exactKeys(
    value,
    [
      "handoffId",
      "taskRef",
      "sender",
      "receiver",
      "inputRevisions",
      "objective",
      "nonGoals",
      "permissionScope",
      "expectedOutput",
      "acceptanceRef",
      "failureSemantics",
      "contextSummary",
      "supersedes",
      "changedFields",
      "provenanceRefs",
      "createdAt",
    ],
    [
      "handoffId",
      "taskRef",
      "sender",
      "receiver",
      "inputRevisions",
      "objective",
      "nonGoals",
      "permissionScope",
      "expectedOutput",
      "acceptanceRef",
      "failureSemantics",
      "contextSummary",
      "changedFields",
      "provenanceRefs",
      "createdAt",
    ],
    "handoffBundle",
  );
  const handoffId = nonEmpty(object.handoffId, "handoffBundle.handoffId");
  const taskRef = frozenRef(object.taskRef, "handoffBundle.taskRef");
  const sender = agent(object.sender, "handoffBundle.sender");
  const receiver = agent(object.receiver, "handoffBundle.receiver");
  if (sender.agent_id === receiver.agent_id) {
    fail("handoffBundle", "sender and receiver must use different agent identities");
  }
  const inputRevisions = frozenRefs(object.inputRevisions, "handoffBundle.inputRevisions", { min: 1 });
  const scope = permissionScope(object.permissionScope, "handoffBundle.permissionScope");
  const acceptanceRef = frozenRef(object.acceptanceRef, "handoffBundle.acceptanceRef");
  const supersedes = sameLogicalSupersedes(object.supersedes, handoffId, "handoffBundle.supersedes");
  const semantic = {
    handoff_id: handoffId,
    task_ref: taskRef,
    sender,
    receiver,
    input_revisions: inputRevisions,
    objective: nonEmpty(object.objective, "handoffBundle.objective"),
    non_goals: strings(object.nonGoals, "handoffBundle.nonGoals"),
    permission_scope: scope,
    expected_output: nonEmpty(object.expectedOutput, "handoffBundle.expectedOutput"),
    acceptance_ref: acceptanceRef,
    failure_semantics: nonEmpty(object.failureSemantics, "handoffBundle.failureSemantics"),
    context_summary: {
      text: nonEmpty(object.contextSummary, "handoffBundle.contextSummary"),
      authoritative: false,
      purpose: "ORIENTATION_ONLY",
    },
    safe_default: "NO_STATE_CHANGE",
  };
  return sealRecord(
    {
      schema: "hpi/wire/handoff-bundle/v2",
      ...semantic,
      idempotency_key: idempotencyKey("handoff", {
        task_ref: taskRef,
        sender,
        receiver,
      }),
      ...(supersedes === undefined ? {} : { supersedes }),
      changed_fields: changedFields(object.changedFields, "handoffBundle.changedFields", supersedes),
      provenance_refs: frozenRefs(object.provenanceRefs, "handoffBundle.provenanceRefs", { min: 1 }),
      created_at: timestamp(object.createdAt, "handoffBundle.createdAt"),
    },
    "handoff_revision",
  );
}

export function toWireAttempt(value) {
  const object = exactKeys(
    value,
    [
      "attemptId",
      "taskRef",
      "handoffRef",
      "ordinal",
      "status",
      "workspaceRef",
      "startedAt",
      "endedAt",
      "retryOf",
      "failure",
      "terminalResultRef",
      "supersedes",
      "changedFields",
      "provenanceRefs",
      "createdAt",
    ],
    [
      "attemptId",
      "taskRef",
      "handoffRef",
      "ordinal",
      "status",
      "workspaceRef",
      "failure",
      "changedFields",
      "provenanceRefs",
      "createdAt",
    ],
    "attempt",
  );
  const attemptId = nonEmpty(object.attemptId, "attempt.attemptId");
  if (!Number.isSafeInteger(object.ordinal) || object.ordinal < 1) fail("attempt.ordinal", "must be an integer >= 1");
  const status = enumValue(object.status, ATTEMPT_STATUSES, "attempt.status");
  const retryOf = object.retryOf === undefined ? undefined : frozenRef(object.retryOf, "attempt.retryOf");
  if (object.ordinal === 1 && retryOf) fail("attempt.retryOf", "must be absent on ordinal 1");
  if (object.ordinal > 1 && !retryOf) fail("attempt.retryOf", "is required when ordinal > 1");
  if (retryOf?.id === attemptId) fail("attempt.retryOf.id", "must refer to a different attempt id");
  const startedAt = object.startedAt === undefined ? undefined : timestamp(object.startedAt, "attempt.startedAt");
  const endedAt = object.endedAt === undefined ? undefined : timestamp(object.endedAt, "attempt.endedAt");
  if (["RUNNING", "SUCCEEDED", "FAILED", "BLOCKED", "INTERRUPTED"].includes(status) && !startedAt) {
    fail("attempt.startedAt", `is required for ${status}`);
  }
  if (TERMINAL_ATTEMPT_STATUSES.includes(status) && !endedAt) fail("attempt.endedAt", `is required for ${status}`);
  if (!TERMINAL_ATTEMPT_STATUSES.includes(status) && endedAt) fail("attempt.endedAt", `must be absent for ${status}`);
  const failureRecord = failure(object.failure, "attempt.failure");
  const terminalResultRef =
    object.terminalResultRef === undefined
      ? undefined
      : frozenRef(object.terminalResultRef, "attempt.terminalResultRef");
  if (status === "SUCCEEDED" && !terminalResultRef) fail("attempt.terminalResultRef", "is required for SUCCEEDED");
  if (status === "SUCCEEDED" && failureRecord.kind !== "NONE") fail("attempt.failure", "must be NONE for SUCCEEDED");
  if (["NOT_STARTED", "RUNNING"].includes(status) && failureRecord.kind !== "NONE") {
    fail("attempt.failure", `must be NONE for ${status}`);
  }
  if (["FAILED", "BLOCKED", "INTERRUPTED", "CANCELLED"].includes(status) && failureRecord.kind === "NONE") {
    fail("attempt.failure", `must explain ${status}`);
  }
  const supersedes = sameLogicalSupersedes(object.supersedes, attemptId, "attempt.supersedes");
  return sealRecord(
    {
      schema: "hpi/wire/attempt/v2",
      attempt_id: attemptId,
      task_ref: frozenRef(object.taskRef, "attempt.taskRef"),
      handoff_ref: frozenRef(object.handoffRef, "attempt.handoffRef"),
      ordinal: object.ordinal,
      status,
      workspace_ref: frozenRef(object.workspaceRef, "attempt.workspaceRef"),
      ...(startedAt === undefined ? {} : { started_at: startedAt }),
      ...(endedAt === undefined ? {} : { ended_at: endedAt }),
      ...(retryOf === undefined ? {} : { retry_of: retryOf }),
      failure: failureRecord,
      ...(terminalResultRef === undefined ? {} : { terminal_result_ref: terminalResultRef }),
      ...(supersedes === undefined ? {} : { supersedes }),
      changed_fields: changedFields(object.changedFields, "attempt.changedFields", supersedes),
      provenance_refs: frozenRefs(object.provenanceRefs, "attempt.provenanceRefs", { min: 1 }),
      created_at: timestamp(object.createdAt, "attempt.createdAt"),
    },
    "attempt_revision",
  );
}


export function toWireEvidence(value) {
  const object = exactKeys(
    value,
    [
      "evidenceId",
      "taskRef",
      "attemptId",
      "kind",
      "pointer",
      "sha256",
      "status",
      "claimRefs",
      "collectedBy",
      "verifiedBy",
      "limitations",
      "sensitivity",
      "supersedes",
      "changedFields",
      "provenanceRefs",
      "createdAt",
    ],
    [
      "evidenceId",
      "taskRef",
      "attemptId",
      "kind",
      "pointer",
      "sha256",
      "status",
      "claimRefs",
      "collectedBy",
      "verifiedBy",
      "limitations",
      "sensitivity",
      "changedFields",
      "provenanceRefs",
      "createdAt",
    ],
    "evidence",
  );
  const evidenceId = nonEmpty(object.evidenceId, "evidence.evidenceId");
  const status = enumValue(object.status, EVIDENCE_STATUSES, "evidence.status");
  const collectedBy = agent(object.collectedBy, "evidence.collectedBy");
  const verifiedBy = arrayAt(object.verifiedBy, "evidence.verifiedBy").map((entry, index) =>
    agent(entry, `evidence.verifiedBy[${index}]`),
  );
  if (status === "SELF_REPORTED" && verifiedBy.length > 0) {
    fail("evidence.verifiedBy", "must be empty for SELF_REPORTED evidence");
  }
  if (["HARNESS_VERIFIED", "INDEPENDENTLY_VALIDATED"].includes(status) && verifiedBy.length === 0) {
    fail("evidence.verifiedBy", `${status} requires at least one verifier`);
  }
  if (status === "INDEPENDENTLY_VALIDATED") {
    const validators = verifiedBy.filter((entry) => entry.role === "VALIDATION");
    if (validators.length === 0) fail("evidence.verifiedBy", "requires a VALIDATION agent");
    if (validators.some((entry) => entry.agent_id === collectedBy.agent_id)) {
      fail("evidence.verifiedBy", "independent validator must differ from the collecting agent");
    }
  }
  const supersedes = sameLogicalSupersedes(object.supersedes, evidenceId, "evidence.supersedes");
  return sealRecord(
    {
      schema: "hpi/wire/evidence/v2",
      evidence_id: evidenceId,
      task_ref: frozenRef(object.taskRef, "evidence.taskRef"),
      attempt_id: nonEmpty(object.attemptId, "evidence.attemptId"),
      kind: enumValue(object.kind, EVIDENCE_KINDS, "evidence.kind"),
      pointer: nonEmpty(object.pointer, "evidence.pointer"),
      sha256: ensureSha(object.sha256, "evidence.sha256"),
      status,
      claim_refs: strings(object.claimRefs, "evidence.claimRefs").sort(),
      collected_by: collectedBy,
      verified_by: verifiedBy.toSorted((left, right) => left.agent_id.localeCompare(right.agent_id)),
      limitations: strings(object.limitations, "evidence.limitations"),
      sensitivity: enumValue(object.sensitivity, SENSITIVITIES, "evidence.sensitivity"),
      ...(supersedes === undefined ? {} : { supersedes }),
      changed_fields: changedFields(object.changedFields, "evidence.changedFields", supersedes),
      provenance_refs: frozenRefs(object.provenanceRefs, "evidence.provenanceRefs", { min: 1 }),
      created_at: timestamp(object.createdAt, "evidence.createdAt"),
    },
    "evidence_revision",
  );
}

export function toWireResultBundle(value) {
  const object = exactKeys(
    value,
    [
      "resultBundleId",
      "taskRef",
      "handoffRef",
      "attemptRecord",
      "generatedBy",
      "submittedAt",
      "machineResult",
      "evidenceRecords",
      "outputRefs",
      "failure",
      "unresolved",
      "nextAttempt",
      "supersedes",
      "changedFields",
      "provenanceRefs",
    ],
    [
      "resultBundleId",
      "taskRef",
      "handoffRef",
      "attemptRecord",
      "generatedBy",
      "submittedAt",
      "machineResult",
      "evidenceRecords",
      "outputRefs",
      "failure",
      "unresolved",
      "nextAttempt",
      "changedFields",
      "provenanceRefs",
    ],
    "resultBundle",
  );
  const resultBundleId = nonEmpty(object.resultBundleId, "resultBundle.resultBundleId");
  const taskRef = frozenRef(object.taskRef, "resultBundle.taskRef");
  const handoffRef = frozenRef(object.handoffRef, "resultBundle.handoffRef");
  const attemptRecord = object.attemptRecord;
  if (attemptRecord?.schema !== "hpi/wire/attempt/v2") {
    fail("resultBundle.attemptRecord.schema", "must be a sealed Attempt v2 record");
  }
  assertWireRecordRevision(attemptRecord, "attempt_revision", "resultBundle.attemptRecord");
  for (const [name, expected, actual] of [
    ["task_ref", taskRef, attemptRecord.task_ref],
    ["handoff_ref", handoffRef, attemptRecord.handoff_ref],
  ]) {
    if (
      expected.id !== actual?.id ||
      expected.revision !== actual?.revision ||
      expected.sha256 !== actual?.sha256
    ) {
      fail(`resultBundle.attemptRecord.${name}`, `must equal ResultBundle ${name}`);
    }
  }
  const attemptRef = wireRecordRef(attemptRecord, {
    idKey: "attempt_id",
    revisionKey: "attempt_revision",
  });
  const machineResult = toWireMachineResult(object.machineResult);
  if (machineResult.task_id !== taskRef.id) fail("resultBundle.machineResult.task_id", "must match task_ref.id");
  if (machineResult.attempt_id !== attemptRef.id) fail("resultBundle.machineResult.attempt_id", "must match attempt_ref.id");
  if (machineResult.verdict === "PASS-ENGINEERING" && attemptRecord.status !== "RUNNING") {
    fail(
      "resultBundle.attemptRecord.status",
      "PASS-ENGINEERING must reference the frozen RUNNING snapshot; terminalize the Attempt in a later revision",
    );
  }
  const evidenceRecords = arrayAt(object.evidenceRecords, "resultBundle.evidenceRecords")
    .map((entry, index) => {
      const path = `resultBundle.evidenceRecords[${index}]`;
      if (entry?.schema !== "hpi/wire/evidence/v2") {
        fail(`${path}.schema`, "must be a sealed Evidence v2 record");
      }
      assertWireRecordRevision(entry, "evidence_revision", path);
      if (!sameFrozenIdentity(entry.task_ref, taskRef, `${path}.task_ref`)) {
        fail(`${path}.task_ref`, "must exactly match task_ref id, revision, and sha256");
      }
      if (entry.attempt_id !== attemptRef.id) {
        fail(`${path}.attempt_id`, "must match attempt_ref.id");
      }
      return structuredClone(entry);
    })
    .toSorted((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  const evidenceIds = new Set();
  const evidenceByIdentity = new Map();
  for (const [index, record] of evidenceRecords.entries()) {
    if (evidenceIds.has(record.evidence_id)) {
      fail(
        `resultBundle.evidenceRecords[${index}].evidence_id`,
        "must be unique inside one ResultBundle; multiple revisions are ambiguous",
      );
    }
    evidenceIds.add(record.evidence_id);
    const recordRef = wireRecordRef(record, {
      idKey: "evidence_id",
      revisionKey: "evidence_revision",
    });
    evidenceByIdentity.set(frozenIdentityKey(recordRef), record);
  }
  const trustedStatuses = new Set(["HARNESS_VERIFIED", "INDEPENDENTLY_VALIDATED"]);
  for (const [factIndex, fact] of machineResult.facts.entries()) {
    let hasTrustedEvidence = false;
    for (const [refIndex, ref] of fact.evidence_refs.entries()) {
      const path = `resultBundle.machineResult.facts[${factIndex}].evidence_refs[${refIndex}]`;
      const record = evidenceByIdentity.get(frozenIdentityKey(ref, path));
      if (!record) {
        fail(path, "must exactly resolve to a carried Evidence id, revision, and sha256");
      }
      if (!record.claim_refs.includes(fact.fact_id)) {
        fail(
          path,
          `resolved Evidence claim_refs must include the referenced fact_id ${fact.fact_id}`,
        );
      }
      if (trustedStatuses.has(record.status)) hasTrustedEvidence = true;
    }
    if (
      machineResult.verdict === "PASS-ENGINEERING" &&
      fact.status === "VERIFIED" &&
      !hasTrustedEvidence
    ) {
      fail(
        `resultBundle.machineResult.facts[${factIndex}].evidence_refs`,
        "a VERIFIED PASS fact must directly reference harness-verified or independently validated Evidence",
      );
    }
  }
  const failureRecord = failure(object.failure, "resultBundle.failure");
  if (machineResult.verdict === "PASS-ENGINEERING" && failureRecord.kind !== "NONE") {
    fail("resultBundle.failure", "must be NONE for PASS-ENGINEERING");
  }
  if (machineResult.verdict === "PASS-ENGINEERING" && failureRecord.retryable) {
    fail("resultBundle.failure.retryable", "must be false for PASS-ENGINEERING");
  }
  const supersedes = sameLogicalSupersedes(object.supersedes, resultBundleId, "resultBundle.supersedes");
  const semantic = {
    result_bundle_id: resultBundleId,
    task_ref: taskRef,
    handoff_ref: handoffRef,
    attempt_ref: attemptRef,
    generated_by: agent(object.generatedBy, "resultBundle.generatedBy"),
    machine_result: machineResult,
    evidence: evidenceRecords,
    output_refs: frozenRefs(object.outputRefs, "resultBundle.outputRefs"),
    failure: failureRecord,
    unresolved: strings(object.unresolved, "resultBundle.unresolved"),
    next_attempt: nextAttempt(object.nextAttempt, "resultBundle.nextAttempt"),
  };
  return sealRecord(
    {
      schema: "hpi/wire/result-bundle/v2",
      ...semantic,
      idempotency_key: idempotencyKey("result-bundle", {
        task_ref: taskRef,
        handoff_ref: handoffRef,
        attempt_ref: attemptRef,
      }),
      submitted_at: timestamp(object.submittedAt, "resultBundle.submittedAt"),
      submission_authority: "CANDIDATE_ONLY_NOT_PROJECT_CANONICAL",
      ...(supersedes === undefined ? {} : { supersedes }),
      changed_fields: changedFields(object.changedFields, "resultBundle.changedFields", supersedes),
      provenance_refs: frozenRefs(object.provenanceRefs, "resultBundle.provenanceRefs", { min: 1 }),
    },
    "bundle_revision",
  );
}

