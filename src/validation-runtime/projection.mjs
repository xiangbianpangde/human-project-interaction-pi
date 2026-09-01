import { loadTs001Pilot } from "../adapter.mjs";
import {
  NORMALIZED_SOURCE_SCHEMA,
  computeSourceDigest,
  validateNormalizedSourceEnvelope,
} from "../adapters/contract.mjs";
import { SCHEMAS, validateMachineResult } from "../contracts.mjs";
import { projectSource } from "../projector.mjs";
import { reevaluateStoredValidationAttemptGates } from "./intake.mjs";
import { readValidationAttemptHistory } from "./store.mjs";

export const VALIDATION_PROJECTION_ADAPTER = "ts001-validation-runtime/0.1.0";

export class ValidationRuntimeProjectionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ValidationRuntimeProjectionError";
    this.details = details;
  }
}

function fail(message, details) {
  throw new ValidationRuntimeProjectionError(message, details);
}

function latestEvidenceRef(history) {
  return history.recordRefs.at(-1) ?? history.inputRef;
}

function syntheticMachineResult(history) {
  const sourceRef = latestEvidenceRef(history);
  if (!sourceRef) fail(`validation attempt ${history.attemptId} has no immutable evidence to project`);
  const rejected = history.terminal?.outcome === "INPUT_REJECTED";
  const blocked = history.locked;
  const machineResult = {
    schema: SCHEMAS.machineResult,
    resultId: `MR-VRS1-${history.attemptId}-${rejected ? "REJECTED" : blocked ? "LOCKED" : "INTERRUPTED"}`,
    taskId: `VRS1-${history.attemptId}`,
    attemptId: history.attemptId,
    sourceRef,
    verdict: blocked ? "BLOCKED" : "INCOMPLETE",
    facts: [
      {
        id: `FACT-${history.attemptId}-ATTEMPT-STATE`,
        kind: "OTHER",
        statement: rejected
          ? "Validation Runtime Slice V1 rejected the declared input before machine validation completed."
          : blocked
            ? "Validation attempt history retains an active or stale lock and cannot be resumed automatically."
            : "Validation attempt history is non-terminal and is treated as interrupted; it is not completion evidence.",
        status: rejected ? "FAILED" : "INCOMPLETE",
        evidenceRefs: [sourceRef],
      },
    ],
    limitations: [
      "No successful terminal MachineResult was committed for this validation attempt.",
      "Non-terminal state is never recovered as completed; retry requires a new attempt ID.",
      "This validation history has no project canonical or HumanResult authority.",
    ],
    unresolved: [
      "Create a new attempt ID and bind retry_of to the latest immutable record after resolving the failure or stale lock.",
      "Formal TS-001 remains NOT-RUN.",
    ],
  };
  validateMachineResult(machineResult);
  return machineResult;
}

function resultMatchesCurrentBase(result, base) {
  const currentByPointer = new Map(base.sourceSnapshot.map((ref) => [ref.pointer, ref]));
  const cited = new Map();
  for (const fact of result.facts) {
    for (const ref of fact.evidenceRefs) {
      if (currentByPointer.has(ref.pointer)) cited.set(ref.pointer, ref);
    }
  }
  if (cited.size !== currentByPointer.size) return false;
  for (const [pointer, current] of currentByPointer) {
    const ref = cited.get(pointer);
    if (
      !ref ||
      ref.id !== current.id ||
      String(ref.revision) !== String(current.revision) ||
      ref.sha256 !== current.sha256
    ) {
      return false;
    }
  }
  return true;
}

function staleMachineResult(history, historicalResult, base) {
  const sourceRef = history.recordRefs.at(-1) ?? historicalResult.sourceRef;
  const machineResult = {
    schema: SCHEMAS.machineResult,
    resultId: `MR-VRS1-${history.attemptId}-STALE`,
    taskId: historicalResult.taskId,
    attemptId: history.attemptId,
    sourceRef,
    verdict: "INCOMPLETE",
    facts: [
      {
        id: `FACT-${history.attemptId}-CURRENT-SOURCE-DRIFT`,
        kind: "HASH",
        statement: "The stored validation result cites a different TS-001 source revision than the current read-only Adapter snapshot.",
        status: "INCOMPLETE",
        evidenceRefs: [sourceRef, ...base.sourceSnapshot],
      },
    ],
    limitations: [
      "The historical attempt remains immutable, but it is not current-state PASS evidence.",
      "V1 does not automatically invalidate canonical state or mutate the historical MachineResult.",
    ],
    unresolved: [
      "Use a new attempt ID and a manifest bound to the current TS-001 source snapshot.",
      "Formal TS-001 remains NOT-RUN.",
    ],
  };
  validateMachineResult(machineResult);
  return machineResult;
}

function validationHeadline(history, result) {
  if (history.terminal?.outcome === "INPUT_REJECTED") {
    return "Validation Runtime Slice V1 输入被机器 Gate 拒绝；正式 TS-001 仍为 NOT-RUN。";
  }
  if (history.kind === "INCOMPLETE_INTERRUPTED") {
    return "Validation Runtime Slice V1 尝试未完成，只能解释为 interrupted；正式 TS-001 仍为 NOT-RUN。";
  }
  if (result.verdict === "PASS-ENGINEERING") {
    return "Validation Runtime Slice V1 的局部机器 Gate 已通过；正式 TS-001 仍为 NOT-RUN。";
  }
  return `Validation Runtime Slice V1 当前为 ${result.verdict}；正式 TS-001 仍为 NOT-RUN。`;
}

function latestChange(history, result) {
  if (history.terminal) {
    return `验证尝试 ${history.attemptId} 已发布 terminal outcome ${history.terminal.outcome}，局部机器 verdict 为 ${result.verdict}。`;
  }
  const phase = history.latest?.phase ?? "SNAPSHOT_ONLY";
  return `验证尝试 ${history.attemptId} 停留在 ${phase}，fresh process 将其解释为 INCOMPLETE_INTERRUPTED。`;
}

function runtimeSourceRefs(history) {
  return [
    ...(history.inputRef ? [history.inputRef] : []),
    ...history.recordRefs,
    ...(history.terminal?.machineResultRef ? [history.terminal.machineResultRef] : []),
  ];
}

export function resolveValidationMachineResultForCurrentBase(projectRoot, history) {
  const base = loadTs001Pilot(projectRoot);
  const historicalMachineResult = history.machineResult ?? syntheticMachineResult(history);
  const currentGateRevalidation = history.machineResult
    ? reevaluateStoredValidationAttemptGates(projectRoot, history)
    : null;
  const currentBaseDrifted = Boolean(
    history.machineResult &&
      (!resultMatchesCurrentBase(history.machineResult, base) || !currentGateRevalidation.accepted),
  );
  const validationMachineResult = currentBaseDrifted
    ? staleMachineResult(history, history.machineResult, base)
    : historicalMachineResult;
  return {
    baseSource: base,
    historicalMachineResult,
    validationMachineResult,
    currentBaseDrifted,
    currentGateRevalidation,
  };
}

export function normalizeValidationAttemptProjection(projectRoot, attemptId) {
  const history = readValidationAttemptHistory(projectRoot, attemptId);
  if (history.kind === "NOT_FOUND" || history.kind === "EMPTY") {
    fail(`validation attempt ${attemptId} has no projectable immutable history`, { history });
  }
  const resolved = resolveValidationMachineResultForCurrentBase(projectRoot, history);
  const base = resolved.baseSource;
  const result = resolved.validationMachineResult;
  const sourceSnapshot = [...base.sourceSnapshot, ...runtimeSourceRefs(history)];
  const sourceDigest = computeSourceDigest(VALIDATION_PROJECTION_ADAPTER, sourceSnapshot);
  const primaryResultRef = history.terminal?.machineResultRef ?? latestEvidenceRef(history);
  const source = {
    schema: NORMALIZED_SOURCE_SCHEMA,
    adapter: VALIDATION_PROJECTION_ADAPTER,
    projectId: base.projectId,
    projectTitle: "Human Project Interaction · Validation Runtime Slice V1",
    sourceSnapshot,
    sourceDigest,
    authority: {
      machineStatus: "INCOMPLETE",
      humanStatus: "NOT_NEEDED",
    },
    brief: {
      headline: validationHeadline(history, result),
      next: {
        statement: history.kind === "TERMINAL"
          ? "保留该局部机器结果；正式 TS-001 另由获授权的独立 Validation Agent 执行。"
          : "不得续跑当前尝试；如需重试，使用新 attempt ID 和精确 retry_of。",
        reason: "验证 ledger 只对自身历史有权威，不能提升正式 TS-001、HumanResult 或 canonical 状态。",
      },
    },
    intent: base.intent,
    pains: base.pains,
    designPoints: base.designPoints,
    activeWork: [
      {
        taskId: result.taskId,
        whyNow: "用最小隔离 runtime 验证 manifest、Gate、append-only record、replay 与恢复语义。",
        painRefs: ["P-HPI-002"],
        designRefs: ["D-HPI-DUAL-STATUS", "D-HPI-PROJECTION"],
        machineStatus: result.verdict,
        humanStatus: "NOT_NEEDED",
        latestChange: latestChange(history, result),
        resultRef: primaryResultRef,
      },
      ...base.activeWork,
    ],
    machineResults: [result, ...base.machineResults],
    escalationRequests: [],
    unresolved: [
      {
        id: `U-VRS1-${attemptId}-FORMAL-TS001`,
        statement: "该 developer/runtime conformance 结果不是正式 TS-001；正式四组验收仍为 NOT-RUN。",
        sourceRef: base.machineResults[0].sourceRef,
      },
      ...base.unresolved,
    ],
    risks: [
      "局部 PASS-ENGINEERING 若脱离 scope/limitations 展示，可能被误读为正式 TS-001 通过。",
      "残留 lock 或 non-terminal history 必须 fail closed，不能自动恢复为完成。",
      "validation ledger 不得被当作 project canonical/current/worklog。",
      ...base.risks,
    ],
    outOfScope: [
      "正式 TS-001 runner 与独立 Validation Agent",
      "HumanResult intake、CandidateEvent intake 与 canonical writer",
      "Agent dispatch、通用 Reconciler 与 project transaction",
      ...base.outOfScope,
    ],
  };
  validateNormalizedSourceEnvelope(source);
  return { source, history, validationMachineResult: result, baseSource: base };
}

export function buildValidationAttemptProjection(projectRoot, attemptId) {
  const normalized = normalizeValidationAttemptProjection(projectRoot, attemptId);
  return {
    ...normalized,
    projection: projectSource(normalized.source),
  };
}
