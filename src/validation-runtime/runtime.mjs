import { randomUUID } from "node:crypto";

import { SCHEMAS, validateMachineResult } from "../contracts.mjs";
import { frozenIdentityKey } from "../execution/contract.mjs";
import {
  VALIDATION_ATTEMPT_RECORD_SCHEMA,
  VALIDATION_AUTHORITY,
  VALIDATION_GATES,
  VALIDATION_RUNTIME_VERSION,
} from "./contract.mjs";
import {
  evaluateValidationAttemptGates,
  readValidationAttemptInput,
} from "./intake.mjs";
import {
  acquireValidationAttemptLock,
  publishValidationInputSnapshot,
  publishValidationMachineResult,
  publishValidationRecord,
  readValidationAttemptHistory,
} from "./store.mjs";
import {
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
} from "../wire-schema.mjs";

export const VALIDATION_RUNTIME_RESULT_SCHEMA = "hpi/validation-runtime-result/v1";

const GATE_FACT_KIND = Object.freeze({
  V1_SCHEMA: "OTHER",
  V1_IDENTITY: "REFERENCE",
  V1_REFERENCE: "REFERENCE",
  V1_WORKSPACE: "PERMISSION",
  V1_AUTHORITY: "PERMISSION",
});

const GATE_STATEMENT = Object.freeze({
  V1_SCHEMA: "The declared ValidationAttemptInput matched validation-runtime-v1 schema and companion rules.",
  V1_IDENTITY: "The attempt identity matched the closed TS-001 adapter authority set and retry rules.",
  V1_REFERENCE: "Every declared Task/contract/input ref resolved to bounded regular raw bytes with the declared SHA-256.",
  V1_WORKSPACE: "The read set remained closed, the write root remained attempt-isolated, and network stayed denied.",
  V1_AUTHORITY: "Validation authority forbade canonical, semantic, HumanResult, CandidateEvent, dispatch, and invalidation writes.",
});

export class ValidationRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ValidationRuntimeError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ValidationRuntimeError(code, message, details);
}

export function validationRuntimeIdentity() {
  return {
    runtimeId: "hpi-validation-runtime",
    runtimeVersion: VALIDATION_RUNTIME_VERSION.split("/").at(-1),
    schemaSet: VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
    schemaSetDigest: VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
  };
}

function nowFrom(options) {
  const value = (options.now ?? (() => new Date().toISOString()))();
  if (typeof value !== "string") fail("RUNTIME_CLOCK", "clock must return an RFC3339 string");
  return value;
}

function recordDraft({ input, inputRef, sequence, phase, gateOutcomes, recordedAt, previousRecordRef, outcome = "NONE", machineResultRef }) {
  return {
    schema: VALIDATION_ATTEMPT_RECORD_SCHEMA,
    recordId: `VRR-${input.validationAttemptId}-${sequence}`,
    recordRevision: "0".repeat(64),
    validationAttemptId: input.validationAttemptId,
    sequence,
    phase,
    outcome,
    inputRef,
    runtime: validationRuntimeIdentity(),
    authority: VALIDATION_AUTHORITY,
    gateOutcomes,
    ...(machineResultRef === undefined ? {} : { machineResultRef }),
    ...(previousRecordRef === undefined ? {} : { previousRecordRef }),
    recordedAt,
  };
}

function replaceManifestEvidence(gateOutcomes, manifestRef, inputRef) {
  const manifestKey = frozenIdentityKey(manifestRef);
  return gateOutcomes.map((outcome) => ({
    ...outcome,
    evidenceRefs: outcome.evidenceRefs.map((ref) =>
      frozenIdentityKey(ref) === manifestKey ? inputRef : ref,
    ),
  }));
}

function declaredGateOutcomes(inputRef) {
  return VALIDATION_GATES.map((gateName, index) => ({
    gate: gateName,
    status: index === 0 ? "PASSED" : "NOT_RUN",
    code: index === 0 ? "SCHEMA_VALIDATED" : "NOT_RUN_AT_DECLARATION",
    evidenceRefs: index === 0 ? [inputRef] : [],
  }));
}

function gateFactStatus(status) {
  if (status === "PASSED") return "VERIFIED";
  if (status === "FAILED") return "FAILED";
  return "NOT_RUN";
}

function buildMachineResult(input, runningRecordRef, gateOutcomes) {
  const allPassed = gateOutcomes.every((outcome) => outcome.status === "PASSED");
  const facts = gateOutcomes.map((outcome) => ({
    id: `FACT-${input.validationAttemptId}-${outcome.gate}`,
    kind: GATE_FACT_KIND[outcome.gate],
    statement: `${GATE_STATEMENT[outcome.gate]} [${outcome.code}]`,
    status: gateFactStatus(outcome.status),
    evidenceRefs: outcome.status === "PASSED"
      ? [...outcome.evidenceRefs, runningRecordRef]
      : [...outcome.evidenceRefs],
  }));
  const machineResult = {
    schema: SCHEMAS.machineResult,
    resultId: `MR-VRS1-${input.validationAttemptId}`,
    taskId: `VRS1-${input.validationAttemptId}`,
    attemptId: input.validationAttemptId,
    sourceRef: runningRecordRef,
    verdict: allPassed ? "PASS-ENGINEERING" : "INCOMPLETE",
    facts,
    limitations: [
      "This verdict is scoped only to one Validation Runtime Slice V1 attempt.",
      "This is developer/runtime conformance evidence, not a formal TS-001 execution.",
      "No independent Validation Agent, Agent dispatch, HumanResult intake, or canonical writer participated.",
      "The isolated validation ledger has authority only over its own attempt history.",
    ],
    unresolved: [
      "Formal TS-001 remains NOT-RUN until an authorized independent Validation Agent executes it.",
      "HumanResult intake and protected canonical writing remain out of scope.",
    ],
  };
  validateMachineResult(machineResult);
  return machineResult;
}

function sameInputIdentity(left, right) {
  return frozenIdentityKey(left) === frozenIdentityKey(right);
}

function unlocked(history) {
  return { ...history, locked: false };
}

function result(kind, intake, extras = {}) {
  return {
    schema: VALIDATION_RUNTIME_RESULT_SCHEMA,
    kind,
    attemptId: intake.input.validationAttemptId,
    inputRevision: intake.input.inputRevision,
    inputDigest: intake.input.inputDigest,
    authority: VALIDATION_AUTHORITY,
    projectCanonicalChanged: false,
    ...extras,
  };
}

function shouldStop(options, phase) {
  return options.testOnlyStopAfterPhase === phase;
}

export function runValidationAttempt(projectRoot, manifestPointer, options = {}) {
  const intake = readValidationAttemptInput(projectRoot, manifestPointer);
  const attemptId = intake.input.validationAttemptId;
  const lock = acquireValidationAttemptLock(projectRoot, attemptId, {
    invocation_id: options.invocationId ?? randomUUID(),
    manifest_pointer: manifestPointer,
    input_revision: intake.input.inputRevision,
  });
  let appendedRecords = 0;
  let lastRecordedAt;
  const nextRecordedAt = () => {
    const current = nowFrom(options);
    if (lastRecordedAt !== undefined && Date.parse(current) < Date.parse(lastRecordedAt)) {
      fail("RUNTIME_CLOCK_REGRESSION", "record clock must not move backwards within one attempt");
    }
    lastRecordedAt = current;
    return current;
  };
  try {
    const existing = readValidationAttemptHistory(projectRoot, attemptId);
    if (existing.kind !== "EMPTY") {
      if (existing.inputRef && sameInputIdentity(existing.inputRef, intake.manifestRef)) {
        if (existing.kind === "TERMINAL") {
          return result("EXACT_REPLAY", intake, {
            replay: true,
            appendedRecords: 0,
            wroteImmutableState: false,
            history: unlocked(existing),
            machineResult: existing.machineResult,
          });
        }
        return result("INCOMPLETE_INTERRUPTED", intake, {
          replay: false,
          appendedRecords: 0,
          wroteImmutableState: false,
          history: unlocked(existing),
          machineResult: null,
          next: "Create a new attempt ID with retry_of bound to the latest prior record.",
        });
      }
      return result("BLOCKED_CONFLICT", intake, {
        replay: false,
        appendedRecords: 0,
        wroteImmutableState: false,
        conflict: {
          code: "ATTEMPT_IDENTITY_CONFLICT",
          storedInputRef: existing.inputRef,
          candidateInputRef: intake.manifestRef,
        },
        history: unlocked(existing),
        machineResult: existing.machineResult,
      });
    }

    const gates = evaluateValidationAttemptGates(projectRoot, intake);
    const inputRef = publishValidationInputSnapshot(projectRoot, attemptId, intake.rawBytes);
    const persistedGateOutcomes = replaceManifestEvidence(
      gates.gateOutcomes,
      intake.manifestRef,
      inputRef,
    );
    const declared = publishValidationRecord(projectRoot, recordDraft({
      input: intake.input,
      inputRef,
      sequence: 0,
      phase: "DECLARED",
      gateOutcomes: declaredGateOutcomes(inputRef),
      recordedAt: nextRecordedAt(),
    }));
    appendedRecords += 1;
    if (shouldStop(options, "DECLARED")) {
      return result("INCOMPLETE_INTERRUPTED", intake, {
        replay: false,
        appendedRecords,
        wroteImmutableState: true,
        history: unlocked(readValidationAttemptHistory(projectRoot, attemptId)),
        machineResult: null,
      });
    }

    if (!gates.accepted) {
      const terminal = publishValidationRecord(projectRoot, recordDraft({
        input: intake.input,
        inputRef,
        sequence: 1,
        phase: "TERMINAL",
        outcome: "INPUT_REJECTED",
        gateOutcomes: persistedGateOutcomes,
        previousRecordRef: declared.ref,
        recordedAt: nextRecordedAt(),
      }));
      appendedRecords += 1;
      return result("INPUT_REJECTED", intake, {
        replay: false,
        appendedRecords,
        wroteImmutableState: true,
        gates: { ...gates, gateOutcomes: persistedGateOutcomes, baseSource: undefined },
        history: unlocked(readValidationAttemptHistory(projectRoot, attemptId)),
        machineResult: null,
      });
    }

    const accepted = publishValidationRecord(projectRoot, recordDraft({
      input: intake.input,
      inputRef,
      sequence: 1,
      phase: "ACCEPTED",
      gateOutcomes: persistedGateOutcomes,
      previousRecordRef: declared.ref,
      recordedAt: nextRecordedAt(),
    }));
    appendedRecords += 1;
    if (shouldStop(options, "ACCEPTED")) {
      return result("INCOMPLETE_INTERRUPTED", intake, {
        replay: false,
        appendedRecords,
        wroteImmutableState: true,
        history: unlocked(readValidationAttemptHistory(projectRoot, attemptId)),
        machineResult: null,
      });
    }

    const running = publishValidationRecord(projectRoot, recordDraft({
      input: intake.input,
      inputRef,
      sequence: 2,
      phase: "RUNNING",
      gateOutcomes: persistedGateOutcomes,
      previousRecordRef: accepted.ref,
      recordedAt: nextRecordedAt(),
    }));
    appendedRecords += 1;
    if (shouldStop(options, "RUNNING")) {
      return result("INCOMPLETE_INTERRUPTED", intake, {
        replay: false,
        appendedRecords,
        wroteImmutableState: true,
        history: unlocked(readValidationAttemptHistory(projectRoot, attemptId)),
        machineResult: null,
      });
    }

    const finalGates = evaluateValidationAttemptGates(projectRoot, intake);
    const terminalGateOutcomes = replaceManifestEvidence(
      finalGates.gateOutcomes,
      intake.manifestRef,
      inputRef,
    );
    const machineResult = buildMachineResult(intake.input, running.ref, terminalGateOutcomes);
    const machineResultSnapshot = publishValidationMachineResult(projectRoot, attemptId, machineResult);
    const terminal = publishValidationRecord(projectRoot, recordDraft({
      input: intake.input,
      inputRef,
      sequence: 3,
      phase: "TERMINAL",
      outcome: "MACHINE_RESULT_PRODUCED",
      gateOutcomes: terminalGateOutcomes,
      machineResultRef: machineResultSnapshot.ref,
      previousRecordRef: running.ref,
      recordedAt: nextRecordedAt(),
    }));
    appendedRecords += 1;
    const history = readValidationAttemptHistory(projectRoot, attemptId);
    return result("MACHINE_RESULT_PRODUCED", intake, {
      replay: false,
      appendedRecords,
      wroteImmutableState: true,
      gates: { ...finalGates, gateOutcomes: terminalGateOutcomes, baseSource: undefined },
      history: unlocked(history),
      machineResult: history.machineResult,
    });
  } finally {
    lock.release();
  }
}

export function getValidationAttemptStatus(projectRoot, attemptId) {
  const history = readValidationAttemptHistory(projectRoot, attemptId);
  return {
    schema: "hpi/validation-attempt-status/v1",
    attemptId,
    authority: VALIDATION_AUTHORITY,
    history,
    projectCanonicalChanged: false,
  };
}
