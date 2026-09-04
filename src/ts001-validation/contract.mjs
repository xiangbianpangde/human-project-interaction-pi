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
  if (g014Approved === false) {
    fail("TS001_G014_GATE_REQUIRED", "canonical restore requires explicit G-014 human approval");
  }
  if (g011Approved === false) {
    fail("TS001_G011_GATE_REQUIRED", "fixture alteration requires explicit G-011 test contract gate");
  }
  if (!supersedesRef || typeof supersedesRef !== "object") {
    fail("TS001_SUPERSEDES_MISSING", "rollback must specify supersedes pointing to previous revision");
  }
  if (supersedesRef.id !== oldRef.id || supersedesRef.revision !== oldRef.revision) {
    fail("TS001_SUPERSEDES_MISMATCH", "supersedes ref must match old record exactly");
  }
  return true;
}
