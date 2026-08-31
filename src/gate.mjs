import {
  HUMAN_CATEGORIES,
  SCHEMAS,
  contentId,
  sha256,
  validateCandidateEvent,
  validateEscalationRequest,
} from "./contracts.mjs";

export const GATE_VERSION = "hpi-escalation-gate/0.1.0";

const MACHINE_FACT_PATTERNS = Object.freeze([
  {
    code: "test-count",
    regex: /\b\d+\s*\/\s*\d+\b/u,
  },
  {
    code: "test-pass",
    regex: /(?:测试|tests?|test suite).{0,36}(?:已|全部|都|all|fully)?.{0,12}(?:通过|成功|passed|pass\b|green|全绿)/iu,
  },
  {
    code: "hash-verification",
    regex: /(?:hash|sha(?:-?256)?|哈希).{0,30}(?:一致|正确|可信|匹配|verified|valid|match(?:es|ed)?|通过)/iu,
  },
  {
    code: "hash-approval",
    regex: /(?:相信|接受|确认|approve|accept|trust).{0,30}(?:hash|sha(?:-?256)?|哈希)/iu,
  },
  {
    code: "schema-verification",
    regex: /(?:schema|模式|字段).{0,30}(?:已|全部|都)?.{0,12}(?:通过|正确|完整|valid|verified|pass)/iu,
  },
  {
    code: "evidence-chain-trust",
    regex: /(?:相信|接受|确认|approve|accept|trust).{0,36}(?:证据链|引用链|evidence chain|reference chain)/iu,
  },
  {
    code: "side-effect-confirmation",
    regex: /(?:确认|保证|接受|approve|confirm).{0,36}(?:没有|无|no).{0,16}(?:越界写入|网络获取|真实数据|canonical 写入|side effects?|network access)/iu,
  },
  {
    code: "file-reference-verification",
    regex: /(?:确认|相信|接受|verify|confirm|trust).{0,32}(?:文件存在|引用存在|引用可解析|file exists|reference resolves)/iu,
  },
]);

const READ_ONLY_TALK_EVENTS = new Set([
  "hpi.view.l2",
  "hpi.view.machine_result",
  "hpi.view.evidence",
  "hpi.refresh",
]);

const DECISION_TALK_EVENTS = new Set([
  "hpi.decision.choose",
  "hpi.decision.reject",
  "hpi.decision.request_changes",
]);

export class GateError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "GateError";
    this.details = details;
  }
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new GateError(`${name} is required`);
  return value.trim();
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new GateError("event timestamp is invalid");
  return date.toISOString();
}

function rejectionKind(machineStatus, candidateCategory) {
  if (machineStatus === "NOT-RUN") return "NOT_RUN";
  if (candidateCategory === "EVIDENCE_GAP") return "EVIDENCE_GAP";
  return "MACHINE_FACT_REJECTED";
}

export function inspectMachineFactQuestion(text) {
  const input = typeof text === "string" ? text : "";
  const indicators = MACHINE_FACT_PATTERNS
    .filter((pattern) => pattern.regex.test(input))
    .map((pattern) => pattern.code);
  return {
    isMachineFact: indicators.length > 0,
    indicators,
  };
}

export function evaluateEscalation(candidate, context) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new GateError("escalation candidate must be an object");
  }
  const projectId = nonEmptyString(candidate.projectId, "candidate.projectId");
  const category = nonEmptyString(candidate.category, "candidate.category");
  const machineStatus = nonEmptyString(context?.machineStatus, "context.machineStatus");
  const sourceDigest = nonEmptyString(context?.sourceDigest, "context.sourceDigest");
  if (!/^[a-f0-9]{64}$/.test(sourceDigest)) throw new GateError("context.sourceDigest must be a SHA-256 digest");

  const inspection = inspectMachineFactQuestion(
    `${candidate.decisionUnit ?? ""}\n${candidate.question ?? ""}`,
  );
  const explicitlyMachine = category === "MACHINE_FACT" || category === "EVIDENCE_GAP";
  if (explicitlyMachine || inspection.isMachineFact) {
    return {
      schema: "hpi/escalation-rejection/v1",
      gateVersion: GATE_VERSION,
      kind: rejectionKind(machineStatus, category),
      projectId,
      machineStatus,
      sourceDigest,
      reason:
        machineStatus === "NOT-RUN"
          ? "权威机器状态是 NOT-RUN；人类回答不能把未运行测试变成工程通过。"
          : "该问题属于机器事实或证据缺口，应由确定性检查处理，而不是要求人相信。",
      indicators: explicitlyMachine ? [...new Set([category, ...inspection.indicators])] : inspection.indicators,
      missingEvidence: Array.isArray(candidate.missingEvidence) ? [...candidate.missingEvidence] : [],
      humanEscalation: null,
    };
  }

  if (!HUMAN_CATEGORIES.includes(category)) {
    throw new GateError(`candidate.category must be a human decision category: ${HUMAN_CATEGORIES.join(", ")}`);
  }

  const base = {
    schema: SCHEMAS.escalationRequest,
    projectId,
    category,
    decisionUnit: nonEmptyString(candidate.decisionUnit, "candidate.decisionUnit"),
    question: nonEmptyString(candidate.question, "candidate.question"),
    facts: candidate.facts,
    options: candidate.options,
    recommendation: nonEmptyString(candidate.recommendation, "candidate.recommendation"),
    safeDefault: "NO_STATE_CHANGE",
    affectedRefs: candidate.affectedRefs,
    oneQuestion: candidate.oneQuestion ?? true,
    sourceDigest,
  };
  const requestDigest = sha256(base);
  const request = {
    schema: base.schema,
    requestId: candidate.requestId ?? `ER-${requestDigest.slice(0, 20).toUpperCase()}`,
    projectId: base.projectId,
    category: base.category,
    decisionUnit: base.decisionUnit,
    question: base.question,
    facts: base.facts,
    options: base.options,
    recommendation: base.recommendation,
    safeDefault: base.safeDefault,
    affectedRefs: base.affectedRefs,
    requestDigest,
    oneQuestion: base.oneQuestion,
  };
  validateEscalationRequest(request);
  return {
    schema: "hpi/escalation-accepted/v1",
    gateVersion: GATE_VERSION,
    kind: "HUMAN_DECISION_REQUIRED",
    sourceDigest,
    request,
  };
}

function requestById(projection, requestId) {
  const requests = projection?.escalationRequests;
  if (!Array.isArray(requests)) throw new GateError("projection.escalationRequests is unavailable");
  return requests.find((request) => request.requestId === requestId);
}

function staleResult(reason, currentSourceDigest, request) {
  return {
    schema: "hpi/candidate-rejection/v1",
    kind: "STALE",
    reason,
    currentSourceDigest,
    currentRequestDigest: request?.requestDigest,
    candidate: null,
  };
}

export function createCandidateFromTalkEvent(talkEvent, projection, now = new Date()) {
  if (!talkEvent || typeof talkEvent !== "object" || Array.isArray(talkEvent)) {
    throw new GateError("talkEvent must be an object");
  }
  const type = nonEmptyString(talkEvent.type, "talkEvent.type");
  const talkEventId = nonEmptyString(talkEvent.id, "talkEvent.id");
  if (READ_ONLY_TALK_EVENTS.has(type)) {
    return {
      schema: "hpi/read-only-talk-event/v1",
      kind: "READ_ONLY",
      eventType: type,
      talkEventId,
      candidate: null,
    };
  }
  if (!DECISION_TALK_EVENTS.has(type)) throw new GateError(`unsupported HPI talk event: ${type}`);

  const payload = talkEvent.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new GateError("talkEvent.payload must be an object");
  }
  const requestId = nonEmptyString(payload.requestId, "talkEvent.payload.requestId");
  const requestDigest = nonEmptyString(payload.requestDigest, "talkEvent.payload.requestDigest");
  const sourceDigest = nonEmptyString(payload.sourceDigest, "talkEvent.payload.sourceDigest");
  const currentSourceDigest = nonEmptyString(projection?.sourceDigest, "projection.sourceDigest");
  const request = requestById(projection, requestId);

  if (!request) return staleResult("request no longer exists", currentSourceDigest);
  if (sourceDigest !== currentSourceDigest) {
    return staleResult("source digest changed after the decision was rendered", currentSourceDigest, request);
  }
  if (requestDigest !== request.requestDigest) {
    return staleResult("request digest changed after the decision was rendered", currentSourceDigest, request);
  }

  let action;
  let optionId;
  let statement;
  if (type === "hpi.decision.choose") {
    action = "choose";
    optionId = nonEmptyString(payload.optionId, "talkEvent.payload.optionId");
    if (!request.options.some((option) => option.optionId === optionId)) {
      throw new GateError(`unknown decision option: ${optionId}`);
    }
  } else if (type === "hpi.decision.reject") {
    action = "reject";
  } else {
    action = "request_changes";
    statement = nonEmptyString(payload.statement, "talkEvent.payload.statement");
  }

  const candidatePayload = {
    action,
    ...(optionId ? { optionId } : {}),
    ...(statement ? { statement } : {}),
    talkEventId,
    talkSurface: talkEvent.surface ?? "main",
  };
  const identity = {
    eventType: "HumanDecisionProposed",
    projectId: projection.projectId,
    basis: { sourceDigest, requestId, requestDigest },
    payload: candidatePayload,
  };
  const candidate = {
    schema: SCHEMAS.candidateEvent,
    eventId: contentId("CE", identity),
    eventType: identity.eventType,
    projectId: identity.projectId,
    basis: identity.basis,
    payload: identity.payload,
    status: "CANDIDATE",
    createdAt: isoTimestamp(talkEvent.ts ?? now),
  };
  validateCandidateEvent(candidate);
  return {
    schema: "hpi/candidate-created/v1",
    kind: "CANDIDATE_CREATED",
    candidate,
  };
}

export function createProposalCandidate({ op, projectId, sourceDigest, statement, objectId, originId }, now = new Date()) {
  const eventType = {
    pain: "PainProposed",
    change: "ChangeProposed",
    escalation: "EscalationProposed",
  }[op];
  if (!eventType) throw new GateError("proposal op must be pain, change, or escalation");
  const normalized = {
    eventType,
    projectId: nonEmptyString(projectId, "projectId"),
    basis: { sourceDigest: nonEmptyString(sourceDigest, "sourceDigest") },
    payload: {
      statement: nonEmptyString(statement, "statement"),
      ...(objectId ? { objectId: nonEmptyString(objectId, "objectId") } : {}),
    },
    nonce: originId ? nonEmptyString(originId, "originId") : isoTimestamp(now),
    createdAt: isoTimestamp(now),
  };
  if (!/^[a-f0-9]{64}$/.test(normalized.basis.sourceDigest)) {
    throw new GateError("sourceDigest must be a SHA-256 digest");
  }
  const identity = {
    eventType: normalized.eventType,
    projectId: normalized.projectId,
    basis: normalized.basis,
    payload: normalized.payload,
    nonce: normalized.nonce,
  };
  const candidate = {
    schema: SCHEMAS.candidateEvent,
    eventId: contentId("CE", identity),
    eventType,
    projectId: normalized.projectId,
    basis: normalized.basis,
    payload: normalized.payload,
    status: "CANDIDATE",
    createdAt: normalized.createdAt,
  };
  validateCandidateEvent(candidate);
  return candidate;
}

export function candidateFreshness(candidate, currentSourceDigest) {
  validateCandidateEvent(candidate);
  if (candidate.basis.sourceDigest === currentSourceDigest) {
    return { status: "CURRENT", reason: "source digest matches" };
  }
  return {
    status: "STALE",
    reason: "candidate basis no longer matches the current source snapshot",
    expected: candidate.basis.sourceDigest,
    actual: currentSourceDigest,
  };
}
