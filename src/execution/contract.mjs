import { sha256, validateSourceRef } from "../contracts.mjs";

export const EXECUTION_WIRE_CODEC_VERSION = "hpi-execution-wire-codec/1.0.0";

export const EXECUTION_WIRE_OBJECT_SCHEMAS = Object.freeze({
  task_slice: "urn:hpi:wire:task-slice:v1",
  handoff_bundle: "urn:hpi:wire:handoff-bundle:v1",
  attempt: "urn:hpi:wire:attempt:v1",
  evidence: "urn:hpi:wire:evidence:v1",
  result_bundle: "urn:hpi:wire:result-bundle:v1",
  stale_report: "urn:hpi:wire:stale-report:v1",
});

export const EXECUTION_AGENT_ROLES = Object.freeze([
  "COORDINATOR",
  "IMPLEMENTATION",
  "VALIDATION",
  "RESEARCH",
  "RECONCILER",
]);

export const ATTEMPT_STATUSES = Object.freeze([
  "NOT_STARTED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "INTERRUPTED",
  "CANCELLED",
]);

export const EVIDENCE_STATUSES = Object.freeze([
  "SELF_REPORTED",
  "PRE_HARNESS_CHECKED",
  "HARNESS_VERIFIED",
  "INDEPENDENTLY_VALIDATED",
]);

export const EVIDENCE_KINDS = Object.freeze([
  "COMMAND_LOG",
  "TEST_LOG",
  "ARTIFACT",
  "DIFF",
  "HASH",
  "REFERENCE",
  "PERMISSION",
  "SIDE_EFFECT",
  "OTHER",
]);
export const DATA_CLASSES = Object.freeze(["PUBLIC", "INTERNAL", "SENSITIVE", "RESTRICTED"]);
export const FAILURE_KINDS = Object.freeze([
  "NONE",
  "EXECUTION",
  "SCHEMA",
  "IDENTITY",
  "REFERENCE",
  "PERMISSION",
  "EVIDENCE",
  "DEVIATION",
  "OUT_OF_SCOPE",
  "BLOCKED",
  "INTERRUPTED",
]);
export const SENSITIVITIES = DATA_CLASSES;
export const TERMINAL_ATTEMPT_STATUSES = Object.freeze([
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "INTERRUPTED",
  "CANCELLED",
]);
export const RETRYABLE_ATTEMPT_STATUSES = Object.freeze([
  "FAILED",
  "BLOCKED",
  "INTERRUPTED",
  "CANCELLED",
]);
export const MECHANICAL_STALE_RELATIONS = Object.freeze(["tests", "derives", "uses", "generated_by"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const SCOPED_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/u;

export class ExecutionContractError extends Error {
  constructor(path, message, details = {}) {
    super(`${path}: ${message}`);
    this.name = "ExecutionContractError";
    this.path = path;
    this.details = details;
  }
}

export function fail(path, message, details) {
  throw new ExecutionContractError(path, message, details);
}

export function objectAt(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  return value;
}

export function exactKeys(value, allowed, required, path) {
  const object = objectAt(value, path);
  for (const key of required) {
    if (!(key in object)) fail(`${path}.${key}`, "is required");
  }
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "is not allowed by this contract");
  }
  return object;
}

export function nonEmpty(value, path) {
  if (typeof value !== "string" || value.trim() === "") fail(path, "must be a non-empty string");
  return value;
}

export function timestamp(value, path) {
  nonEmpty(value, path);
  if (Number.isNaN(Date.parse(value))) fail(path, "must be an ISO-compatible timestamp");
  return value;
}

export function enumValue(value, allowed, path) {
  nonEmpty(value, path);
  if (!allowed.includes(value)) fail(path, `must be one of: ${allowed.join(", ")}`);
  return value;
}

export function arrayAt(value, path) {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

export function strings(value, path, { min = 0 } = {}) {
  const output = arrayAt(value, path).map((entry, index) => nonEmpty(entry, `${path}[${index}]`));
  if (output.length < min) fail(path, `must contain at least ${min} item(s)`);
  if (new Set(output).size !== output.length) fail(path, "must not contain duplicates");
  return [...output];
}

export function booleanValue(value, path) {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

export function frozenRef(value, path) {
  validateSourceRef(value, path);
  if (!value.sha256) fail(`${path}.sha256`, "is required for a frozen execution reference");
  return {
    id: value.id,
    revision: value.revision,
    sha256: value.sha256,
    ...(value.pointer === undefined ? {} : { pointer: value.pointer }),
  };
}

export function frozenRefs(value, path, { min = 0, sort = true } = {}) {
  const output = arrayAt(value, path).map((entry, index) => frozenRef(entry, `${path}[${index}]`));
  if (output.length < min) fail(path, `must contain at least ${min} item(s)`);
  const keys = output.map((entry) => `${entry.id}\u0000${entry.revision}\u0000${entry.sha256}`);
  if (new Set(keys).size !== keys.length) fail(path, "must not contain duplicate frozen refs");
  return sort
    ? output.toSorted((left, right) =>
        `${left.id}\u0000${left.revision}\u0000${left.sha256}`.localeCompare(
          `${right.id}\u0000${right.revision}\u0000${right.sha256}`,
        ),
      )
    : output;
}

export function agent(value, path) {
  const object = exactKeys(
    value,
    ["agentId", "role", "harnessRevision"],
    ["agentId", "role", "harnessRevision"],
    path,
  );
  return {
    agent_id: nonEmpty(object.agentId, `${path}.agentId`),
    role: enumValue(object.role, EXECUTION_AGENT_ROLES, `${path}.role`),
    harness_revision: nonEmpty(object.harnessRevision, `${path}.harnessRevision`),
  };
}

export function permissionScope(value, path) {
  const object = exactKeys(
    value,
    ["allowedPaths", "forbiddenPaths", "dataClasses", "network"],
    ["allowedPaths", "forbiddenPaths", "dataClasses", "network"],
    path,
  );
  const allowedPaths = strings(object.allowedPaths, `${path}.allowedPaths`, { min: 1 });
  const forbiddenPaths = strings(object.forbiddenPaths, `${path}.forbiddenPaths`);
  for (const [index, candidate] of [...allowedPaths, ...forbiddenPaths].entries()) {
    if (!SCOPED_PATH.test(candidate)) fail(`${path}.paths[${index}]`, "must be a project-relative scoped path without '..'");
  }
  const overlap = allowedPaths.find((candidate) => forbiddenPaths.includes(candidate));
  if (overlap) fail(path, `allowed_paths and forbidden_paths overlap at ${overlap}`);
  const dataClasses = strings(object.dataClasses, `${path}.dataClasses`, { min: 1 });
  dataClasses.forEach((entry, index) => enumValue(entry, DATA_CLASSES, `${path}.dataClasses[${index}]`));
  const network = exactKeys(
    object.network,
    ["mode", "allowedHosts"],
    ["mode", "allowedHosts"],
    `${path}.network`,
  );
  const mode = enumValue(network.mode, ["DENY", "ALLOWLIST"], `${path}.network.mode`);
  const allowedHosts = strings(network.allowedHosts, `${path}.network.allowedHosts`, {
    min: mode === "ALLOWLIST" ? 1 : 0,
  });
  if (mode === "DENY" && allowedHosts.length > 0) {
    fail(`${path}.network.allowedHosts`, "must be empty when network mode is DENY");
  }
  return {
    allowed_paths: [...allowedPaths].sort(),
    forbidden_paths: [...forbiddenPaths].sort(),
    data_classes: [...dataClasses].sort(),
    network: { mode, allowed_hosts: [...allowedHosts].sort() },
  };
}

export function failure(value, path) {
  const object = exactKeys(value, ["kind", "summary", "retryable"], ["kind", "summary", "retryable"], path);
  const kind = enumValue(object.kind, FAILURE_KINDS, `${path}.kind`);
  if (typeof object.summary !== "string") fail(`${path}.summary`, "must be a string");
  const retryable = booleanValue(object.retryable, `${path}.retryable`);
  if (kind === "NONE" && (object.summary !== "" || retryable)) {
    fail(path, "NONE failure must have an empty summary and retryable=false");
  }
  if (kind !== "NONE" && object.summary.trim() === "") fail(`${path}.summary`, "must explain a non-NONE failure");
  return { kind, summary: object.summary, retryable };
}

export function nextAttempt(value, path) {
  if (value === null) return null;
  const object = exactKeys(value, ["recommended", "reason"], ["recommended", "reason"], path);
  return {
    recommended: booleanValue(object.recommended, `${path}.recommended`),
    reason: nonEmpty(object.reason, `${path}.reason`),
  };
}

export function changedFields(value, path, supersedes) {
  const output = strings(value, path);
  if (supersedes && output.length === 0) fail(path, "must identify changes when supersedes is present");
  return [...output].sort();
}

export function sameLogicalSupersedes(value, logicalId, path) {
  if (value === undefined) return undefined;
  const ref = frozenRef(value, path);
  if (ref.id !== logicalId) fail(`${path}.id`, `must equal the logical id ${logicalId}`);
  return ref;
}

export function ensureSha(value, path) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(path, "must be a lowercase SHA-256 digest");
  return value;
}

export function sealRecord(draft, revisionKey) {
  if (revisionKey in draft) fail(revisionKey, "must not be present before record sealing");
  return { ...draft, [revisionKey]: sha256(draft) };
}

export function assertWireRecordRevision(record, revisionKey, path = "record") {
  const object = objectAt(record, path);
  const actual = ensureSha(object[revisionKey], `${path}.${revisionKey}`);
  const payload = { ...object };
  delete payload[revisionKey];
  const expected = sha256(payload);
  if (actual !== expected) {
    fail(`${path}.${revisionKey}`, "does not match the immutable record content", { expected, actual });
  }
  return record;
}

export function wireRecordRef(record, { idKey, revisionKey, pointer } = {}) {
  const object = objectAt(record, "record");
  const id = nonEmpty(object[idKey], `record.${idKey}`);
  assertWireRecordRevision(record, revisionKey);
  return {
    id,
    revision: object[revisionKey],
    sha256: object[revisionKey],
    ...(pointer === undefined ? {} : { pointer: nonEmpty(pointer, "pointer") }),
  };
}

export function idempotencyKey(kind, payload) {
  return sha256({ schema: "hpi/execution-idempotency/v1", kind, payload });
}

