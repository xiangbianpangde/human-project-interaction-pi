import {
  assertWireRecordRevision,
  exactKeys,
  frozenIdentityKey,
  sealRecord,
} from "../execution/contract.mjs";
import {
  VALIDATION_ATTEMPT_INPUT_SCHEMA,
  VALIDATION_ATTEMPT_INPUT_WIRE_SCHEMA,
  VALIDATION_ATTEMPT_RECORD_SCHEMA,
  VALIDATION_ATTEMPT_RECORD_WIRE_SCHEMA,
  computeValidationInputDigest,
  validateValidationAttemptInput,
  validateValidationAttemptRecord,
} from "./contract.mjs";

export const VALIDATION_RUNTIME_CODEC_VERSION = "hpi-validation-runtime-codec/0.1.0";

function toWireRef(ref) {
  return {
    id: ref.id,
    revision: ref.revision,
    sha256: ref.sha256,
    ...(ref.pointer === undefined ? {} : { pointer: ref.pointer }),
  };
}

function fromWireRef(ref) {
  return {
    id: ref.id,
    revision: ref.revision,
    sha256: ref.sha256,
    ...(ref.pointer === undefined ? {} : { pointer: ref.pointer }),
  };
}

function toWireAuthority(authority) {
  return {
    mode: authority.mode,
    project_canonical_write: authority.projectCanonicalWrite,
    project_semantic_state_write: authority.projectSemanticStateWrite,
    human_result_intake: authority.humanResultIntake,
    candidate_event_intake: authority.candidateEventIntake,
    agent_dispatch: authority.agentDispatch,
    automatic_canonical_invalidation: authority.automaticCanonicalInvalidation,
    network: authority.network,
  };
}

function fromWireAuthority(authority) {
  exactKeys(
    authority,
    [
      "mode",
      "project_canonical_write",
      "project_semantic_state_write",
      "human_result_intake",
      "candidate_event_intake",
      "agent_dispatch",
      "automatic_canonical_invalidation",
      "network",
    ],
    [
      "mode",
      "project_canonical_write",
      "project_semantic_state_write",
      "human_result_intake",
      "candidate_event_intake",
      "agent_dispatch",
      "automatic_canonical_invalidation",
      "network",
    ],
    "authority",
  );
  return {
    mode: authority.mode,
    projectCanonicalWrite: authority.project_canonical_write,
    projectSemanticStateWrite: authority.project_semantic_state_write,
    humanResultIntake: authority.human_result_intake,
    candidateEventIntake: authority.candidate_event_intake,
    agentDispatch: authority.agent_dispatch,
    automaticCanonicalInvalidation: authority.automatic_canonical_invalidation,
    network: authority.network,
  };
}

function toWireSchemaSetRef(ref) {
  return {
    schema_set: ref.schemaSet,
    schema_set_digest: ref.schemaSetDigest,
  };
}

function fromWireSchemaSetRef(ref, path) {
  exactKeys(ref, ["schema_set", "schema_set_digest"], ["schema_set", "schema_set_digest"], path);
  return { schemaSet: ref.schema_set, schemaSetDigest: ref.schema_set_digest };
}

function toWireRuntime(runtime) {
  return {
    runtime_id: runtime.runtimeId,
    runtime_version: runtime.runtimeVersion,
    schema_set: runtime.schemaSet,
    schema_set_digest: runtime.schemaSetDigest,
  };
}

function fromWireRuntime(runtime) {
  exactKeys(
    runtime,
    ["runtime_id", "runtime_version", "schema_set", "schema_set_digest"],
    ["runtime_id", "runtime_version", "schema_set", "schema_set_digest"],
    "runtime",
  );
  return {
    runtimeId: runtime.runtime_id,
    runtimeVersion: runtime.runtime_version,
    schemaSet: runtime.schema_set,
    schemaSetDigest: runtime.schema_set_digest,
  };
}

function inputWireDraft(input) {
  return {
    schema: VALIDATION_ATTEMPT_INPUT_WIRE_SCHEMA,
    validation_attempt_id: input.validationAttemptId,
    attempt_family: input.attemptFamily,
    project_id: input.projectId,
    adapter: {
      adapter_id: input.adapter.id,
      adapter_version: input.adapter.version,
    },
    task_ref: toWireRef(input.taskRef),
    contract_refs: input.contractRefs.map(toWireRef),
    input_refs: input.inputRefs.map(toWireRef),
    declared_read_set: [...input.declaredReadSet],
    isolated_write_root: input.isolatedWriteRoot,
    input_digest: input.inputDigest,
    execution_contract: toWireSchemaSetRef(input.executionContract),
    validation_contract: toWireSchemaSetRef(input.validationContract),
    authority: toWireAuthority(input.authority),
    ...(input.retryOf === undefined ? {} : { retry_of: toWireRef(input.retryOf) }),
    declared_at: input.declaredAt,
  };
}

export function toWireValidationAttemptInput(value) {
  const normalized = {
    ...value,
    ...(Array.isArray(value.contractRefs)
      ? { contractRefs: value.contractRefs.toSorted((left, right) =>
          frozenIdentityKey(left).localeCompare(frozenIdentityKey(right)),
        ) }
      : {}),
    ...(Array.isArray(value.inputRefs)
      ? { inputRefs: value.inputRefs.toSorted((left, right) =>
          frozenIdentityKey(left).localeCompare(frozenIdentityKey(right)),
        ) }
      : {}),
    ...(Array.isArray(value.declaredReadSet)
      ? { declaredReadSet: value.declaredReadSet.toSorted() }
      : {}),
    schema: VALIDATION_ATTEMPT_INPUT_SCHEMA,
    inputDigest: "0".repeat(64),
    inputRevision: "0".repeat(64),
  };
  normalized.inputDigest = computeValidationInputDigest(normalized);
  validateValidationAttemptInput(normalized);
  const sealed = sealRecord(inputWireDraft(normalized), "input_revision");
  return fromWireValidationAttemptInput(sealed).wire;
}

export function fromWireValidationAttemptInput(value, path = "validationAttemptInput") {
  const object = exactKeys(
    value,
    [
      "schema",
      "validation_attempt_id",
      "attempt_family",
      "project_id",
      "adapter",
      "task_ref",
      "contract_refs",
      "input_refs",
      "declared_read_set",
      "isolated_write_root",
      "input_digest",
      "input_revision",
      "execution_contract",
      "validation_contract",
      "authority",
      "retry_of",
      "declared_at",
    ],
    [
      "schema",
      "validation_attempt_id",
      "attempt_family",
      "project_id",
      "adapter",
      "task_ref",
      "contract_refs",
      "input_refs",
      "declared_read_set",
      "isolated_write_root",
      "input_digest",
      "input_revision",
      "execution_contract",
      "validation_contract",
      "authority",
      "declared_at",
    ],
    path,
  );
  if (object.schema !== VALIDATION_ATTEMPT_INPUT_WIRE_SCHEMA) {
    throw new Error(`${path}.schema must equal ${VALIDATION_ATTEMPT_INPUT_WIRE_SCHEMA}`);
  }
  assertWireRecordRevision(object, "input_revision", path);
  exactKeys(object.adapter, ["adapter_id", "adapter_version"], ["adapter_id", "adapter_version"], `${path}.adapter`);
  const internal = validateValidationAttemptInput({
    schema: VALIDATION_ATTEMPT_INPUT_SCHEMA,
    validationAttemptId: object.validation_attempt_id,
    attemptFamily: object.attempt_family,
    projectId: object.project_id,
    adapter: { id: object.adapter.adapter_id, version: object.adapter.adapter_version },
    taskRef: fromWireRef(object.task_ref),
    contractRefs: object.contract_refs.map(fromWireRef),
    inputRefs: object.input_refs.map(fromWireRef),
    declaredReadSet: [...object.declared_read_set],
    isolatedWriteRoot: object.isolated_write_root,
    inputDigest: object.input_digest,
    inputRevision: object.input_revision,
    executionContract: fromWireSchemaSetRef(object.execution_contract, `${path}.execution_contract`),
    validationContract: fromWireSchemaSetRef(object.validation_contract, `${path}.validation_contract`),
    authority: fromWireAuthority(object.authority),
    ...(object.retry_of === undefined ? {} : { retryOf: fromWireRef(object.retry_of) }),
    declaredAt: object.declared_at,
  }, path);
  return { internal, wire: structuredClone(object) };
}

function recordWireDraft(record) {
  return {
    schema: VALIDATION_ATTEMPT_RECORD_WIRE_SCHEMA,
    record_id: record.recordId,
    validation_attempt_id: record.validationAttemptId,
    sequence: record.sequence,
    phase: record.phase,
    outcome: record.outcome,
    input_ref: toWireRef(record.inputRef),
    runtime: toWireRuntime(record.runtime),
    authority: toWireAuthority(record.authority),
    gate_outcomes: record.gateOutcomes.map((outcome) => ({
      gate: outcome.gate,
      status: outcome.status,
      code: outcome.code,
      evidence_refs: outcome.evidenceRefs.map(toWireRef),
    })),
    ...(record.machineResultRef === undefined
      ? {}
      : { machine_result_ref: toWireRef(record.machineResultRef) }),
    ...(record.previousRecordRef === undefined
      ? {}
      : { previous_record_ref: toWireRef(record.previousRecordRef) }),
    recorded_at: record.recordedAt,
  };
}

export function toWireValidationAttemptRecord(value) {
  const normalized = {
    ...value,
    schema: VALIDATION_ATTEMPT_RECORD_SCHEMA,
    recordRevision: "0".repeat(64),
  };
  validateValidationAttemptRecord(normalized);
  const sealed = sealRecord(recordWireDraft(normalized), "record_revision");
  return fromWireValidationAttemptRecord(sealed).wire;
}

export function fromWireValidationAttemptRecord(value, path = "validationAttemptRecord") {
  const object = exactKeys(
    value,
    [
      "schema",
      "record_id",
      "record_revision",
      "validation_attempt_id",
      "sequence",
      "phase",
      "outcome",
      "input_ref",
      "runtime",
      "authority",
      "gate_outcomes",
      "machine_result_ref",
      "previous_record_ref",
      "recorded_at",
    ],
    [
      "schema",
      "record_id",
      "record_revision",
      "validation_attempt_id",
      "sequence",
      "phase",
      "outcome",
      "input_ref",
      "runtime",
      "authority",
      "gate_outcomes",
      "recorded_at",
    ],
    path,
  );
  if (object.schema !== VALIDATION_ATTEMPT_RECORD_WIRE_SCHEMA) {
    throw new Error(`${path}.schema must equal ${VALIDATION_ATTEMPT_RECORD_WIRE_SCHEMA}`);
  }
  assertWireRecordRevision(object, "record_revision", path);
  const internal = validateValidationAttemptRecord({
    schema: VALIDATION_ATTEMPT_RECORD_SCHEMA,
    recordId: object.record_id,
    recordRevision: object.record_revision,
    validationAttemptId: object.validation_attempt_id,
    sequence: object.sequence,
    phase: object.phase,
    outcome: object.outcome,
    inputRef: fromWireRef(object.input_ref),
    runtime: fromWireRuntime(object.runtime),
    authority: fromWireAuthority(object.authority),
    gateOutcomes: object.gate_outcomes.map((outcome) => ({
      gate: outcome.gate,
      status: outcome.status,
      code: outcome.code,
      evidenceRefs: outcome.evidence_refs.map(fromWireRef),
    })),
    ...(object.machine_result_ref === undefined
      ? {}
      : { machineResultRef: fromWireRef(object.machine_result_ref) }),
    ...(object.previous_record_ref === undefined
      ? {}
      : { previousRecordRef: fromWireRef(object.previous_record_ref) }),
    recordedAt: object.recorded_at,
  }, path);
  return { internal, wire: structuredClone(object) };
}
