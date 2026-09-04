import { SCHEMAS, sha256, validateMachineResult } from "../contracts.mjs";
import { frozenIdentityKey } from "../execution/contract.mjs";
import { VALIDATION_GATES } from "./contract.mjs";

export const VALIDATION_GATE_SUCCESS_CODE = Object.freeze({
  V1_SCHEMA: "SCHEMA_VALIDATED",
  V1_IDENTITY: "IDENTITY_VALIDATED",
  V1_REFERENCE: "REFERENCES_VERIFIED",
  V1_WORKSPACE: "WORKSPACE_VERIFIED",
  V1_AUTHORITY: "AUTHORITY_VERIFIED",
});

export const VALIDATION_GATE_FAILURE_CODE = Object.freeze({
  V1_SCHEMA: "SCHEMA_REJECTED",
  V1_IDENTITY: "IDENTITY_REJECTED",
  V1_REFERENCE: "REFERENCES_REJECTED",
  V1_WORKSPACE: "WORKSPACE_REJECTED",
  V1_AUTHORITY: "AUTHORITY_REJECTED",
});

export const VALIDATION_GATE_FACT_KIND = Object.freeze({
  V1_SCHEMA: "OTHER",
  V1_IDENTITY: "REFERENCE",
  V1_REFERENCE: "REFERENCE",
  V1_WORKSPACE: "PERMISSION",
  V1_AUTHORITY: "PERMISSION",
});

export const VALIDATION_GATE_STATEMENT = Object.freeze({
  V1_SCHEMA: "The declared ValidationAttemptInput matched validation-runtime-v1 schema and companion rules.",
  V1_IDENTITY: "The attempt identity matched the closed TS-001 adapter authority set and retry rules.",
  V1_REFERENCE: "Every declared Task/contract/input ref resolved to bounded regular raw bytes with the declared SHA-256.",
  V1_WORKSPACE: "The read set remained closed, the write root remained attempt-isolated, and network stayed denied.",
  V1_AUTHORITY: "Validation authority forbade canonical, semantic, HumanResult, CandidateEvent, dispatch, and invalidation writes.",
});

export class ValidationRuntimeSemanticsError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ValidationRuntimeSemanticsError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ValidationRuntimeSemanticsError(code, message, details);
}

function allInputRefs(input) {
  return [input.taskRef, ...input.contractRefs, ...input.inputRefs];
}

function sortedRefs(refs) {
  return [...refs].toSorted((left, right) =>
    frozenIdentityKey(left).localeCompare(frozenIdentityKey(right)),
  );
}

function expectedEvidenceRefs(gate, input, inputRef) {
  if (gate === "V1_IDENTITY" || gate === "V1_REFERENCE") {
    return sortedRefs(allInputRefs(input));
  }
  return [inputRef];
}

function sameCanonical(left, right) {
  return sha256(left) === sha256(right);
}

function assertExact(value, expected, code, message) {
  if (!sameCanonical(value, expected)) {
    fail(code, message, {
      expectedDigest: sha256(expected),
      actualDigest: sha256(value),
    });
  }
}

function passedOutcome(gate, input, inputRef) {
  return {
    gate,
    status: "PASSED",
    code: VALIDATION_GATE_SUCCESS_CODE[gate],
    evidenceRefs: expectedEvidenceRefs(gate, input, inputRef),
  };
}

export function canonicalDeclaredValidationGateOutcomes(input, inputRef) {
  return VALIDATION_GATES.map((gate, index) => index === 0
    ? passedOutcome(gate, input, inputRef)
    : {
        gate,
        status: "NOT_RUN",
        code: "NOT_RUN_AT_DECLARATION",
        evidenceRefs: [],
      });
}

export function canonicalSuccessfulValidationGateOutcomes(input, inputRef) {
  return VALIDATION_GATES.map((gate) => passedOutcome(gate, input, inputRef));
}

export function canonicalizePersistedValidationGateOutcomes(input, inputRef, gateOutcomes) {
  if (
    gateOutcomes.length !== VALIDATION_GATES.length ||
    gateOutcomes.some((outcome, index) => outcome.gate !== VALIDATION_GATES[index])
  ) {
    fail("GATE_RUNTIME_SURFACE", "runtime Gate outcomes must contain every V1 Gate once in canonical order");
  }
  const firstFailure = gateOutcomes.findIndex((outcome) => outcome.status === "FAILED");
  if (firstFailure < 0) {
    if (gateOutcomes.some((outcome) => outcome.status !== "PASSED")) {
      fail("GATE_RUNTIME_SURFACE", "a failure-free runtime Gate surface must be all PASSED");
    }
    return canonicalSuccessfulValidationGateOutcomes(input, inputRef);
  }
  if (
    gateOutcomes.slice(0, firstFailure).some((outcome) => outcome.status !== "PASSED") ||
    gateOutcomes.slice(firstFailure + 1).some((outcome) => outcome.status !== "NOT_RUN")
  ) {
    fail("GATE_RUNTIME_SURFACE", "a failed runtime Gate must follow only PASSED and precede only NOT_RUN");
  }
  const failedGate = VALIDATION_GATES[firstFailure];
  return VALIDATION_GATES.map((gate, index) => {
    if (index < firstFailure) return passedOutcome(gate, input, inputRef);
    if (index === firstFailure) {
      return {
        gate,
        status: "FAILED",
        code: VALIDATION_GATE_FAILURE_CODE[gate],
        evidenceRefs: expectedEvidenceRefs(gate, input, inputRef),
      };
    }
    return {
      gate,
      status: "NOT_RUN",
      code: `NOT_RUN_AFTER_${failedGate}`,
      evidenceRefs: [],
    };
  });
}

function assertTerminalGateOutcomes(gateOutcomes, input, inputRef) {
  const firstFailure = gateOutcomes.findIndex((outcome) => outcome.status === "FAILED");
  if (firstFailure < 0) {
    assertExact(
      gateOutcomes,
      canonicalSuccessfulValidationGateOutcomes(input, inputRef),
      "GATE_SUCCESS_SEMANTICS",
      "all-PASSED persisted Gate outcomes differ from the canonical V1 success derivation",
    );
    return;
  }
  const failedGate = VALIDATION_GATES[firstFailure];
  gateOutcomes.forEach((outcome, index) => {
    if (index < firstFailure) {
      assertExact(
        outcome,
        passedOutcome(VALIDATION_GATES[index], input, inputRef),
        "GATE_SUCCESS_SEMANTICS",
        `persisted success semantics differ for ${VALIDATION_GATES[index]}`,
      );
      return;
    }
    if (index === firstFailure) {
      const expected = {
        gate: failedGate,
        status: "FAILED",
        code: VALIDATION_GATE_FAILURE_CODE[failedGate],
        evidenceRefs: expectedEvidenceRefs(failedGate, input, inputRef),
      };
      assertExact(
        outcome,
        expected,
        "GATE_FAILURE_EVIDENCE",
        `persisted failure evidence differs for ${failedGate}`,
      );
      return;
    }
    assertExact(
      outcome,
      {
        gate: VALIDATION_GATES[index],
        status: "NOT_RUN",
        code: `NOT_RUN_AFTER_${failedGate}`,
        evidenceRefs: [],
      },
      "GATE_NOT_RUN_SEMANTICS",
      `persisted NOT_RUN semantics differ after ${failedGate}`,
    );
  });
}

export function assertCanonicalValidationRecordSemantics(record, input, inputRef) {
  assertExact(
    record.inputRef,
    inputRef,
    "RECORD_INPUT_SEMANTICS",
    `record ${record.recordId} input_ref differs from the canonical stored input ref`,
  );
  if (record.phase === "DECLARED") {
    assertExact(
      record.gateOutcomes,
      canonicalDeclaredValidationGateOutcomes(input, inputRef),
      "GATE_DECLARATION_SEMANTICS",
      "DECLARED Gate outcomes differ from the canonical V1 declaration",
    );
    return record;
  }
  if (record.phase === "ACCEPTED" || record.phase === "RUNNING") {
    assertExact(
      record.gateOutcomes,
      canonicalSuccessfulValidationGateOutcomes(input, inputRef),
      "GATE_SUCCESS_SEMANTICS",
      `${record.phase} Gate outcomes differ from the canonical V1 success derivation`,
    );
    return record;
  }
  assertTerminalGateOutcomes(record.gateOutcomes, input, inputRef);
  return record;
}

function gateFactStatus(status) {
  if (status === "PASSED") return "VERIFIED";
  if (status === "FAILED") return "FAILED";
  return "NOT_RUN";
}

export function buildCanonicalValidationMachineResult(input, runningRecordRef, gateOutcomes) {
  const allPassed = gateOutcomes.every((outcome) => outcome.status === "PASSED");
  const facts = gateOutcomes.map((outcome) => ({
    id: `FACT-${input.validationAttemptId}-${outcome.gate}`,
    kind: VALIDATION_GATE_FACT_KIND[outcome.gate],
    statement: `${VALIDATION_GATE_STATEMENT[outcome.gate]} [${outcome.code}]`,
    status: gateFactStatus(outcome.status),
    evidenceRefs: sortedRefs(outcome.status === "PASSED"
      ? [...outcome.evidenceRefs, runningRecordRef]
      : [...outcome.evidenceRefs]),
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

export function assertCanonicalValidationMachineResult(machineResult, input, runningRecordRef, gateOutcomes) {
  const expected = buildCanonicalValidationMachineResult(input, runningRecordRef, gateOutcomes);
  assertExact(
    machineResult,
    expected,
    "MACHINE_RESULT_SEMANTICS",
    "stored MachineResult differs from the canonical V1 Gate/fact derivation",
  );
  return machineResult;
}
