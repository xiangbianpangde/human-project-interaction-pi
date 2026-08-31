import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { SCHEMAS } from "../src/contracts.mjs";
import {
  VALIDATION_ATTEMPT_RECORD_SCHEMA,
  VALIDATION_AUTHORITY,
  VALIDATION_GATES,
  VALIDATION_RUNTIME_VERSION,
} from "../src/validation-runtime/contract.mjs";
import {
  acquireValidationAttemptLock,
  inspectValidationStoreBoundary,
  publishValidationInputSnapshot,
  publishValidationMachineResult,
  publishValidationRecord,
  readValidationAttemptHistory,
} from "../src/validation-runtime/store.mjs";
import {
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
} from "../src/wire-schema.mjs";
import {
  buildValidationAttemptFixture,
  validationStoreRoot,
} from "./support/validation-runtime-fixture.mjs";

function temporaryRoot() {
  return mkdtempSync(join(tmpdir(), "hpi-validation-store-"));
}

function runtimeIdentity() {
  return {
    runtimeId: "hpi-validation-runtime",
    runtimeVersion: VALIDATION_RUNTIME_VERSION.split("/").at(-1),
    schemaSet: VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
    schemaSetDigest: VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
  };
}

function gateOutcomes(phase, outcome, inputRef) {
  return VALIDATION_GATES.map((gate, index) => {
    let status = "PASSED";
    if (phase === "DECLARED" && index > 0) status = "NOT_RUN";
    if (phase === "TERMINAL" && outcome === "INPUT_REJECTED") {
      status = index === 0 ? "FAILED" : "NOT_RUN";
    }
    return {
      gate,
      status,
      code: status === "PASSED" ? "TEST_PASSED" : status === "FAILED" ? "TEST_FAILED" : "NOT_RUN",
      evidenceRefs: status === "NOT_RUN" ? [] : [inputRef],
    };
  });
}

function recordDraft({ attemptId, inputRef, sequence, phase, previousRecordRef, outcome = "NONE", machineResultRef }) {
  return {
    schema: VALIDATION_ATTEMPT_RECORD_SCHEMA,
    recordId: `VRR-${attemptId}-${sequence}`,
    recordRevision: "0".repeat(64),
    validationAttemptId: attemptId,
    sequence,
    phase,
    outcome,
    inputRef,
    runtime: runtimeIdentity(),
    authority: VALIDATION_AUTHORITY,
    gateOutcomes: gateOutcomes(phase, outcome, inputRef),
    ...(machineResultRef === undefined ? {} : { machineResultRef }),
    ...(previousRecordRef === undefined ? {} : { previousRecordRef }),
    recordedAt: `2026-08-31T13:00:0${sequence}Z`,
  };
}

function appendRecord(root, state, phase, outcome = "NONE", machineResultRef) {
  const published = publishValidationRecord(root, recordDraft({
    attemptId: state.attemptId,
    inputRef: state.inputRef,
    sequence: state.records.length,
    phase,
    outcome,
    machineResultRef,
    ...(state.previousRef === undefined ? {} : { previousRecordRef: state.previousRef }),
  }));
  state.records.push(published.internal);
  state.previousRef = published.ref;
  return published;
}

function startAttempt(root, attemptId = "VRS1-STORE-001") {
  const fixture = buildValidationAttemptFixture(root, { attemptId });
  const lock = acquireValidationAttemptLock(root, attemptId, { invocation_id: "test-invocation" });
  const inputRef = publishValidationInputSnapshot(root, attemptId, readFileSync(fixture.manifestPath));
  const state = { attemptId, fixture, lock, inputRef, previousRef: undefined, records: [] };
  appendRecord(root, state, "DECLARED");
  return state;
}

function completeAttempt(root, state) {
  appendRecord(root, state, "ACCEPTED");
  appendRecord(root, state, "RUNNING");
  const runningRef = state.previousRef;
  const factKinds = {
    V1_SCHEMA: "OTHER",
    V1_IDENTITY: "REFERENCE",
    V1_REFERENCE: "REFERENCE",
    V1_WORKSPACE: "PERMISSION",
    V1_AUTHORITY: "PERMISSION",
  };
  const machineResult = {
    schema: SCHEMAS.machineResult,
    resultId: `MR-VRS1-${state.attemptId}`,
    taskId: `VRS1-${state.attemptId}`,
    attemptId: state.attemptId,
    sourceRef: runningRef,
    verdict: "PASS-ENGINEERING",
    facts: VALIDATION_GATES.map((gate) => ({
      id: `FACT-${state.attemptId}-${gate}`,
      kind: factKinds[gate],
      statement: `${gate} passed in the isolated store test.`,
      status: "VERIFIED",
      evidenceRefs: [state.inputRef, runningRef],
    })),
    limitations: ["Developer conformance only; not a formal TS-001 result."],
    unresolved: ["Independent Validation Agent has not run formal TS-001."],
  };
  const result = publishValidationMachineResult(root, state.attemptId, machineResult);
  appendRecord(root, state, "TERMINAL", "MACHINE_RESULT_PRODUCED", result.ref);
  return { machineResult, result };
}

describe("isolated validation attempt store", () => {
  it("publishes an immutable chain and classifies non-terminal history as interrupted", () => {
    const root = temporaryRoot();
    try {
      const state = startAttempt(root);
      appendRecord(root, state, "ACCEPTED");
      appendRecord(root, state, "RUNNING");
      state.lock.release();

      const history = readValidationAttemptHistory(root, state.attemptId);
      assert.equal(history.kind, "INCOMPLETE_INTERRUPTED");
      assert.equal(history.interrupted, true);
      assert.equal(history.locked, false);
      assert.deepEqual(history.records.map((record) => record.phase), ["DECLARED", "ACCEPTED", "RUNNING"]);
      assert.equal(history.recordRefs.length, 3);
      assert.equal(history.inputManifest.inputRevision, state.fixture.wire.input_revision);
      assert.equal(history.inputRef.pointer.startsWith(`${state.fixture.wire.isolated_write_root}/input/`), true);
      assert.equal(history.projectCanonicalChanged, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a terminal MachineResult only through its exact immutable record ref", () => {
    const root = temporaryRoot();
    try {
      const state = startAttempt(root, "VRS1-STORE-TERMINAL");
      const completed = completeAttempt(root, state);
      state.lock.release();

      const history = readValidationAttemptHistory(root, state.attemptId);
      assert.equal(history.kind, "TERMINAL");
      assert.equal(history.terminal.outcome, "MACHINE_RESULT_PRODUCED");
      assert.equal(history.machineResult.resultId, completed.machineResult.resultId);
      assert.equal(history.machineResult.verdict, "PASS-ENGINEERING");
      assert.equal(history.uncommittedMachineResultCount, 0);
      assert.equal(history.records.length, 4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a structurally valid PASS result that is not one-fact-per-Gate bound", () => {
    const root = temporaryRoot();
    try {
      const state = startAttempt(root, "VRS1-STORE-FORGED-PASS");
      appendRecord(root, state, "ACCEPTED");
      appendRecord(root, state, "RUNNING");
      const forged = {
        schema: SCHEMAS.machineResult,
        resultId: `MR-VRS1-${state.attemptId}`,
        taskId: `VRS1-${state.attemptId}`,
        attemptId: state.attemptId,
        sourceRef: state.previousRef,
        verdict: "PASS-ENGINEERING",
        facts: [
          {
            id: `FACT-${state.attemptId}-UNRELATED`,
            kind: "OTHER",
            statement: "A valid generic PASS fact that does not bind the V1 Gate surface.",
            status: "VERIFIED",
            evidenceRefs: [state.previousRef],
          },
        ],
        limitations: [],
        unresolved: [],
      };
      const snapshot = publishValidationMachineResult(root, state.attemptId, forged);
      appendRecord(root, state, "TERMINAL", "MACHINE_RESULT_PRODUCED", snapshot.ref);
      state.lock.release();
      assert.throws(() => readValidationAttemptHistory(root, state.attemptId), /MACHINE_RESULT_FACTS/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("enforces one writer and treats a residual lock as a fail-closed boundary", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-STORE-LOCK" });
      const lock = acquireValidationAttemptLock(root, fixture.wire.validation_attempt_id);
      assert.throws(
        () => acquireValidationAttemptLock(root, fixture.wire.validation_attempt_id),
        /ATTEMPT_LOCKED/u,
      );
      const history = readValidationAttemptHistory(root, fixture.wire.validation_attempt_id);
      assert.equal(history.locked, true);
      lock.release();
      assert.equal(readValidationAttemptHistory(root, fixture.wire.validation_attempt_id).locked, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate input and machine-result snapshot cardinality", () => {
    const inputRoot = temporaryRoot();
    let inputLock;
    try {
      const state = startAttempt(inputRoot, "VRS1-STORE-DUPLICATE-INPUT");
      inputLock = state.lock;
      const second = buildValidationAttemptFixture(inputRoot, {
        attemptId: state.attemptId,
        declaredAt: "2026-08-31T13:01:00Z",
        filename: "second-input.json",
      });
      publishValidationInputSnapshot(inputRoot, state.attemptId, readFileSync(second.manifestPath));
      assert.throws(
        () => readValidationAttemptHistory(inputRoot, state.attemptId),
        /INPUT_SNAPSHOT_CARDINALITY/u,
      );
    } finally {
      inputLock?.release();
      rmSync(inputRoot, { recursive: true, force: true });
    }

    const resultRoot = temporaryRoot();
    let resultLock;
    try {
      const state = startAttempt(resultRoot, "VRS1-STORE-DUPLICATE-RESULT");
      resultLock = state.lock;
      const completed = completeAttempt(resultRoot, state);
      const secondResult = structuredClone(completed.machineResult);
      secondResult.limitations.push("Distinct immutable bytes for the cardinality test.");
      publishValidationMachineResult(resultRoot, state.attemptId, secondResult);
      assert.throws(
        () => readValidationAttemptHistory(resultRoot, state.attemptId),
        /MACHINE_RESULT_CARDINALITY/u,
      );
    } finally {
      resultLock?.release();
      rmSync(resultRoot, { recursive: true, force: true });
    }
  });

  it("rejects immutable-content conflicts and record filename identity drift", () => {
    const conflictRoot = temporaryRoot();
    let conflictLock;
    try {
      const state = startAttempt(conflictRoot, "VRS1-STORE-IMMUTABLE-CONFLICT");
      conflictLock = state.lock;
      writeFileSync(join(conflictRoot, state.previousRef.pointer), "{}\n", "utf8");
      assert.throws(
        () => publishValidationRecord(conflictRoot, state.records[0]),
        /IMMUTABLE_FILE_CONFLICT/u,
      );
    } finally {
      conflictLock?.release();
      rmSync(conflictRoot, { recursive: true, force: true });
    }

    const filenameRoot = temporaryRoot();
    let filenameLock;
    try {
      const state = startAttempt(filenameRoot, "VRS1-STORE-FILENAME-DRIFT");
      filenameLock = state.lock;
      const recordsDir = join(validationStoreRoot(filenameRoot, state.attemptId), "records");
      const original = readdirSync(recordsDir)[0];
      const drifted = `000000-${"0".repeat(64)}.json`;
      renameSync(join(recordsDir, original), join(recordsDir, drifted));
      assert.throws(
        () => readValidationAttemptHistory(filenameRoot, state.attemptId),
        /STORE_RECORD_FILENAME/u,
      );
    } finally {
      filenameLock?.release();
      rmSync(filenameRoot, { recursive: true, force: true });
    }
  });

  it("rejects temp/unknown files and symlinked store boundaries", () => {
    const root = temporaryRoot();
    try {
      const state = startAttempt(root, "VRS1-STORE-CORRUPT");
      state.lock.release();
      writeFileSync(join(validationStoreRoot(root, state.attemptId), "records", ".leftover.tmp"), "x");
      assert.throws(() => readValidationAttemptHistory(root, state.attemptId), /UNEXPECTED_STORE_ENTRY/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    if (process.platform !== "win32") {
      const symlinkRoot = temporaryRoot();
      const outside = temporaryRoot();
      try {
        mkdirSync(join(symlinkRoot, ".pi", "artifacts"), { recursive: true });
        symlinkSync(outside, join(symlinkRoot, ".pi", "artifacts", "hpi-validation"), "dir");
        assert.throws(
          () => inspectValidationStoreBoundary(symlinkRoot, "VRS1-STORE-SYMLINK"),
          /UNSAFE_STORE_PATH/u,
        );
      } finally {
        rmSync(symlinkRoot, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    }
  });
});
