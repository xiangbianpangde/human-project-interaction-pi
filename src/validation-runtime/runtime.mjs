import { randomUUID } from "node:crypto";

import { frozenIdentityKey } from "../execution/contract.mjs";
import {
  VALIDATION_ATTEMPT_RECORD_SCHEMA,
  VALIDATION_AUTHORITY,
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
import { resolveValidationMachineResultForCurrentBase } from "./projection.mjs";
import {
  buildCanonicalValidationMachineResult,
  canonicalDeclaredValidationGateOutcomes,
  canonicalizePersistedValidationGateOutcomes,
} from "./semantics.mjs";

export const VALIDATION_RUNTIME_RESULT_SCHEMA = "hpi/validation-runtime-result/v1";

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

function currentMachineResultView(projectRoot, history) {
  if (!history.machineResult) {
    return {
      machineResult: null,
      currentBaseAvailable: true,
      currentBaseDrifted: false,
    };
  }
  try {
    const resolved = resolveValidationMachineResultForCurrentBase(projectRoot, history);
    return {
      machineResult: resolved.validationMachineResult,
      historicalMachineResult: resolved.historicalMachineResult,
      currentBaseAvailable: true,
      currentBaseDrifted: resolved.currentBaseDrifted,
    };
  } catch (error) {
    return {
      machineResult: null,
      historicalMachineResult: history.machineResult,
      currentBaseAvailable: false,
      currentBaseDrifted: true,
      currentBaseError: error instanceof Error ? error.message : String(error),
    };
  }
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
            ...currentMachineResultView(projectRoot, existing),
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
        ...currentMachineResultView(projectRoot, existing),
      });
    }

    const gates = evaluateValidationAttemptGates(projectRoot, intake);
    const inputRef = publishValidationInputSnapshot(projectRoot, attemptId, intake.rawBytes);
    const persistedGateOutcomes = canonicalizePersistedValidationGateOutcomes(
      intake.input,
      inputRef,
      gates.gateOutcomes,
    );
    const declared = publishValidationRecord(projectRoot, recordDraft({
      input: intake.input,
      inputRef,
      sequence: 0,
      phase: "DECLARED",
      gateOutcomes: canonicalDeclaredValidationGateOutcomes(intake.input, inputRef),
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
    const terminalGateOutcomes = canonicalizePersistedValidationGateOutcomes(
      intake.input,
      inputRef,
      finalGates.gateOutcomes,
    );
    const machineResult = buildCanonicalValidationMachineResult(
      intake.input,
      running.ref,
      terminalGateOutcomes,
    );
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
      ...currentMachineResultView(projectRoot, history),
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
    ...currentMachineResultView(projectRoot, history),
    projectCanonicalChanged: false,
  };
}
