import { sha256 } from "../contracts.mjs";

export const TS001_CONTRACT_ID = "TS1-TEST-001";
export const TS001_CONTRACT_REVISION = "1";
export const TS001_TASK_IMPL = "TS001-IMPL";
export const TS001_TASK_VAL = "TS001-VAL";

export const TS001_DIRECT_INVARIANTS = Object.freeze([
  "INV-002",
  "INV-004",
  "INV-005",
  "INV-007",
  "INV-011",
  "INV-012",
  "INV-016",
]);

export const TS001_DEFERRED_INVARIANTS = Object.freeze([
  "INV-001",
  "INV-003",
  "INV-006",
  "INV-008",
  "INV-009",
  "INV-010",
  "INV-013",
  "INV-014",
  "INV-015",
  "INV-017",
]);

export const TS001_DATA_CLASSES = Object.freeze(["INTERNAL", "CONFIDENTIAL", "PUBLIC"]);

export const TS001_VAL_VERDICTS = Object.freeze(["CONFORMANT", "NON-CONFORMANT", "INCOMPLETE"]);

export const TS001_CANONICAL_INVARIANT_CASES = Object.freeze({
  "INV-002": ["TS1-S-010"],
  "INV-004": ["TS1-P-001"],
  "INV-005": ["TS1-P-002"],
  "INV-007": ["TS1-P-003"],
  "INV-011": ["TS1-I-003", "TS1-I-004"],
  "INV-012": ["TS1-S-011"],
  "INV-016": ["TS1-S-008", "TS1-P-006"],
});

export const TS001_REQUIRED_GATES = Object.freeze([
  "G-002",
  "G-011",
  "G-014",
  "G-SCHEMA",
  "G-PERMISSION",
]);

export class Ts001ValidationError extends Error {
  constructor(code, message, details = {}) {
    super(`[${code}] ${message}`);
    this.name = "Ts001ValidationError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new Ts001ValidationError(code, message, details);
}

export function validateTs001TaskSlice(task) {
  if (!task || typeof task !== "object") fail("TS001_TASK_TYPE", "TaskSlice must be an object");
  if (task.task_id !== TS001_TASK_IMPL && task.task_id !== TS001_TASK_VAL) {
    fail("TS001_TASK_ID", `task_id must be ${TS001_TASK_IMPL} or ${TS001_TASK_VAL}, got: ${task.task_id}`);
  }
  if (!task.permission_scope?.data_classes || !Array.isArray(task.permission_scope.data_classes)) {
    fail("TS001_DATA_CLASS_MISSING", "permission_scope.data_classes is required");
  }
  for (const dc of task.permission_scope.data_classes) {
    if (!TS001_DATA_CLASSES.includes(dc)) {
      fail("TS001_DATA_CLASS_INVALID", `unknown data_class: ${dc}`);
    }
  }
  return true;
}

export function validateTs001ValidationVerdict(verdict) {
  if (typeof verdict !== "string") fail("TS001_VERDICT_TYPE", "verdict must be a string");
  if (!TS001_VAL_VERDICTS.includes(verdict)) {
    fail("TS001_VERDICT_INVALID", `verdict must be CONFORMANT, NON-CONFORMANT, or INCOMPLETE, got: ${verdict}`);
  }
  return true;
}

export function validateTs001BlindReview(bundle) {
  if (!bundle || typeof bundle !== "object") fail("TS001_BUNDLE_TYPE", "bundle must be an object");
  if (!bundle.blind_review || typeof bundle.blind_review !== "object") {
    fail("TS001_BLIND_REVIEW_MISSING", "VAL ResultBundle requires a blind_review section (two-stage review)");
  }
  if (!bundle.blind_review.anonymized_candidate_ref) {
    fail("TS001_BLIND_REVIEW_CANDIDATE", "blind_review requires anonymized_candidate_ref");
  }
  return true;
}

export function validateTs001ThreeLayerHash({ workerReportedHash, coordinatorPreHarnessHash, harnessHash }) {
  if (!workerReportedHash || typeof workerReportedHash !== "string") {
    fail("TS001_HASH_LAYER_WORKER", "worker self-reported hash is required");
  }
  if (!coordinatorPreHarnessHash || typeof coordinatorPreHarnessHash !== "string") {
    fail("TS001_HASH_LAYER_COORDINATOR", "coordinator pre-Harness hash is required");
  }
  if (!harnessHash || typeof harnessHash !== "string") {
    fail("TS001_HASH_LAYER_HARNESS", "Harness authoritative hash is required");
  }
  return {
    isCoherent: workerReportedHash === coordinatorPreHarnessHash && coordinatorPreHarnessHash === harnessHash,
    workerReportedHash,
    coordinatorPreHarnessHash,
    harnessHash,
  };
}

export function validateTs001RollbackSupersedes({ oldRef, newRevision, supersedesRef, g014Approved, g011Approved }) {
  if (!oldRef || typeof oldRef !== "object" || !oldRef.id || !oldRef.revision) {
    fail("TS001_OLD_REF_REQUIRED", "oldRef must be a valid reference object with id and revision");
  }
  if (typeof newRevision !== "string" || !newRevision.trim()) {
    fail("TS001_NEW_REVISION_REQUIRED", "newRevision is required as a non-empty string");
  }
  if (newRevision === oldRef.revision) {
    fail("TS001_IN_PLACE_OVERWRITE_FORBIDDEN", "new revision must differ from old revision to preserve immutable history");
  }
  if (g014Approved !== true) {
    fail("TS001_G014_GATE_REQUIRED", "canonical restore requires explicit G-014 human approval (g014Approved must be true)");
  }
  if (g011Approved !== true) {
    fail("TS001_G011_GATE_REQUIRED", "fixture alteration requires explicit G-011 test contract gate (g011Approved must be true)");
  }
  if (!supersedesRef || typeof supersedesRef !== "object") {
    fail("TS001_SUPERSEDES_MISSING", "rollback must specify supersedes pointing to previous revision");
  }
  if (supersedesRef.id !== oldRef.id || supersedesRef.revision !== oldRef.revision) {
    fail("TS001_SUPERSEDES_MISMATCH", "supersedes ref must match old record exactly");
  }
  return true;
}

export function assertUniqueEntityIds(records, path = "records") {
  if (!Array.isArray(records)) fail("TS001_RECORDS_TYPE", `${path} must be an array`);
  const seen = new Set();
  for (const [index, record] of records.entries()) {
    const id = record?.entity_id || record?.id;
    if (!id || typeof id !== "string") {
      fail("TS001_ENTITY_ID_MISSING", `${path}[${index}] missing entity_id or id`);
    }
    if (seen.has(id)) {
      fail("TS001_DUPLICATE_ENTITY_ID", `duplicate entity_id detected: ${id} (INV-002)`);
    }
    seen.add(id);
  }
  return true;
}

export function assertRequiredGateConfig(gateConfig, path = "gateConfig") {
  if (!gateConfig || typeof gateConfig !== "object") {
    fail("TS001_GATE_CONFIG_MISSING", `missing Gate configuration at ${path}: fail closed immediately (INV-012)`);
  }
  for (const gate of TS001_REQUIRED_GATES) {
    if (!gateConfig[gate] || gateConfig[gate].enabled !== true) {
      fail("TS001_GATE_CONFIG_MISSING", `required Gate ${gate} missing or disabled: fail closed immediately (INV-012)`);
    }
  }
  return true;
}

export function verifyArtifactReference(artifactRef, actualBytes, path = "artifact") {
  if (!artifactRef || typeof artifactRef !== "object" || !artifactRef.sha256) {
    fail("TS001_ARTIFACT_REF_INVALID", `${path} missing artifactRef or sha256 (INV-005)`);
  }
  if (actualBytes === undefined || actualBytes === null) {
    fail("TS001_ARTIFACT_NOT_FOUND", `${path} artifact not found on filesystem (INV-005)`);
  }
  const computedHash = sha256(actualBytes);
  if (computedHash !== artifactRef.sha256) {
    fail(
      "TS001_ARTIFACT_HASH_MISMATCH",
      `${path} artifact hash mismatch: expected ${artifactRef.sha256}, got ${computedHash} (INV-005)`,
      { expected: artifactRef.sha256, actual: computedHash },
    );
  }
  return true;
}

export function validatePathPermission(targetPath, permissionScope, path = "path") {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    fail("TS001_PATH_INVALID", `${path} must be a non-empty string`);
  }
  if (!permissionScope || typeof permissionScope !== "object") {
    fail("TS001_SCOPE_INVALID", "permissionScope is required");
  }
  const allowed = Array.isArray(permissionScope.allowed_paths) ? permissionScope.allowed_paths : [];
  const forbidden = Array.isArray(permissionScope.forbidden_paths) ? permissionScope.forbidden_paths : [];

  const matchesPattern = (p) => {
    if (p.endsWith("/**")) {
      const dirPrefix = p.slice(0, -3) + "/";
      const exactDir = p.slice(0, -3);
      return targetPath === exactDir || targetPath.startsWith(dirPrefix);
    }
    return targetPath === p;
  };

  const isForbidden = forbidden.some(matchesPattern);
  const isAllowed = allowed.some(matchesPattern);

  if (isForbidden || !isAllowed) {
    fail(
      "TS001_PERMISSION_OUTSIDE_ALLOWLIST",
      `write to path outside allowlist or in forbidden scope: ${targetPath} (INV-007)`,
      { targetPath, allowed, forbidden },
    );
  }
  return true;
}
