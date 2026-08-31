import { createHash } from "node:crypto";

import { sha256 } from "../contracts.mjs";
import {
  ExecutionContractError,
  arrayAt,
  ensureSha,
  enumValue,
  exactKeys,
  frozenIdentityKey,
  frozenRef,
  frozenRefs,
  nonEmpty,
  timestamp,
} from "../execution/contract.mjs";
import {
  EXECUTION_WIRE_SCHEMA_SET,
  EXECUTION_WIRE_SCHEMA_SET_DIGEST,
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
} from "../wire-schema.mjs";

export const VALIDATION_RUNTIME_VERSION = "hpi-validation-runtime/0.1.0";
export const VALIDATION_ATTEMPT_INPUT_SCHEMA = "hpi/validation-attempt-input/v1";
export const VALIDATION_ATTEMPT_RECORD_SCHEMA = "hpi/validation-attempt-record/v1";
export const VALIDATION_ATTEMPT_INPUT_WIRE_SCHEMA = "hpi/wire/validation-attempt-input/v1";
export const VALIDATION_ATTEMPT_RECORD_WIRE_SCHEMA = "hpi/wire/validation-attempt-record/v1";
export const VALIDATION_ATTEMPT_FAMILY = "TS001_VALIDATION_RUNTIME_V1";
export const VALIDATION_PROJECT_ID = "HPI-TS001-PILOT";
export const VALIDATION_ADAPTER = Object.freeze({ id: "ts001-pilot", version: "0.1.0" });
export const VALIDATION_STORE_PREFIX = ".pi/artifacts/hpi-validation/v1";
export const VALIDATION_PHASES = Object.freeze(["DECLARED", "ACCEPTED", "RUNNING", "TERMINAL"]);
export const VALIDATION_OUTCOMES = Object.freeze([
  "NONE",
  "MACHINE_RESULT_PRODUCED",
  "INPUT_REJECTED",
  "INCOMPLETE_INTERRUPTED",
  "BLOCKED_CONFLICT",
]);
export const VALIDATION_GATES = Object.freeze([
  "V1_SCHEMA",
  "V1_IDENTITY",
  "V1_REFERENCE",
  "V1_WORKSPACE",
  "V1_AUTHORITY",
]);
export const VALIDATION_GATE_STATUSES = Object.freeze(["PASSED", "FAILED", "NOT_RUN"]);
export const VALIDATION_AUTHORITY = Object.freeze({
  mode: "MACHINE_VALIDATION_ONLY",
  projectCanonicalWrite: "FORBIDDEN",
  projectSemanticStateWrite: "FORBIDDEN",
  humanResultIntake: "FORBIDDEN",
  candidateEventIntake: "FORBIDDEN",
  agentDispatch: "FORBIDDEN",
  automaticCanonicalInvalidation: "FORBIDDEN",
  network: "DENY",
});

const ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const WINDOWS_DRIVE = /^[A-Za-z]:/u;

export class ValidationRuntimeContractError extends Error {
  constructor(path, message, details = {}) {
    super(`${path}: ${message}`);
    this.name = "ValidationRuntimeContractError";
    this.path = path;
    this.details = details;
  }
}

function fail(path, message, details) {
  throw new ValidationRuntimeContractError(path, message, details);
}

export function sha256Bytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    fail("bytes", "must be a Buffer or Uint8Array");
  }
  return createHash("sha256").update(value).digest("hex");
}

function wrapExecution(path, fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ExecutionContractError) {
      fail(path, error.message, { cause: error });
    }
    throw error;
  }
}

export function validationAttemptId(value, path = "validationAttemptId") {
  nonEmpty(value, path);
  if (!ATTEMPT_ID.test(value)) {
    fail(path, "must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$");
  }
  return value;
}

export function validationScopedPath(value, path = "path") {
  nonEmpty(value, path);
  if (
    value.startsWith("/") ||
    WINDOWS_DRIVE.test(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(path, "must use a host-independent POSIX project-relative path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(path, "must not contain empty, '.', or '..' path segments");
  }
  return value;
}

function exactStrings(value, path, { min = 0 } = {}) {
  const values = arrayAt(value, path).map((entry, index) => nonEmpty(entry, `${path}[${index}]`));
  if (values.length < min) fail(path, `must contain at least ${min} item(s)`);
  if (new Set(values).size !== values.length) fail(path, "must not contain duplicates");
  return values;
}

export function validationAuthority(value, path = "authority") {
  const object = exactKeys(
    value,
    [
      "mode",
      "projectCanonicalWrite",
      "projectSemanticStateWrite",
      "humanResultIntake",
      "candidateEventIntake",
      "agentDispatch",
      "automaticCanonicalInvalidation",
      "network",
    ],
    [
      "mode",
      "projectCanonicalWrite",
      "projectSemanticStateWrite",
      "humanResultIntake",
      "candidateEventIntake",
      "agentDispatch",
      "automaticCanonicalInvalidation",
      "network",
    ],
    path,
  );
  for (const [key, expected] of Object.entries(VALIDATION_AUTHORITY)) {
    if (object[key] !== expected) fail(`${path}.${key}`, `must equal ${expected}`);
  }
  return { ...VALIDATION_AUTHORITY };
}

function schemaSetRef(value, path, expectedSet, expectedDigest) {
  const object = exactKeys(
    value,
    ["schemaSet", "schemaSetDigest"],
    ["schemaSet", "schemaSetDigest"],
    path,
  );
  if (object.schemaSet !== expectedSet) fail(`${path}.schemaSet`, `must equal ${expectedSet}`);
  if (object.schemaSetDigest !== expectedDigest) {
    fail(`${path}.schemaSetDigest`, `must equal ${expectedDigest}`);
  }
  return { schemaSet: expectedSet, schemaSetDigest: expectedDigest };
}

export function validationRuntimeIdentity(value, path = "runtime") {
  const object = exactKeys(
    value,
    ["runtimeId", "runtimeVersion", "schemaSet", "schemaSetDigest"],
    ["runtimeId", "runtimeVersion", "schemaSet", "schemaSetDigest"],
    path,
  );
  if (object.runtimeId !== "hpi-validation-runtime") {
    fail(`${path}.runtimeId`, "must equal hpi-validation-runtime");
  }
  if (object.runtimeVersion !== VALIDATION_RUNTIME_VERSION.split("/").at(-1)) {
    fail(`${path}.runtimeVersion`, `must equal ${VALIDATION_RUNTIME_VERSION.split("/").at(-1)}`);
  }
  const schema = schemaSetRef(
    { schemaSet: object.schemaSet, schemaSetDigest: object.schemaSetDigest },
    path,
    VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
    VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
  );
  return {
    runtimeId: "hpi-validation-runtime",
    runtimeVersion: VALIDATION_RUNTIME_VERSION.split("/").at(-1),
    ...schema,
  };
}

function refsWithPointers(value, path, { min = 0 } = {}) {
  const refs = wrapExecution(path, () => frozenRefs(value, path, { min }));
  refs.forEach((ref, index) => {
    if (!ref.pointer) fail(`${path}[${index}].pointer`, "is required for validation-runtime input");
    validationScopedPath(ref.pointer, `${path}[${index}].pointer`);
  });
  return refs;
}

function adapter(value, path) {
  const object = exactKeys(value, ["id", "version"], ["id", "version"], path);
  if (object.id !== VALIDATION_ADAPTER.id) fail(`${path}.id`, `must equal ${VALIDATION_ADAPTER.id}`);
  if (object.version !== VALIDATION_ADAPTER.version) {
    fail(`${path}.version`, `must equal ${VALIDATION_ADAPTER.version}`);
  }
  return { ...VALIDATION_ADAPTER };
}

function sortedUniquePointers(refs) {
  return [...new Set(refs.map((ref) => ref.pointer))].sort();
}

export function validationRetryAttemptId(ref, currentAttemptId, path = "retryOf") {
  if (!ref?.pointer) fail(`${path}.pointer`, "is required so retry history can be resolved deterministically");
  validationScopedPath(ref.pointer, `${path}.pointer`);
  const prefix = `${VALIDATION_STORE_PREFIX}/`;
  if (!ref.pointer.startsWith(prefix)) {
    fail(`${path}.pointer`, `must begin with ${prefix}`);
  }
  const remainder = ref.pointer.slice(prefix.length).split("/");
  if (remainder.length !== 3 || remainder[1] !== "records") {
    fail(`${path}.pointer`, "must point to one immutable prior-attempt record");
  }
  const priorAttemptId = validationAttemptId(remainder[0], `${path}.pointer.attemptId`);
  if (priorAttemptId === currentAttemptId) {
    fail(`${path}.pointer`, "must reference a distinct prior attempt");
  }
  const match = /^(\d{6})-([a-f0-9]{64})\.json$/u.exec(remainder[2]);
  if (!match || match[2] !== ref.revision || ref.sha256 !== ref.revision) {
    fail(`${path}.pointer`, "filename and frozen identity must bind the same prior record revision");
  }
  return priorAttemptId;
}

export function computeValidationInputDigest(input) {
  return sha256({
    schema: VALIDATION_ATTEMPT_INPUT_SCHEMA,
    validationAttemptId: input.validationAttemptId,
    attemptFamily: input.attemptFamily,
    projectId: input.projectId,
    adapter: input.adapter,
    taskRef: input.taskRef,
    contractRefs: input.contractRefs,
    inputRefs: input.inputRefs,
    declaredReadSet: input.declaredReadSet,
    isolatedWriteRoot: input.isolatedWriteRoot,
    executionContract: input.executionContract,
    validationContract: input.validationContract,
    authority: input.authority,
  });
}

export function validateValidationAttemptInput(value, path = "validationAttemptInput") {
  const object = exactKeys(
    value,
    [
      "schema",
      "validationAttemptId",
      "attemptFamily",
      "projectId",
      "adapter",
      "taskRef",
      "contractRefs",
      "inputRefs",
      "declaredReadSet",
      "isolatedWriteRoot",
      "inputDigest",
      "inputRevision",
      "executionContract",
      "validationContract",
      "authority",
      "retryOf",
      "declaredAt",
    ],
    [
      "schema",
      "validationAttemptId",
      "attemptFamily",
      "projectId",
      "adapter",
      "taskRef",
      "contractRefs",
      "inputRefs",
      "declaredReadSet",
      "isolatedWriteRoot",
      "inputDigest",
      "inputRevision",
      "executionContract",
      "validationContract",
      "authority",
      "declaredAt",
    ],
    path,
  );
  if (object.schema !== VALIDATION_ATTEMPT_INPUT_SCHEMA) {
    fail(`${path}.schema`, `must equal ${VALIDATION_ATTEMPT_INPUT_SCHEMA}`);
  }
  const attemptId = validationAttemptId(object.validationAttemptId, `${path}.validationAttemptId`);
  if (object.attemptFamily !== VALIDATION_ATTEMPT_FAMILY) {
    fail(`${path}.attemptFamily`, `must equal ${VALIDATION_ATTEMPT_FAMILY}`);
  }
  if (object.projectId !== VALIDATION_PROJECT_ID) {
    fail(`${path}.projectId`, `must equal ${VALIDATION_PROJECT_ID}`);
  }
  const normalizedAdapter = adapter(object.adapter, `${path}.adapter`);
  const taskRef = refsWithPointers([object.taskRef], `${path}.taskRef`, { min: 1 })[0];
  const contractRefs = refsWithPointers(object.contractRefs, `${path}.contractRefs`, { min: 1 });
  const inputRefs = refsWithPointers(object.inputRefs, `${path}.inputRefs`, { min: 1 });
  const declaredReadSet = exactStrings(object.declaredReadSet, `${path}.declaredReadSet`, { min: 1 })
    .map((pointer, index) => validationScopedPath(pointer, `${path}.declaredReadSet[${index}]`))
    .sort();
  const allRefs = [taskRef, ...contractRefs, ...inputRefs];
  const allIdentityKeys = allRefs.map((ref) => frozenIdentityKey(ref));
  if (new Set(allIdentityKeys).size !== allIdentityKeys.length) {
    fail(path, "Task, contract, and input refs must be globally identity-unique");
  }
  const expectedReadSet = sortedUniquePointers(allRefs);
  if (expectedReadSet.length !== allRefs.length) {
    fail(path, "Task, contract, and input refs must use distinct pointers");
  }
  if (JSON.stringify(declaredReadSet) !== JSON.stringify(expectedReadSet)) {
    fail(`${path}.declaredReadSet`, "must exactly equal the unique Task/contract/input ref pointers", {
      expected: expectedReadSet,
      actual: declaredReadSet,
    });
  }
  const isolatedWriteRoot = validationScopedPath(object.isolatedWriteRoot, `${path}.isolatedWriteRoot`);
  const expectedWriteRoot = `${VALIDATION_STORE_PREFIX}/${attemptId}`;
  if (isolatedWriteRoot !== expectedWriteRoot) {
    fail(`${path}.isolatedWriteRoot`, `must equal ${expectedWriteRoot}`);
  }
  const executionContract = schemaSetRef(
    object.executionContract,
    `${path}.executionContract`,
    EXECUTION_WIRE_SCHEMA_SET,
    EXECUTION_WIRE_SCHEMA_SET_DIGEST,
  );
  const validationContract = schemaSetRef(
    object.validationContract,
    `${path}.validationContract`,
    VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
    VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
  );
  const authority = validationAuthority(object.authority, `${path}.authority`);
  const inputRevision = ensureSha(object.inputRevision, `${path}.inputRevision`);
  const retryOf = object.retryOf === undefined
    ? undefined
    : wrapExecution(`${path}.retryOf`, () => frozenRef(object.retryOf, `${path}.retryOf`));
  if (retryOf !== undefined) validationRetryAttemptId(retryOf, attemptId, `${path}.retryOf`);
  timestamp(object.declaredAt, `${path}.declaredAt`);
  const normalized = {
    schema: VALIDATION_ATTEMPT_INPUT_SCHEMA,
    validationAttemptId: attemptId,
    attemptFamily: VALIDATION_ATTEMPT_FAMILY,
    projectId: VALIDATION_PROJECT_ID,
    adapter: normalizedAdapter,
    taskRef,
    contractRefs,
    inputRefs,
    declaredReadSet,
    isolatedWriteRoot,
    inputDigest: ensureSha(object.inputDigest, `${path}.inputDigest`),
    inputRevision,
    executionContract,
    validationContract,
    authority,
    ...(retryOf === undefined ? {} : { retryOf }),
    declaredAt: object.declaredAt,
  };
  const expectedDigest = computeValidationInputDigest(normalized);
  if (normalized.inputDigest !== expectedDigest) {
    fail(`${path}.inputDigest`, "does not match the frozen validation input identity", {
      expected: expectedDigest,
      actual: normalized.inputDigest,
    });
  }
  return normalized;
}

function gateOutcome(value, path) {
  const object = exactKeys(
    value,
    ["gate", "status", "code", "evidenceRefs"],
    ["gate", "status", "code", "evidenceRefs"],
    path,
  );
  const gate = enumValue(object.gate, VALIDATION_GATES, `${path}.gate`);
  const status = enumValue(object.status, VALIDATION_GATE_STATUSES, `${path}.status`);
  const code = nonEmpty(object.code, `${path}.code`);
  const evidenceRefs = wrapExecution(path, () => frozenRefs(object.evidenceRefs, `${path}.evidenceRefs`));
  if (status === "PASSED" && evidenceRefs.length === 0) {
    fail(`${path}.evidenceRefs`, "PASSED Gate outcomes require immutable evidence");
  }
  if (status === "NOT_RUN" && evidenceRefs.length > 0) {
    fail(`${path}.evidenceRefs`, "NOT_RUN Gate outcomes must not claim evidence");
  }
  return { gate, status, code, evidenceRefs };
}

function requireAttemptStorePointer(ref, attemptId, area, path) {
  if (!ref.pointer) fail(`${path}.pointer`, "is required for validation attempt history");
  validationScopedPath(ref.pointer, `${path}.pointer`);
  const prefix = `${VALIDATION_STORE_PREFIX}/${attemptId}/${area}/`;
  if (!ref.pointer.startsWith(prefix)) fail(`${path}.pointer`, `must begin with ${prefix}`);
  return ref.pointer.slice(prefix.length);
}

function validateGatePhaseSemantics(phase, outcome, gateOutcomes, path) {
  const gates = gateOutcomes.map((entry) => entry.gate);
  if (JSON.stringify(gates) !== JSON.stringify(VALIDATION_GATES)) {
    fail(path, `must contain all V1 Gates once in canonical order: ${VALIDATION_GATES.join(", ")}`);
  }
  const statuses = gateOutcomes.map((entry) => entry.status);
  if (phase === "DECLARED") {
    if (statuses[0] !== "PASSED" || statuses.slice(1).some((status) => status !== "NOT_RUN")) {
      fail(path, "DECLARED must record V1_SCHEMA PASSED and every later Gate NOT_RUN");
    }
    return;
  }
  if (phase === "ACCEPTED" || phase === "RUNNING") {
    if (statuses.some((status) => status !== "PASSED")) {
      fail(path, `${phase} requires every V1 Gate to be PASSED`);
    }
    return;
  }
  const firstFailure = statuses.indexOf("FAILED");
  const allPassed = statuses.every((status) => status === "PASSED");
  const failedThenNotRun = firstFailure >= 0 &&
    statuses.slice(0, firstFailure).every((status) => status === "PASSED") &&
    statuses.slice(firstFailure + 1).every((status) => status === "NOT_RUN");
  if (outcome === "INPUT_REJECTED" || outcome === "BLOCKED_CONFLICT") {
    if (!failedThenNotRun) fail(path, `${outcome} requires one FAILED Gate followed only by NOT_RUN`);
  } else if (!allPassed && !failedThenNotRun) {
    fail(path, "terminal Gate outcomes must be all PASSED or one FAILED followed only by NOT_RUN");
  }
}

export function validateValidationAttemptRecord(value, path = "validationAttemptRecord") {
  const object = exactKeys(
    value,
    [
      "schema",
      "recordId",
      "recordRevision",
      "validationAttemptId",
      "sequence",
      "phase",
      "outcome",
      "inputRef",
      "runtime",
      "authority",
      "gateOutcomes",
      "machineResultRef",
      "previousRecordRef",
      "recordedAt",
    ],
    [
      "schema",
      "recordId",
      "recordRevision",
      "validationAttemptId",
      "sequence",
      "phase",
      "outcome",
      "inputRef",
      "runtime",
      "authority",
      "gateOutcomes",
      "recordedAt",
    ],
    path,
  );
  if (object.schema !== VALIDATION_ATTEMPT_RECORD_SCHEMA) {
    fail(`${path}.schema`, `must equal ${VALIDATION_ATTEMPT_RECORD_SCHEMA}`);
  }
  nonEmpty(object.recordId, `${path}.recordId`);
  ensureSha(object.recordRevision, `${path}.recordRevision`);
  const attemptId = validationAttemptId(object.validationAttemptId, `${path}.validationAttemptId`);
  if (!Number.isSafeInteger(object.sequence) || object.sequence < 0 || object.sequence > 999_999) {
    fail(`${path}.sequence`, "must be a safe integer between 0 and 999999");
  }
  const expectedRecordId = `VRR-${attemptId}-${object.sequence}`;
  if (object.recordId !== expectedRecordId) {
    fail(`${path}.recordId`, `must equal ${expectedRecordId}`);
  }
  const phase = enumValue(object.phase, VALIDATION_PHASES, `${path}.phase`);
  const outcome = enumValue(object.outcome, VALIDATION_OUTCOMES, `${path}.outcome`);
  if (phase === "TERMINAL" && outcome === "NONE") fail(`${path}.outcome`, "terminal records require an outcome");
  if (phase !== "TERMINAL" && outcome !== "NONE") fail(`${path}.outcome`, "non-terminal records require NONE");
  const inputRef = wrapExecution(`${path}.inputRef`, () => frozenRef(object.inputRef, `${path}.inputRef`));
  if (inputRef.id !== attemptId) fail(`${path}.inputRef.id`, `must equal ${attemptId}`);
  const inputName = requireAttemptStorePointer(inputRef, attemptId, "input", `${path}.inputRef`);
  if (inputName !== `manifest-${inputRef.sha256}.json`) {
    fail(`${path}.inputRef.pointer`, "must bind the raw-byte manifest digest in its filename");
  }
  const runtime = validationRuntimeIdentity(object.runtime, `${path}.runtime`);
  const authority = validationAuthority(object.authority, `${path}.authority`);
  const gateOutcomes = arrayAt(object.gateOutcomes, `${path}.gateOutcomes`).map((entry, index) =>
    gateOutcome(entry, `${path}.gateOutcomes[${index}]`),
  );
  const gates = gateOutcomes.map((entry) => entry.gate);
  if (new Set(gates).size !== gates.length) fail(`${path}.gateOutcomes`, "must not repeat a Gate");
  validateGatePhaseSemantics(phase, outcome, gateOutcomes, `${path}.gateOutcomes`);
  const machineResultRef = object.machineResultRef === undefined
    ? undefined
    : wrapExecution(`${path}.machineResultRef`, () =>
        frozenRef(object.machineResultRef, `${path}.machineResultRef`),
      );
  if (outcome === "MACHINE_RESULT_PRODUCED" && machineResultRef === undefined) {
    fail(`${path}.machineResultRef`, "is required for MACHINE_RESULT_PRODUCED");
  }
  if (outcome !== "MACHINE_RESULT_PRODUCED" && machineResultRef !== undefined) {
    fail(`${path}.machineResultRef`, "is only allowed for MACHINE_RESULT_PRODUCED");
  }
  if (machineResultRef !== undefined) {
    if (machineResultRef.id !== `MR-VRS1-${attemptId}`) {
      fail(`${path}.machineResultRef.id`, `must equal MR-VRS1-${attemptId}`);
    }
    const resultName = requireAttemptStorePointer(
      machineResultRef,
      attemptId,
      "machine-results",
      `${path}.machineResultRef`,
    );
    if (
      machineResultRef.sha256 !== machineResultRef.revision ||
      resultName !== `${machineResultRef.id}-${machineResultRef.revision}.json`
    ) {
      fail(`${path}.machineResultRef`, "must bind one immutable machine-result filename and revision");
    }
  }
  const previousRecordRef = object.previousRecordRef === undefined
    ? undefined
    : wrapExecution(`${path}.previousRecordRef`, () =>
        frozenRef(object.previousRecordRef, `${path}.previousRecordRef`),
      );
  if (object.sequence === 0 && previousRecordRef !== undefined) {
    fail(`${path}.previousRecordRef`, "must be absent for sequence 0");
  }
  if (object.sequence > 0 && previousRecordRef === undefined) {
    fail(`${path}.previousRecordRef`, "is required after sequence 0");
  }
  if (previousRecordRef !== undefined) {
    const previousSequence = object.sequence - 1;
    if (previousRecordRef.id !== `VRR-${attemptId}-${previousSequence}`) {
      fail(`${path}.previousRecordRef.id`, `must equal VRR-${attemptId}-${previousSequence}`);
    }
    const previousName = requireAttemptStorePointer(
      previousRecordRef,
      attemptId,
      "records",
      `${path}.previousRecordRef`,
    );
    if (
      previousRecordRef.sha256 !== previousRecordRef.revision ||
      previousName !== `${String(previousSequence).padStart(6, "0")}-${previousRecordRef.revision}.json`
    ) {
      fail(`${path}.previousRecordRef`, "must bind the immediately prior immutable record filename");
    }
  }
  timestamp(object.recordedAt, `${path}.recordedAt`);
  return {
    schema: VALIDATION_ATTEMPT_RECORD_SCHEMA,
    recordId: object.recordId,
    recordRevision: object.recordRevision,
    validationAttemptId: attemptId,
    sequence: object.sequence,
    phase,
    outcome,
    inputRef,
    runtime,
    authority,
    gateOutcomes,
    ...(machineResultRef === undefined ? {} : { machineResultRef }),
    ...(previousRecordRef === undefined ? {} : { previousRecordRef }),
    recordedAt: object.recordedAt,
  };
}

function recordRef(record) {
  return {
    id: record.recordId,
    revision: record.recordRevision,
    sha256: record.recordRevision,
  };
}

export function validateValidationRecordChain(value, path = "records") {
  const records = arrayAt(value, path).map((record, index) =>
    validateValidationAttemptRecord(record, `${path}[${index}]`),
  );
  if (records.length === 0) return records;
  const sorted = [...records].sort((left, right) => left.sequence - right.sequence);
  const attemptId = sorted[0].validationAttemptId;
  const inputKey = frozenIdentityKey(sorted[0].inputRef);
  let terminal = false;
  for (const [index, record] of sorted.entries()) {
    if (record.sequence !== index) fail(`${path}[${index}].sequence`, `must equal ${index}`);
    if (record.validationAttemptId !== attemptId) {
      fail(`${path}[${index}].validationAttemptId`, `must equal ${attemptId}`);
    }
    if (frozenIdentityKey(record.inputRef) !== inputKey) {
      fail(`${path}[${index}].inputRef`, "must remain identical across one attempt");
    }
    if (terminal) fail(`${path}[${index}]`, "must not follow a terminal record");
    if (index === 0) {
      if (record.phase !== "DECLARED") fail(`${path}[0].phase`, "must begin at DECLARED");
    } else {
      const previous = sorted[index - 1];
      if (frozenIdentityKey(record.previousRecordRef) !== frozenIdentityKey(recordRef(previous))) {
        fail(`${path}[${index}].previousRecordRef`, "must exactly reference the prior record");
      }
      const transition = `${previous.phase}->${record.phase}`;
      const allowed = new Set([
        "DECLARED->ACCEPTED",
        "DECLARED->TERMINAL",
        "ACCEPTED->RUNNING",
        "RUNNING->TERMINAL",
      ]);
      if (!allowed.has(transition)) fail(`${path}[${index}].phase`, `invalid transition ${transition}`);
      if (
        transition === "DECLARED->TERMINAL" &&
        !["INPUT_REJECTED", "BLOCKED_CONFLICT"].includes(record.outcome)
      ) {
        fail(`${path}[${index}].outcome`, "DECLARED may terminate only as INPUT_REJECTED or BLOCKED_CONFLICT");
      }
      if (
        transition === "RUNNING->TERMINAL" &&
        !["MACHINE_RESULT_PRODUCED", "INCOMPLETE_INTERRUPTED"].includes(record.outcome)
      ) {
        fail(`${path}[${index}].outcome`, "RUNNING may terminate only with a produced result or explicit interruption");
      }
      if (Date.parse(record.recordedAt) < Date.parse(previous.recordedAt)) {
        fail(`${path}[${index}].recordedAt`, "must not precede the prior immutable record");
      }
    }
    if (record.phase === "TERMINAL") terminal = true;
  }
  return sorted;
}
