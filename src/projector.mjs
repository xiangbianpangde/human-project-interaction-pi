import {
  HUMAN_STATUSES,
  MACHINE_VERDICTS,
  SCHEMAS,
  contentId,
  sha256,
  validateHps,
  validateHumanBrief,
  validateMachineResult,
  validateSourceRef,
  validateTraceLink,
} from "./contracts.mjs";
import { loadTs001Pilot } from "./adapter.mjs";
import { validateNormalizedSourceEnvelope } from "./adapters/contract.mjs";
import { loadProjectSource } from "./adapters/registry.mjs";

export const PROJECTOR_VERSION = "hpi-projector/0.1.0";

export class ProjectionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProjectionError";
    this.details = details;
  }
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new ProjectionError(`${name} must be an array`);
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProjectionError(`${name} must be a non-empty string`);
  }
  return value;
}

function logicalRef(id, revision, value, pointer) {
  const ref = {
    id,
    revision,
    sha256: sha256(value),
    pointer,
  };
  validateSourceRef(ref);
  return ref;
}

function uniqueSourceRefs(refs) {
  const byKey = new Map();
  for (const ref of refs) {
    validateSourceRef(ref);
    byKey.set(`${ref.id}@${ref.revision}:${ref.sha256 ?? ""}`, ref);
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.id}@${left.revision}`.localeCompare(`${right.id}@${right.revision}`),
  );
}

function validateNormalizedSource(source) {
  try {
    validateNormalizedSourceEnvelope(source);
  } catch (error) {
    throw new ProjectionError(error instanceof Error ? error.message : String(error), { cause: error });
  }
  requireString(source.adapter, "source.adapter");
  requireString(source.projectId, "source.projectId");
  requireString(source.projectTitle, "source.projectTitle");
  requireString(source.brief?.headline, "source.brief.headline");
  requireString(source.brief?.next?.statement, "source.brief.next.statement");
  requireString(source.brief?.next?.reason, "source.brief.next.reason");
  const snapshot = requireArray(source.sourceSnapshot, "source.sourceSnapshot");
  if (snapshot.length === 0) throw new ProjectionError("source.sourceSnapshot must not be empty");
  snapshot.forEach((ref, index) => validateSourceRef(ref, `source.sourceSnapshot[${index}]`));
  if (!MACHINE_VERDICTS.includes(source.authority?.machineStatus)) {
    throw new ProjectionError("source.authority.machineStatus is invalid");
  }
  if (!HUMAN_STATUSES.includes(source.authority?.humanStatus)) {
    throw new ProjectionError("source.authority.humanStatus is invalid");
  }
  validateSourceRef(source.intent?.sourceRef, "source.intent.sourceRef");
  requireString(source.intent?.statement, "source.intent.statement");

  const pains = requireArray(source.pains, "source.pains");
  const painIds = new Set(pains.map((pain) => pain.id));
  const designs = requireArray(source.designPoints, "source.designPoints");
  const designIds = new Set(designs.map((design) => design.id));
  requireArray(source.machineResults, "source.machineResults").forEach((result, index) =>
    validateMachineResult(result, `source.machineResults[${index}]`),
  );

  requireArray(source.activeWork, "source.activeWork").forEach((work, index) => {
    const path = `source.activeWork[${index}]`;
    requireString(work.taskId, `${path}.taskId`);
    const workPainRefs = requireArray(work.painRefs, `${path}.painRefs`);
    const workDesignRefs = requireArray(work.designRefs, `${path}.designRefs`);
    if (workPainRefs.length === 0 && workDesignRefs.length === 0) {
      throw new ProjectionError(`${path} is orphaned: a TaskSlice needs a Pain or Design association`);
    }
    for (const id of workPainRefs) {
      if (!painIds.has(id)) throw new ProjectionError(`${path}.painRefs contains unknown id ${id}`);
    }
    for (const id of workDesignRefs) {
      if (!designIds.has(id)) throw new ProjectionError(`${path}.designRefs contains unknown id ${id}`);
    }
  });
  return source;
}

function buildTraceLinks(source) {
  const pains = new Map(source.pains.map((pain) => [pain.id, pain]));
  const designs = new Map(source.designPoints.map((design) => [design.id, design]));
  const resultsByTask = new Map(source.machineResults.map((result) => [result.taskId, result]));
  const links = [];

  for (const work of source.activeWork) {
    const taskRef = logicalRef(
      work.taskId,
      source.sourceDigest.slice(0, 16),
      work,
      `derived:active-work/${work.taskId}`,
    );
    for (const painId of work.painRefs) {
      const pain = pains.get(painId);
      const painRef = logicalRef(pain.id, pain.sourceRef.revision, pain, `derived:pain/${pain.id}`);
      const base = {
        schema: SCHEMAS.traceLink,
        from: painRef,
        to: taskRef,
        relation: "motivates",
        sourceRef: pain.sourceRef,
      };
      const link = { ...base, linkId: contentId("TL", base) };
      validateTraceLink(link);
      links.push(link);
    }
    for (const designId of work.designRefs) {
      const design = designs.get(designId);
      const designRef = logicalRef(
        design.id,
        design.sourceRef.revision,
        design,
        `derived:design/${design.id}`,
      );
      const base = {
        schema: SCHEMAS.traceLink,
        from: taskRef,
        to: designRef,
        relation: "implements",
        sourceRef: design.sourceRef,
      };
      const link = { ...base, linkId: contentId("TL", base) };
      validateTraceLink(link);
      links.push(link);
    }
    const result = resultsByTask.get(work.taskId);
    if (result) {
      const resultRef = logicalRef(
        result.resultId,
        result.attemptId,
        result,
        `derived:machine-result/${result.resultId}`,
      );
      const base = {
        schema: SCHEMAS.traceLink,
        from: resultRef,
        to: taskRef,
        relation: "derives",
        sourceRef: result.sourceRef,
      };
      const link = { ...base, linkId: contentId("TL", base) };
      validateTraceLink(link);
      links.push(link);
    }
  }
  return links.sort((left, right) => left.linkId.localeCompare(right.linkId));
}

function derivePhase(source) {
  if (source.authority.machineStatus === "BLOCKED") return "BLOCKED";
  if (source.authority.machineStatus === "DEVIATIONS_FOUND") return "RECOVERY";
  if (source.authority.humanStatus === "HUMAN_PENDING" && source.escalationRequests.length > 0) {
    return "HUMAN_DECISION_PENDING";
  }
  if (source.authority.machineStatus === "RUNNING") return "EXECUTING";
  if (source.authority.machineStatus === "NOT-RUN" || source.authority.machineStatus === "INCOMPLETE") {
    return "MACHINE_VALIDATION";
  }
  if (source.authority.machineStatus === "PASS-ENGINEERING" && source.authority.humanStatus === "NOT_NEEDED") {
    return "SOLVED_PENDING_CONFIRMATION";
  }
  return "ORIENTING";
}

function evidenceSummary(source) {
  const summary = { verified: 0, selfReported: 0, notRun: 0, incomplete: 0 };
  for (const result of source.machineResults) {
    for (const fact of result.facts) {
      if (fact.status === "VERIFIED") summary.verified += 1;
      else if (fact.status === "SELF_REPORTED") summary.selfReported += 1;
      else if (fact.status === "NOT_RUN") summary.notRun += 1;
      else if (fact.status === "INCOMPLETE" || fact.status === "FAILED") summary.incomplete += 1;
    }
  }
  return summary;
}

function buildHps(source, traces) {
  const draft = {
    schema: SCHEMAS.hps,
    projectId: source.projectId,
    projectorVersion: PROJECTOR_VERSION,
    sourceSnapshot: uniqueSourceRefs(source.sourceSnapshot),
    sourceDigest: source.sourceDigest,
    phase: derivePhase(source),
    intent: source.intent,
    pains: source.pains.map((pain) => ({
      id: pain.id,
      statement: pain.statement,
      status: pain.status,
      remainingGap: pain.remainingGap,
      sourceRef: pain.sourceRef,
    })),
    activeWork: source.activeWork.map((work) => ({
      taskId: work.taskId,
      whyNow: work.whyNow,
      machineStatus: work.machineStatus,
      humanStatus: work.humanStatus,
      latestChange: work.latestChange,
      resultRef: work.resultRef,
    })),
    changesSinceLastSeen: source.activeWork.map((work) => work.latestChange),
    unresolved: source.unresolved,
    risks: [...source.risks],
    decisionRequestIds: source.escalationRequests.map((request) => request.requestId),
    evidenceSummary: evidenceSummary(source),
    traceLinkIds: traces.map((trace) => trace.linkId),
  };
  const projectionId = sha256({
    projectorVersion: PROJECTOR_VERSION,
    sourceSnapshot: draft.sourceSnapshot,
    normalizedProjection: draft,
  });
  const hps = {
    schema: draft.schema,
    projectId: draft.projectId,
    projectionId,
    projectorVersion: draft.projectorVersion,
    sourceSnapshot: draft.sourceSnapshot,
    sourceDigest: draft.sourceDigest,
    phase: draft.phase,
    intent: draft.intent,
    pains: draft.pains,
    activeWork: draft.activeWork,
    changesSinceLastSeen: draft.changesSinceLastSeen,
    unresolved: draft.unresolved,
    risks: draft.risks,
    decisionRequestIds: draft.decisionRequestIds,
    evidenceSummary: draft.evidenceSummary,
    traceLinkIds: draft.traceLinkIds,
  };
  validateHps(hps);
  return hps;
}

function factLine(fact) {
  const prefix = {
    VERIFIED: "[已验证]",
    FAILED: "[失败]",
    NOT_RUN: "[NOT-RUN]",
    INCOMPLETE: "[证据不完整]",
    SELF_REPORTED: "[Agent 自报·未验证]",
  }[fact.status];
  return `${prefix} ${fact.statement}`;
}

function buildHumanBrief(source, hps, traces) {
  const task = source.activeWork[0];
  if (!task) throw new ProjectionError("a Human Brief requires at least one active TaskSlice");
  const result = source.machineResults.find((entry) => entry.taskId === task.taskId);
  if (!result) throw new ProjectionError(`no MachineResult found for ${task.taskId}`);
  const request = source.escalationRequests[0];
  const verified = result.facts.filter((fact) => fact.status === "VERIFIED").map(factLine);
  const notVerified = result.facts.filter((fact) => fact.status !== "VERIFIED").map(factLine);
  if (result.verdict === "NOT-RUN" && !notVerified.some((line) => line.includes("NOT-RUN"))) {
    notVerified.unshift("[NOT-RUN] 当前切片没有可用运行证据。");
  }
  const evidenceRefs = uniqueSourceRefs(result.facts.flatMap((fact) => fact.evidenceRefs));
  const remaining = [
    ...source.unresolved.map((item) => item.statement),
    ...source.outOfScope.map((item) => `明确未完成：${item}`),
  ];
  const draft = {
    schema: SCHEMAS.humanBrief,
    projectId: source.projectId,
    subjectRef: result.sourceRef,
    hpsProjectionId: hps.projectionId,
    headline: source.brief.headline,
    whyNow: task.whyNow,
    painRefs: [...task.painRefs],
    designPoint: source.designPoints.map((design) => design.statement).join("；"),
    changed: [...hps.changesSinceLastSeen],
    machineVerified: verified,
    machineNotVerified: notVerified,
    remaining,
    next: source.brief.next,
    decisionRequestId: request?.requestId,
    risks: [...source.risks],
    drillDown: {
      traceLinkIds: traces.map((trace) => trace.linkId),
      evidenceRefs,
      sourceRefs: uniqueSourceRefs(source.sourceSnapshot),
    },
  };
  const briefId = contentId("HB", draft);
  const brief = {
    schema: draft.schema,
    briefId,
    projectId: draft.projectId,
    subjectRef: draft.subjectRef,
    hpsProjectionId: draft.hpsProjectionId,
    headline: draft.headline,
    whyNow: draft.whyNow,
    painRefs: draft.painRefs,
    designPoint: draft.designPoint,
    changed: draft.changed,
    machineVerified: draft.machineVerified,
    machineNotVerified: draft.machineNotVerified,
    remaining: draft.remaining,
    next: draft.next,
    ...(draft.decisionRequestId ? { decisionRequestId: draft.decisionRequestId } : {}),
    risks: draft.risks,
    drillDown: draft.drillDown,
  };
  validateHumanBrief(brief);
  return brief;
}

export function projectSource(normalizedSource) {
  const source = validateNormalizedSource(normalizedSource);
  const traces = buildTraceLinks(source);
  const hps = buildHps(source, traces);
  const brief = buildHumanBrief(source, hps, traces);
  return {
    schema: "hpi/projection-bundle/v1",
    adapter: source.adapter,
    projectId: source.projectId,
    projectTitle: source.projectTitle,
    sourceDigest: source.sourceDigest,
    hps,
    briefs: [brief],
    traces,
    machineResults: source.machineResults,
    escalationRequests: source.escalationRequests,
    outOfScope: [...source.outOfScope],
  };
}

export function rebuildProjectProjection(projectRoot, options = {}) {
  return projectSource(loadProjectSource(projectRoot, options));
}

export function rebuildTs001Projection(projectRoot, options = {}) {
  return projectSource(loadTs001Pilot(projectRoot, options));
}
