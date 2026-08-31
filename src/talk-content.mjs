import { HUMAN_STATUSES, MACHINE_VERDICTS, SCHEMAS } from "./contracts.mjs";
import { summarizeOutbox } from "./session.mjs";

export const TALK_RENDERER_VERSION = "hpi-project/0.2.0";

export class TalkContentError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "TalkContentError";
    this.details = details;
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TalkContentError(`${name} is required`);
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TalkContentError(`${name} must be an array`);
  return value;
}

function primaryWork(hps) {
  const work = hps.activeWork?.[0];
  if (!work) throw new TalkContentError("HPS has no active TaskSlice");
  return work;
}

function primaryBrief(projection) {
  const brief = projection.briefs?.[0];
  if (!brief) throw new TalkContentError("projection has no Human Brief");
  return brief;
}

function machineResult(projection, taskId) {
  const result = projection.machineResults?.find((entry) => entry.taskId === taskId);
  if (!result) throw new TalkContentError(`projection has no MachineResult for ${taskId}`);
  return result;
}

function decisionRequest(projection, requestId) {
  if (!requestId) return undefined;
  const request = projection.escalationRequests?.find((entry) => entry.requestId === requestId);
  if (!request) throw new TalkContentError(`projection has no EscalationRequest ${requestId}`);
  return request;
}

function semanticNodes(projection) {
  const nodes = [];
  for (const pain of projection.hps.pains) {
    nodes.push({ id: pain.id, type: "PAIN", label: pain.statement, status: pain.status });
  }
  for (const work of projection.hps.activeWork) {
    nodes.push({
      id: work.taskId,
      type: "TASK",
      label: work.whyNow,
      machineStatus: work.machineStatus,
      humanStatus: work.humanStatus,
    });
  }
  for (const result of projection.machineResults) {
    nodes.push({
      id: result.resultId,
      type: "MACHINE_RESULT",
      label: `${result.taskId} · ${result.verdict}`,
      machineStatus: result.verdict,
    });
  }
  return nodes;
}

function machineEvidence(result) {
  return result.facts.map((fact) => ({
    id: fact.id,
    kind: fact.kind,
    statement: fact.statement,
    status: fact.status,
    evidenceRefs: fact.evidenceRefs,
  }));
}

export function buildTalkContent(projection, { restoredOutbox } = {}) {
  if (!projection || projection.schema !== "hpi/projection-bundle/v1") {
    throw new TalkContentError("unsupported projection bundle");
  }
  const hps = projection.hps;
  const work = primaryWork(hps);
  const brief = primaryBrief(projection);
  const result = machineResult(projection, work.taskId);
  const request = decisionRequest(projection, brief.decisionRequestId);

  const content = {
    kind: "hpi-project",
    schema: SCHEMAS.talk,
    project: {
      id: projection.projectId,
      phase: hps.phase,
      title: requireString(projection.projectTitle, "projection.projectTitle"),
    },
    status: {
      machine: work.machineStatus,
      human: work.humanStatus,
    },
    l0: {
      intent: hps.intent.statement,
      current: brief.headline,
      latestChange: brief.changed[0] ?? "当前 source snapshot 没有新的语义变化。",
      nextDecision: request?.question ?? "当前没有需要人类处理的决策。",
    },
    l1: {
      whyNow: brief.whyNow,
      pain: hps.pains.map((pain) => ({
        id: pain.id,
        statement: pain.statement,
        status: pain.status,
        remainingGap: pain.remainingGap,
      })),
      design: brief.designPoint,
      changed: [...brief.changed],
      verified: [...brief.machineVerified],
      notVerified: [...brief.machineNotVerified],
      remaining: [...brief.remaining],
      next: brief.next,
      risks: [...brief.risks],
    },
    l2: {
      nodes: semanticNodes(projection),
      links: projection.traces.map((trace) => ({
        id: trace.linkId,
        from: trace.from.id,
        to: trace.to.id,
        relation: trace.relation,
      })),
    },
    l3: {
      machineResult: result,
      summary: hps.evidenceSummary,
    },
    l4: {
      sources: [...hps.sourceSnapshot],
      evidence: machineEvidence(result),
      traceLinks: [...projection.traces],
    },
    decision: request
      ? {
          requestId: request.requestId,
          requestDigest: request.requestDigest,
          category: request.category,
          decisionUnit: request.decisionUnit,
          question: request.question,
          facts: request.facts,
          options: request.options,
          recommendation: request.recommendation,
          safeDefault: request.safeDefault,
          sourceDigest: projection.sourceDigest,
        }
      : null,
    meta: {
      adapter: requireString(projection.adapter, "projection.adapter"),
      projectionId: hps.projectionId,
      briefId: brief.briefId,
      sourceDigest: projection.sourceDigest,
      rendererVersion: TALK_RENDERER_VERSION,
      outbox: summarizeOutbox(restoredOutbox),
      authorityBoundary: "read-only projection; decisions become session candidates only",
    },
  };
  validateTalkContent(content);
  return content;
}

export function validateTalkContent(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new TalkContentError("talk content must be an object");
  }
  if (content.kind !== "hpi-project") throw new TalkContentError("talk content kind must equal hpi-project");
  if (content.schema !== SCHEMAS.talk) throw new TalkContentError(`talk schema must equal ${SCHEMAS.talk}`);
  if (Object.hasOwn(content, "overallStatus")) {
    throw new TalkContentError("overallStatus is forbidden; machine and human status must stay separate");
  }
  requireString(content.project?.id, "project.id");
  requireString(content.project?.phase, "project.phase");
  if (!MACHINE_VERDICTS.includes(content.status?.machine)) {
    throw new TalkContentError("status.machine is invalid");
  }
  if (!HUMAN_STATUSES.includes(content.status?.human)) {
    throw new TalkContentError("status.human is invalid");
  }
  for (const key of ["intent", "current", "latestChange", "nextDecision"]) {
    requireString(content.l0?.[key], `l0.${key}`);
  }
  for (const key of ["pain", "changed", "verified", "notVerified", "remaining", "risks"]) {
    requireArray(content.l1?.[key], `l1.${key}`);
  }
  requireString(content.l1?.whyNow, "l1.whyNow");
  requireString(content.l1?.design, "l1.design");
  requireArray(content.l2?.nodes, "l2.nodes");
  requireArray(content.l2?.links, "l2.links");
  requireArray(content.l4?.sources, "l4.sources");
  requireArray(content.l4?.evidence, "l4.evidence");
  requireArray(content.l4?.traceLinks, "l4.traceLinks");
  requireString(content.meta?.adapter, "meta.adapter");
  requireString(content.meta?.projectionId, "meta.projectionId");
  requireString(content.meta?.briefId, "meta.briefId");
  requireString(content.meta?.sourceDigest, "meta.sourceDigest");
  requireString(content.meta?.rendererVersion, "meta.rendererVersion");
  if (content.status.machine === "NOT-RUN") {
    const visible = content.l1.notVerified.some((line) => typeof line === "string" && line.includes("NOT-RUN"));
    if (!visible) throw new TalkContentError("NOT-RUN must remain visible in l1.notVerified");
  }
  if (content.decision) {
    requireString(content.decision.requestId, "decision.requestId");
    requireString(content.decision.requestDigest, "decision.requestDigest");
    requireString(content.decision.sourceDigest, "decision.sourceDigest");
    requireString(content.decision.question, "decision.question");
    requireArray(content.decision.options, "decision.options");
    if (content.decision.options.length < 2) throw new TalkContentError("decision needs at least two options");
  }
  return content;
}

export function serializeTalkContent(projection, options) {
  return JSON.stringify(buildTalkContent(projection, options));
}
