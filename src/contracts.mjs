import { createHash } from "node:crypto";

export const SCHEMAS = Object.freeze({
  source: "hpi/source-ref/v1",
  hps: "hpi/hps/v1",
  machineResult: "hpi/machine-result/v1",
  humanResult: "hpi/human-result/v1",
  humanBrief: "hpi/human-brief/v1",
  escalationRequest: "hpi/escalation-request/v1",
  traceLink: "hpi/trace-link/v1",
  candidateEvent: "hpi/candidate-event/v1",
  talk: "hpi/talk/v1",
});

export const MACHINE_VERDICTS = Object.freeze([
  "NOT-RUN",
  "RUNNING",
  "PASS-ENGINEERING",
  "INCOMPLETE",
  "DEVIATIONS_FOUND",
  "OUT_OF_SCOPE",
  "BLOCKED",
]);

export const HUMAN_STATUSES = Object.freeze([
  "NOT_NEEDED",
  "HUMAN_PENDING",
  "HUMAN_ACCEPTED",
  "HUMAN_ACCEPTED_WITH_CONDITIONS",
  "HUMAN_REJECTED",
  "CHANGES_REQUESTED",
]);

export const PROJECT_PHASES = Object.freeze([
  "ORIENTING",
  "DESIGN_PENDING",
  "READY_FOR_IMPLEMENTATION",
  "EXECUTING",
  "MACHINE_VALIDATION",
  "HUMAN_DECISION_PENDING",
  "PARTIALLY_SOLVED",
  "SOLVED_PENDING_CONFIRMATION",
  "CLOSED",
  "BLOCKED",
  "RECOVERY",
]);

export const PAIN_STATUSES = Object.freeze([
  "OPEN",
  "PARTIAL",
  "SOLVED_PENDING_CONFIRMATION",
  "SOLVED",
  "NEEDS_REVIEW",
  "OUT_OF_SCOPE",
]);

export const FACT_KINDS = Object.freeze([
  "TEST",
  "HASH",
  "FILE",
  "REFERENCE",
  "PERMISSION",
  "OTHER",
]);

export const FACT_STATUSES = Object.freeze([
  "VERIFIED",
  "FAILED",
  "NOT_RUN",
  "INCOMPLETE",
  "SELF_REPORTED",
]);

export const HUMAN_CATEGORIES = Object.freeze([
  "INTENT",
  "SCOPE",
  "DESIGN",
  "RISK",
  "IRREVERSIBLE",
  "SEMANTIC_OUTCOME",
]);

export const HUMAN_DECISIONS = Object.freeze([
  "ACCEPT_OPTION",
  "ACCEPT_WITH_CONDITIONS",
  "REJECT",
  "REQUEST_CHANGES",
]);

export const TRACE_RELATIONS = Object.freeze([
  "motivates",
  "refines",
  "implements",
  "tests",
  "derives",
  "uses",
  "generated_by",
  "reviewed_by",
  "accepted_by",
  "supersedes",
  "invalidates",
  "needs_review",
]);

export const CANDIDATE_EVENT_TYPES = Object.freeze([
  "HumanDecisionProposed",
  "PainProposed",
  "ChangeProposed",
  "EscalationProposed",
]);

const SHA256 = /^[a-f0-9]{64}$/;

export class ContractError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "ContractError";
    this.path = path;
  }
}

function fail(path, message) {
  throw new ContractError(path, message);
}

function objectAt(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value;
}

function arrayAt(value, path) {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function stringAt(value, path, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    fail(path, allowEmpty ? "must be a string" : "must be a non-empty string");
  }
  return value;
}

function booleanAt(value, path) {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function enumAt(value, allowed, path) {
  stringAt(value, path);
  if (!allowed.includes(value)) {
    fail(path, `must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function integerAt(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(path, "must be a non-negative safe integer");
  }
  return value;
}

function exactKeys(value, allowed, required, path) {
  const object = objectAt(value, path);
  for (const key of required) {
    if (!(key in object)) fail(`${path}.${key}`, "is required");
  }
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "is not allowed by this contract");
  }
  return object;
}

function stringsAt(value, path) {
  return arrayAt(value, path).map((entry, index) => stringAt(entry, `${path}[${index}]`));
}

function sourceRefsAt(value, path) {
  return arrayAt(value, path).map((entry, index) => validateSourceRef(entry, `${path}[${index}]`));
}

export function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON does not support non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = canonicalize(value[key]);
    }
    return output;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const input = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function contentId(prefix, value) {
  stringAt(prefix, "prefix");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(prefix)) fail("prefix", "contains invalid characters");
  return `${prefix}-${sha256(value)}`;
}

export function validateSourceRef(value, path = "sourceRef") {
  const object = exactKeys(
    value,
    ["id", "revision", "sha256", "pointer"],
    ["id", "revision"],
    path,
  );
  stringAt(object.id, `${path}.id`);
  stringAt(object.revision, `${path}.revision`);
  if (object.sha256 !== undefined && !SHA256.test(object.sha256)) {
    fail(`${path}.sha256`, "must be a lowercase SHA-256 hex digest");
  }
  if (object.pointer !== undefined) stringAt(object.pointer, `${path}.pointer`);
  return value;
}

function validateMachineFactSet(value, path) {
  const facts = arrayAt(value, path);
  const factIds = new Set();
  facts.forEach((fact, index) => {
    const factPath = `${path}[${index}]`;
    const item = exactKeys(
      fact,
      ["id", "kind", "statement", "status", "evidenceRefs"],
      ["id", "kind", "statement", "status", "evidenceRefs"],
      factPath,
    );
    stringAt(item.id, `${factPath}.id`);
    if (factIds.has(item.id)) fail(`${factPath}.id`, "must be unique inside one MachineResult");
    factIds.add(item.id);
    enumAt(item.kind, FACT_KINDS, `${factPath}.kind`);
    stringAt(item.statement, `${factPath}.statement`);
    enumAt(item.status, FACT_STATUSES, `${factPath}.status`);
    sourceRefsAt(item.evidenceRefs, `${factPath}.evidenceRefs`);
    if (item.status === "VERIFIED" && item.evidenceRefs.length === 0) {
      fail(`${factPath}.evidenceRefs`, "VERIFIED facts require at least one evidence ref");
    }
  });
  return facts;
}

function validatePassFactSet(value, path) {
  const facts = validateMachineFactSet(value, path);
  if (facts.length === 0) fail(path, "PASS-ENGINEERING requires at least one fact");
  const contradictoryIndex = facts.findIndex((fact) => fact.status !== "VERIFIED");
  if (contradictoryIndex >= 0) {
    fail(
      `${path}[${contradictoryIndex}].status`,
      "PASS-ENGINEERING requires every fact status to be VERIFIED",
    );
  }
  return facts;
}

function isPassFactSet(value, path) {
  try {
    validatePassFactSet(value, path);
    return true;
  } catch (error) {
    if (error instanceof ContractError) return false;
    throw error;
  }
}

export function validateMachineResult(value, path = "machineResult") {
  const object = exactKeys(
    value,
    ["schema", "resultId", "taskId", "attemptId", "sourceRef", "verdict", "facts", "limitations", "unresolved"],
    ["schema", "resultId", "taskId", "attemptId", "sourceRef", "verdict", "facts", "limitations", "unresolved"],
    path,
  );
  if (object.schema !== SCHEMAS.machineResult) fail(`${path}.schema`, `must equal ${SCHEMAS.machineResult}`);
  stringAt(object.resultId, `${path}.resultId`);
  stringAt(object.taskId, `${path}.taskId`);
  stringAt(object.attemptId, `${path}.attemptId`);
  validateSourceRef(object.sourceRef, `${path}.sourceRef`);
  enumAt(object.verdict, MACHINE_VERDICTS, `${path}.verdict`);
  if (object.verdict === "PASS-ENGINEERING") {
    validatePassFactSet(object.facts, `${path}.facts`);
  } else {
    validateMachineFactSet(object.facts, `${path}.facts`);
  }
  stringsAt(object.limitations, `${path}.limitations`);
  stringsAt(object.unresolved, `${path}.unresolved`);
  return value;
}

export function validateHps(value, path = "hps") {
  const object = exactKeys(
    value,
    [
      "schema",
      "projectId",
      "projectionId",
      "projectorVersion",
      "sourceSnapshot",
      "sourceDigest",
      "phase",
      "intent",
      "pains",
      "activeWork",
      "changesSinceLastSeen",
      "unresolved",
      "risks",
      "decisionRequestIds",
      "evidenceSummary",
      "traceLinkIds",
    ],
    [
      "schema",
      "projectId",
      "projectionId",
      "projectorVersion",
      "sourceSnapshot",
      "sourceDigest",
      "phase",
      "intent",
      "pains",
      "activeWork",
      "changesSinceLastSeen",
      "unresolved",
      "risks",
      "decisionRequestIds",
      "evidenceSummary",
      "traceLinkIds",
    ],
    path,
  );
  if (object.schema !== SCHEMAS.hps) fail(`${path}.schema`, `must equal ${SCHEMAS.hps}`);
  stringAt(object.projectId, `${path}.projectId`);
  if (!SHA256.test(object.projectionId)) fail(`${path}.projectionId`, "must be a SHA-256 digest");
  stringAt(object.projectorVersion, `${path}.projectorVersion`);
  const snapshot = sourceRefsAt(object.sourceSnapshot, `${path}.sourceSnapshot`);
  if (snapshot.length === 0) fail(`${path}.sourceSnapshot`, "must not be empty");
  if (!SHA256.test(object.sourceDigest)) fail(`${path}.sourceDigest`, "must be a SHA-256 digest");
  enumAt(object.phase, PROJECT_PHASES, `${path}.phase`);

  const intent = exactKeys(object.intent, ["statement", "sourceRef"], ["statement", "sourceRef"], `${path}.intent`);
  stringAt(intent.statement, `${path}.intent.statement`);
  validateSourceRef(intent.sourceRef, `${path}.intent.sourceRef`);

  arrayAt(object.pains, `${path}.pains`).forEach((pain, index) => {
    const painPath = `${path}.pains[${index}]`;
    const item = exactKeys(pain, ["id", "statement", "status", "remainingGap", "sourceRef"], ["id", "statement", "status", "remainingGap", "sourceRef"], painPath);
    stringAt(item.id, `${painPath}.id`);
    stringAt(item.statement, `${painPath}.statement`);
    enumAt(item.status, PAIN_STATUSES, `${painPath}.status`);
    stringAt(item.remainingGap, `${painPath}.remainingGap`, { allowEmpty: true });
    validateSourceRef(item.sourceRef, `${painPath}.sourceRef`);
  });

  arrayAt(object.activeWork, `${path}.activeWork`).forEach((work, index) => {
    const workPath = `${path}.activeWork[${index}]`;
    const item = exactKeys(work, ["taskId", "whyNow", "machineStatus", "humanStatus", "latestChange", "resultRef", "decisionRef"], ["taskId", "whyNow", "machineStatus", "humanStatus", "latestChange"], workPath);
    stringAt(item.taskId, `${workPath}.taskId`);
    stringAt(item.whyNow, `${workPath}.whyNow`);
    enumAt(item.machineStatus, MACHINE_VERDICTS, `${workPath}.machineStatus`);
    enumAt(item.humanStatus, HUMAN_STATUSES, `${workPath}.humanStatus`);
    stringAt(item.latestChange, `${workPath}.latestChange`);
    if (item.resultRef !== undefined) validateSourceRef(item.resultRef, `${workPath}.resultRef`);
    if (item.decisionRef !== undefined) validateSourceRef(item.decisionRef, `${workPath}.decisionRef`);
  });

  stringsAt(object.changesSinceLastSeen, `${path}.changesSinceLastSeen`);
  arrayAt(object.unresolved, `${path}.unresolved`).forEach((entry, index) => {
    const entryPath = `${path}.unresolved[${index}]`;
    const item = exactKeys(entry, ["id", "statement", "sourceRef"], ["id", "statement", "sourceRef"], entryPath);
    stringAt(item.id, `${entryPath}.id`);
    stringAt(item.statement, `${entryPath}.statement`);
    validateSourceRef(item.sourceRef, `${entryPath}.sourceRef`);
  });
  stringsAt(object.risks, `${path}.risks`);
  stringsAt(object.decisionRequestIds, `${path}.decisionRequestIds`);
  stringsAt(object.traceLinkIds, `${path}.traceLinkIds`);

  const evidence = exactKeys(object.evidenceSummary, ["verified", "selfReported", "notRun", "incomplete"], ["verified", "selfReported", "notRun", "incomplete"], `${path}.evidenceSummary`);
  for (const key of ["verified", "selfReported", "notRun", "incomplete"]) {
    integerAt(evidence[key], `${path}.evidenceSummary.${key}`);
  }
  return value;
}

export function validateHumanBrief(value, path = "humanBrief") {
  const object = exactKeys(
    value,
    ["schema", "briefId", "projectId", "subjectRef", "hpsProjectionId", "headline", "whyNow", "painRefs", "designPoint", "changed", "machineVerified", "machineNotVerified", "remaining", "next", "decisionRequestId", "risks", "drillDown"],
    ["schema", "briefId", "projectId", "subjectRef", "hpsProjectionId", "headline", "whyNow", "painRefs", "designPoint", "changed", "machineVerified", "machineNotVerified", "remaining", "next", "risks", "drillDown"],
    path,
  );
  if (object.schema !== SCHEMAS.humanBrief) fail(`${path}.schema`, `must equal ${SCHEMAS.humanBrief}`);
  for (const key of ["briefId", "projectId", "hpsProjectionId", "headline", "whyNow", "designPoint"]) {
    stringAt(object[key], `${path}.${key}`);
  }
  validateSourceRef(object.subjectRef, `${path}.subjectRef`);
  stringsAt(object.painRefs, `${path}.painRefs`);
  stringsAt(object.changed, `${path}.changed`);
  stringsAt(object.machineVerified, `${path}.machineVerified`);
  stringsAt(object.machineNotVerified, `${path}.machineNotVerified`);
  stringsAt(object.remaining, `${path}.remaining`);
  stringsAt(object.risks, `${path}.risks`);
  if (object.decisionRequestId !== undefined) stringAt(object.decisionRequestId, `${path}.decisionRequestId`);
  const next = exactKeys(object.next, ["statement", "reason"], ["statement", "reason"], `${path}.next`);
  stringAt(next.statement, `${path}.next.statement`);
  stringAt(next.reason, `${path}.next.reason`);
  const drillDown = exactKeys(object.drillDown, ["traceLinkIds", "evidenceRefs", "sourceRefs"], ["traceLinkIds", "evidenceRefs", "sourceRefs"], `${path}.drillDown`);
  stringsAt(drillDown.traceLinkIds, `${path}.drillDown.traceLinkIds`);
  sourceRefsAt(drillDown.evidenceRefs, `${path}.drillDown.evidenceRefs`);
  sourceRefsAt(drillDown.sourceRefs, `${path}.drillDown.sourceRefs`);
  return value;
}

export function validateEscalationRequest(value, path = "escalationRequest") {
  const object = exactKeys(
    value,
    ["schema", "requestId", "projectId", "category", "decisionUnit", "question", "facts", "options", "recommendation", "safeDefault", "affectedRefs", "requestDigest", "oneQuestion"],
    ["schema", "requestId", "projectId", "category", "decisionUnit", "question", "facts", "options", "recommendation", "safeDefault", "affectedRefs", "requestDigest", "oneQuestion"],
    path,
  );
  if (object.schema !== SCHEMAS.escalationRequest) fail(`${path}.schema`, `must equal ${SCHEMAS.escalationRequest}`);
  for (const key of ["requestId", "projectId", "decisionUnit", "question", "recommendation"]) {
    stringAt(object[key], `${path}.${key}`);
  }
  enumAt(object.category, HUMAN_CATEGORIES, `${path}.category`);
  if (object.safeDefault !== "NO_STATE_CHANGE") fail(`${path}.safeDefault`, "must equal NO_STATE_CHANGE");
  if (booleanAt(object.oneQuestion, `${path}.oneQuestion`) !== true) fail(`${path}.oneQuestion`, "must be true");
  const questionCount = (object.question.match(/[?？]/g) ?? []).length;
  if (questionCount !== 1) fail(`${path}.question`, "must contain exactly one question mark");

  const facts = arrayAt(object.facts, `${path}.facts`);
  if (facts.length === 0) fail(`${path}.facts`, "must not be empty");
  facts.forEach((fact, index) => {
    const factPath = `${path}.facts[${index}]`;
    const item = exactKeys(fact, ["statement", "sourceRef", "evidenceStatus"], ["statement", "sourceRef", "evidenceStatus"], factPath);
    stringAt(item.statement, `${factPath}.statement`);
    validateSourceRef(item.sourceRef, `${factPath}.sourceRef`);
    enumAt(item.evidenceStatus, ["VERIFIED", "SELF_REPORTED", "NOT_RUN", "INCOMPLETE"], `${factPath}.evidenceStatus`);
  });

  const options = arrayAt(object.options, `${path}.options`);
  if (options.length < 2) fail(`${path}.options`, "must contain at least two options");
  const optionIds = new Set();
  options.forEach((option, index) => {
    const optionPath = `${path}.options[${index}]`;
    const item = exactKeys(option, ["optionId", "label", "consequence", "risk", "reversible"], ["optionId", "label", "consequence", "risk", "reversible"], optionPath);
    for (const key of ["optionId", "label", "consequence", "risk"]) stringAt(item[key], `${optionPath}.${key}`, { allowEmpty: key === "risk" });
    booleanAt(item.reversible, `${optionPath}.reversible`);
    if (optionIds.has(item.optionId)) fail(`${optionPath}.optionId`, "must be unique");
    optionIds.add(item.optionId);
  });
  sourceRefsAt(object.affectedRefs, `${path}.affectedRefs`);
  if (!SHA256.test(object.requestDigest)) fail(`${path}.requestDigest`, "must be a SHA-256 digest");
  return value;
}

export function validateHumanResult(value, path = "humanResult") {
  const object = exactKeys(
    value,
    ["schema", "humanResultId", "requestId", "sourceRef", "decision", "optionId", "statement", "conditions", "affectedRefs", "actor", "capturedAt"],
    ["schema", "humanResultId", "requestId", "sourceRef", "decision", "affectedRefs", "actor", "capturedAt"],
    path,
  );
  if (object.schema !== SCHEMAS.humanResult) fail(`${path}.schema`, `must equal ${SCHEMAS.humanResult}`);
  stringAt(object.humanResultId, `${path}.humanResultId`);
  stringAt(object.requestId, `${path}.requestId`);
  validateSourceRef(object.sourceRef, `${path}.sourceRef`);
  enumAt(object.decision, HUMAN_DECISIONS, `${path}.decision`);
  if (object.optionId !== undefined) stringAt(object.optionId, `${path}.optionId`);
  if (object.statement !== undefined) stringAt(object.statement, `${path}.statement`);
  if (object.conditions !== undefined) stringsAt(object.conditions, `${path}.conditions`);
  sourceRefsAt(object.affectedRefs, `${path}.affectedRefs`);
  const actor = exactKeys(object.actor, ["kind", "id"], ["kind"], `${path}.actor`);
  if (actor.kind !== "human") fail(`${path}.actor.kind`, "must equal human");
  if (actor.id !== undefined) stringAt(actor.id, `${path}.actor.id`);
  stringAt(object.capturedAt, `${path}.capturedAt`);
  if (Number.isNaN(Date.parse(object.capturedAt))) fail(`${path}.capturedAt`, "must be an ISO-compatible timestamp");
  return value;
}

export function validateTraceLink(value, path = "traceLink") {
  const object = exactKeys(value, ["schema", "linkId", "from", "to", "relation", "sourceRef"], ["schema", "linkId", "from", "to", "relation", "sourceRef"], path);
  if (object.schema !== SCHEMAS.traceLink) fail(`${path}.schema`, `must equal ${SCHEMAS.traceLink}`);
  stringAt(object.linkId, `${path}.linkId`);
  validateSourceRef(object.from, `${path}.from`);
  validateSourceRef(object.to, `${path}.to`);
  enumAt(object.relation, TRACE_RELATIONS, `${path}.relation`);
  validateSourceRef(object.sourceRef, `${path}.sourceRef`);
  return value;
}

export function validateCandidateEvent(value, path = "candidateEvent") {
  const object = exactKeys(value, ["schema", "eventId", "eventType", "projectId", "basis", "payload", "status", "createdAt"], ["schema", "eventId", "eventType", "projectId", "basis", "payload", "status", "createdAt"], path);
  if (object.schema !== SCHEMAS.candidateEvent) fail(`${path}.schema`, `must equal ${SCHEMAS.candidateEvent}`);
  stringAt(object.eventId, `${path}.eventId`);
  enumAt(object.eventType, CANDIDATE_EVENT_TYPES, `${path}.eventType`);
  stringAt(object.projectId, `${path}.projectId`);
  if (object.status !== "CANDIDATE") fail(`${path}.status`, "must equal CANDIDATE");
  stringAt(object.createdAt, `${path}.createdAt`);
  if (Number.isNaN(Date.parse(object.createdAt))) fail(`${path}.createdAt`, "must be an ISO-compatible timestamp");
  const basis = exactKeys(object.basis, ["sourceDigest", "requestId", "requestDigest"], ["sourceDigest"], `${path}.basis`);
  if (!SHA256.test(basis.sourceDigest)) fail(`${path}.basis.sourceDigest`, "must be a SHA-256 digest");
  if (basis.requestId !== undefined) stringAt(basis.requestId, `${path}.basis.requestId`);
  if (basis.requestDigest !== undefined && !SHA256.test(basis.requestDigest)) fail(`${path}.basis.requestDigest`, "must be a SHA-256 digest");
  objectAt(object.payload, `${path}.payload`);
  if (object.eventType === "HumanDecisionProposed") {
    if (!basis.requestId || !basis.requestDigest) fail(`${path}.basis`, "human decisions require requestId and requestDigest");
    stringAt(object.payload.action, `${path}.payload.action`);
  }
  return value;
}

export function deriveMachineVerdict({ authoritativeVerdict, claimedVerdict, facts = [] }) {
  enumAt(authoritativeVerdict, MACHINE_VERDICTS, "authoritativeVerdict");
  enumAt(claimedVerdict, MACHINE_VERDICTS, "claimedVerdict");

  // Claims and individual facts can reduce confidence, but they can never promote
  // a non-pass authority state. RUNNING/BLOCKED/etc. remain authoritative.
  if (authoritativeVerdict !== "PASS-ENGINEERING") return authoritativeVerdict;
  if (claimedVerdict !== "PASS-ENGINEERING") return "INCOMPLETE";

  const factSet = arrayAt(facts, "facts");
  return isPassFactSet(factSet, "facts") ? "PASS-ENGINEERING" : "INCOMPLETE";
}
