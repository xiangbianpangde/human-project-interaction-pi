import {
  sha256,
  validateEscalationRequest,
  validateHps,
  validateHumanBrief,
  validateHumanResult,
  validateMachineResult,
  validateSourceRef,
  validateTraceLink,
} from "./contracts.mjs";
import { GATE_VERSION } from "./gate.mjs";

export const WIRE_CODEC_VERSION = "hpi-wire-codec/1.1.0";

export const WIRE_OBJECT_SCHEMAS = Object.freeze({
  machine_result: "urn:hpi:wire:machine-result:v1",
  hps: "urn:hpi:wire:hps:v1",
  human_brief: "urn:hpi:wire:human-brief:v1",
  escalation_request: "urn:hpi:wire:escalation-request:v1",
  human_result: "urn:hpi:wire:human-result:v1",
  trace_link: "urn:hpi:wire:trace-link:v1",
});

const WIRE_SCHEMA_VALUES = Object.freeze({
  machine_result: "hpi/wire/machine-result/v1",
  hps: "hpi/wire/hps/v1",
  human_brief: "hpi/wire/human-brief/v1",
  escalation_request: "hpi/wire/escalation-request/v1",
  human_result: "hpi/wire/human-result/v1",
  trace_link: "hpi/wire/trace-link/v1",
});

export class WireCodecError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WireCodecError";
    this.details = details;
  }
}

function sourceRef(value, path = "source_ref") {
  validateSourceRef(value, path);
  return {
    id: value.id,
    revision: value.revision,
    ...(value.sha256 === undefined ? {} : { sha256: value.sha256 }),
    ...(value.pointer === undefined ? {} : { pointer: value.pointer }),
  };
}

function sourceRefs(values, path) {
  return values.map((value, index) => sourceRef(value, `${path}[${index}]`));
}

export function toWireMachineResult(value) {
  validateMachineResult(value);
  if (
    value.verdict === "PASS-ENGINEERING" &&
    (value.facts.length === 0 ||
      !value.facts.every((fact) => fact.status === "VERIFIED" && fact.evidenceRefs.length > 0))
  ) {
    throw new WireCodecError(
      "PASS-ENGINEERING requires a non-empty all-VERIFIED fact set with evidence before wire export",
    );
  }
  return {
    schema: WIRE_SCHEMA_VALUES.machine_result,
    result_id: value.resultId,
    task_id: value.taskId,
    attempt_id: value.attemptId,
    result_revision: sha256(value),
    source_ref: sourceRef(value.sourceRef, "machineResult.sourceRef"),
    verdict: value.verdict,
    facts: value.facts.map((fact, index) => ({
      fact_id: fact.id,
      kind: fact.kind,
      statement: fact.statement,
      status: fact.status,
      evidence_refs: sourceRefs(fact.evidenceRefs, `machineResult.facts[${index}].evidenceRefs`),
    })),
    limitations: [...value.limitations],
    unresolved: [...value.unresolved],
  };
}

export function toWireHps(value) {
  validateHps(value);
  return {
    schema: WIRE_SCHEMA_VALUES.hps,
    project_id: value.projectId,
    projection_id: value.projectionId,
    projector_revision: value.projectorVersion,
    source_snapshot: sourceRefs(value.sourceSnapshot, "hps.sourceSnapshot"),
    source_digest: value.sourceDigest,
    phase: value.phase,
    intent: {
      statement: value.intent.statement,
      source_ref: sourceRef(value.intent.sourceRef, "hps.intent.sourceRef"),
    },
    pains: value.pains.map((pain) => ({
      pain_id: pain.id,
      statement: pain.statement,
      status: pain.status,
      remaining_gap: pain.remainingGap,
      source_ref: sourceRef(pain.sourceRef, `hps.pains.${pain.id}.sourceRef`),
    })),
    active_work: value.activeWork.map((work) => ({
      task_id: work.taskId,
      why_now: work.whyNow,
      machine_status: work.machineStatus,
      human_status: work.humanStatus,
      latest_change: work.latestChange,
      ...(work.resultRef === undefined
        ? {}
        : { result_ref: sourceRef(work.resultRef, `hps.activeWork.${work.taskId}.resultRef`) }),
      ...(work.decisionRef === undefined
        ? {}
        : { decision_ref: sourceRef(work.decisionRef, `hps.activeWork.${work.taskId}.decisionRef`) }),
    })),
    changes_since_last_seen: [...value.changesSinceLastSeen],
    unresolved: value.unresolved.map((entry) => ({
      unresolved_id: entry.id,
      statement: entry.statement,
      source_ref: sourceRef(entry.sourceRef, `hps.unresolved.${entry.id}.sourceRef`),
    })),
    risks: [...value.risks],
    decision_request_ids: [...value.decisionRequestIds],
    evidence_summary: {
      verified: value.evidenceSummary.verified,
      self_reported: value.evidenceSummary.selfReported,
      not_run: value.evidenceSummary.notRun,
      incomplete: value.evidenceSummary.incomplete,
    },
    trace_link_ids: [...value.traceLinkIds],
  };
}

export function toWireHumanBrief(value) {
  validateHumanBrief(value);
  return {
    schema: WIRE_SCHEMA_VALUES.human_brief,
    brief_id: value.briefId,
    project_id: value.projectId,
    subject_ref: sourceRef(value.subjectRef, "humanBrief.subjectRef"),
    hps_projection_id: value.hpsProjectionId,
    headline: value.headline,
    why_now: value.whyNow,
    pain_refs: [...value.painRefs],
    design_point: value.designPoint,
    changed: [...value.changed],
    machine_verified: [...value.machineVerified],
    not_verified: [...value.machineNotVerified],
    remaining: [...value.remaining],
    next_and_reason: {
      statement: value.next.statement,
      reason: value.next.reason,
    },
    human_decision: value.decisionRequestId
      ? { required: true, request_ref: value.decisionRequestId }
      : { required: false },
    risk_and_consequence: [...value.risks],
    drill_down: {
      trace_refs: [...value.drillDown.traceLinkIds],
      evidence_refs: sourceRefs(value.drillDown.evidenceRefs, "humanBrief.drillDown.evidenceRefs"),
      source_refs: sourceRefs(value.drillDown.sourceRefs, "humanBrief.drillDown.sourceRefs"),
    },
  };
}

export function toWireEscalationRequest(value) {
  validateEscalationRequest(value);
  return {
    schema: WIRE_SCHEMA_VALUES.escalation_request,
    request_id: value.requestId,
    project_id: value.projectId,
    gate_revision: GATE_VERSION,
    category: value.category,
    decision_unit: value.decisionUnit,
    question: value.question,
    current_facts: value.facts.map((fact) => ({
      statement: fact.statement,
      source_ref: sourceRef(fact.sourceRef, "escalationRequest.facts.sourceRef"),
      evidence_status: fact.evidenceStatus,
    })),
    options: value.options.map((option) => ({
      option_id: option.optionId,
      label: option.label,
      consequences: option.consequence,
      risks: option.risk,
      reversibility: option.reversible,
    })),
    recommendation: value.recommendation,
    safe_default_if_no_answer: value.safeDefault,
    affected_revisions: sourceRefs(value.affectedRefs, "escalationRequest.affectedRefs"),
    request_digest: value.requestDigest,
    one_question: value.oneQuestion,
  };
}

export function toWireHumanResult(value) {
  validateHumanResult(value);
  if (["ACCEPT_OPTION", "ACCEPT_WITH_CONDITIONS"].includes(value.decision) && !value.optionId) {
    throw new WireCodecError(`${value.decision} requires optionId before wire export`);
  }
  if (value.decision === "ACCEPT_WITH_CONDITIONS" && (!value.conditions || value.conditions.length === 0)) {
    throw new WireCodecError("ACCEPT_WITH_CONDITIONS requires at least one condition before wire export");
  }
  if (value.decision === "REQUEST_CHANGES" && !value.statement) {
    throw new WireCodecError("REQUEST_CHANGES requires a statement before wire export");
  }
  return {
    schema: WIRE_SCHEMA_VALUES.human_result,
    human_result_id: value.humanResultId,
    request_id: value.requestId,
    decision_revision: sha256(value),
    source_ref: sourceRef(value.sourceRef, "humanResult.sourceRef"),
    decision_kind: value.decision,
    ...(value.optionId === undefined ? {} : { selected_option: value.optionId }),
    ...(value.statement === undefined ? {} : { statement: value.statement }),
    ...(value.conditions === undefined ? {} : { accepted_conditions: [...value.conditions] }),
    affected_revisions: sourceRefs(value.affectedRefs, "humanResult.affectedRefs"),
    actor: {
      kind: "human",
      ...(value.actor.id === undefined ? {} : { id: value.actor.id }),
    },
    captured_at: value.capturedAt,
    explicitness: "explicit",
  };
}

export function toWireTraceLink(value) {
  validateTraceLink(value);
  return {
    schema: WIRE_SCHEMA_VALUES.trace_link,
    link_id: value.linkId,
    from_ref: sourceRef(value.from, "traceLink.from"),
    to_ref: sourceRef(value.to, "traceLink.to"),
    relation: value.relation,
    source_ref: sourceRef(value.sourceRef, "traceLink.sourceRef"),
  };
}
