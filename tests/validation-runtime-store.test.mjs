import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  VALIDATION_ATTEMPT_RECORD_SCHEMA,
  VALIDATION_AUTHORITY,
  VALIDATION_RUNTIME_VERSION,
} from "../src/validation-runtime/contract.mjs";
import { fromWireValidationAttemptInput } from "../src/validation-runtime/codecs.mjs";
import {
  buildCanonicalValidationMachineResult,
  canonicalDeclaredValidationGateOutcomes,
  canonicalSuccessfulValidationGateOutcomes,
} from "../src/validation-runtime/semantics.mjs";
import {
  acquireValidationAttemptLock,
  inspectValidationStoreBoundary,
  publishValidationInputSnapshot,
  publishValidationMachineResult,
  publishValidationRecord,
  readValidationAttemptHistory,
  testOnlyPublishValidationRecordWithWorkerHook,
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

function gateOutcomes(input, phase, inputRef) {
  return phase === "DECLARED"
    ? canonicalDeclaredValidationGateOutcomes(input, inputRef)
    : canonicalSuccessfulValidationGateOutcomes(input, inputRef);
}

function recordDraft({ attemptId, input, inputRef, sequence, phase, previousRecordRef, outcome = "NONE", machineResultRef }) {
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
    gateOutcomes: gateOutcomes(input, phase, inputRef),
    ...(machineResultRef === undefined ? {} : { machineResultRef }),
    ...(previousRecordRef === undefined ? {} : { previousRecordRef }),
    recordedAt: `2026-08-31T13:00:0${sequence}Z`,
  };
}

function appendRecord(root, state, phase, outcome = "NONE", machineResultRef, options = {}) {
  const draft = recordDraft({
    attemptId: state.attemptId,
    input: state.input,
    inputRef: state.inputRef,
    sequence: state.records.length,
    phase,
    outcome,
    machineResultRef,
    ...(state.previousRef === undefined ? {} : { previousRecordRef: state.previousRef }),
  });
  const published = options.testOnlyWorkerHook === undefined
    ? publishValidationRecord(root, draft)
    : testOnlyPublishValidationRecordWithWorkerHook(root, draft, options.testOnlyWorkerHook);
  state.records.push(published.internal);
  state.previousRef = published.ref;
  return published;
}

function startAttempt(root, attemptId = "VRS1-STORE-001") {
  const fixture = buildValidationAttemptFixture(root, { attemptId });
  const lock = acquireValidationAttemptLock(root, attemptId, { invocation_id: "test-invocation" });
  const inputRef = publishValidationInputSnapshot(root, attemptId, readFileSync(fixture.manifestPath));
  const input = fromWireValidationAttemptInput(fixture.wire).internal;
  const state = { attemptId, fixture, input, lock, inputRef, previousRef: undefined, records: [] };
  appendRecord(root, state, "DECLARED");
  return state;
}

function completeAttempt(root, state) {
  appendRecord(root, state, "ACCEPTED");
  appendRecord(root, state, "RUNNING");
  const runningRef = state.previousRef;
  const machineResult = buildCanonicalValidationMachineResult(
    state.input,
    runningRef,
    canonicalSuccessfulValidationGateOutcomes(state.input, state.inputRef),
  );
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

  it("rejects a self-consistent five-Gate PASS with forged fact semantics", () => {
    const root = temporaryRoot();
    try {
      const state = startAttempt(root, "VRS1-STORE-FORGED-PASS");
      appendRecord(root, state, "ACCEPTED");
      appendRecord(root, state, "RUNNING");
      const forged = buildCanonicalValidationMachineResult(
        state.input,
        state.previousRef,
        canonicalSuccessfulValidationGateOutcomes(state.input, state.inputRef),
      );
      forged.facts[0] = {
        ...forged.facts[0],
        kind: "HASH",
        statement: "Forged claim: formal TS-001 and canonical acceptance both passed.",
      };
      const snapshot = publishValidationMachineResult(root, state.attemptId, forged);
      appendRecord(root, state, "TERMINAL", "MACHINE_RESULT_PRODUCED", snapshot.ref);
      state.lock.release();
      assert.throws(
        () => readValidationAttemptHistory(root, state.attemptId),
        /MACHINE_RESULT_SEMANTICS/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a reordered and resealed MachineResult evidence array", () => {
    const root = temporaryRoot();
    try {
      const state = startAttempt(root, "VRS1-STORE-REORDERED-RESULT");
      appendRecord(root, state, "ACCEPTED");
      appendRecord(root, state, "RUNNING");
      const reordered = buildCanonicalValidationMachineResult(
        state.input,
        state.previousRef,
        canonicalSuccessfulValidationGateOutcomes(state.input, state.inputRef),
      );
      reordered.facts[1].evidenceRefs.reverse();
      const snapshot = publishValidationMachineResult(root, state.attemptId, reordered);
      appendRecord(root, state, "TERMINAL", "MACHINE_RESULT_PRODUCED", snapshot.ref);
      state.lock.release();
      assert.throws(
        () => readValidationAttemptHistory(root, state.attemptId),
        /MACHINE_RESULT_SEMANTICS/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects all-PASSED records with non-canonical Gate codes or evidence", () => {
    for (const mutation of ["code", "evidence"]) {
      const root = temporaryRoot();
      try {
        const state = startAttempt(root, `VRS1-STORE-FORGED-GATE-${mutation.toUpperCase()}`);
        const draft = recordDraft({
          attemptId: state.attemptId,
          input: state.input,
          inputRef: state.inputRef,
          sequence: 1,
          phase: "ACCEPTED",
          previousRecordRef: state.previousRef,
        });
        if (mutation === "code") {
          draft.gateOutcomes[0].code = "FORGED_SUCCESS";
        } else {
          draft.gateOutcomes[1].evidenceRefs = [state.inputRef];
        }
        publishValidationRecord(root, draft);
        state.lock.release();
        assert.throws(
          () => readValidationAttemptHistory(root, state.attemptId),
          /GATE_SUCCESS_SEMANTICS/u,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("rejects FAILED records with non-canonical Gate codes or evidence", () => {
    for (const mutation of ["code", "evidence"]) {
      const root = temporaryRoot();
      try {
        const state = startAttempt(root, `VRS1-STORE-FORGED-FAILURE-${mutation.toUpperCase()}`);
        const draft = recordDraft({
          attemptId: state.attemptId,
          input: state.input,
          inputRef: state.inputRef,
          sequence: 1,
          phase: "TERMINAL",
          outcome: "INPUT_REJECTED",
          previousRecordRef: state.previousRef,
        });
        const canonical = canonicalSuccessfulValidationGateOutcomes(state.input, state.inputRef);
        draft.gateOutcomes = canonical.map((outcome, index) => {
          if (index < 2) return outcome;
          if (index === 2) {
            return {
              ...outcome,
              status: "FAILED",
              code: mutation === "code" ? "FORGED_FAILURE" : "REFERENCES_REJECTED",
              evidenceRefs: mutation === "evidence" ? [state.inputRef] : outcome.evidenceRefs,
            };
          }
          return {
            ...outcome,
            status: "NOT_RUN",
            code: "NOT_RUN_AFTER_V1_REFERENCE",
            evidenceRefs: [],
          };
        });
        publishValidationRecord(root, draft);
        state.lock.release();
        assert.throws(
          () => readValidationAttemptHistory(root, state.attemptId),
          /GATE_FAILURE_EVIDENCE/u,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
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

  it("rejects reopened store files with unsafe modes or additional hard links", {
    skip: process.platform === "win32" ? "POSIX mode/link-count policy" : false,
  }, () => {
    const root = temporaryRoot();
    try {
      const state = startAttempt(root, "VRS1-STORE-FILE-POLICY");
      completeAttempt(root, state);
      state.lock.release();
      const attemptRoot = validationStoreRoot(root, state.attemptId);
      const paths = [
        join(attemptRoot, "input", readdirSync(join(attemptRoot, "input"))[0]),
        join(attemptRoot, "records", readdirSync(join(attemptRoot, "records"))[0]),
        join(attemptRoot, "machine-results", readdirSync(join(attemptRoot, "machine-results"))[0]),
      ];
      for (const path of paths) {
        assert.equal(statSync(path).mode & 0o777, 0o600);
        chmodSync(path, 0o644);
        assert.throws(() => readValidationAttemptHistory(root, state.attemptId), /STORE_FILE_MODE/u);
        chmodSync(path, 0o600);
      }
      const recordsDirectory = join(attemptRoot, "records");
      chmodSync(recordsDirectory, 0o755);
      assert.throws(() => readValidationAttemptHistory(root, state.attemptId), /STORE_DIRECTORY_MODE/u);
      chmodSync(recordsDirectory, 0o700);

      const extraLink = join(root, "record-hardlink.json");
      linkSync(paths[1], extraLink);
      assert.throws(() => readValidationAttemptHistory(root, state.attemptId), /STORE_FILE_LINK_COUNT/u);
      rmSync(extraLink, { force: true });

      const lockFixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-STORE-OWNER-MODE" });
      const lock = acquireValidationAttemptLock(root, lockFixture.wire.validation_attempt_id);
      const owner = join(validationStoreRoot(root, lockFixture.wire.validation_attempt_id), ".lock", "owner.json");
      chmodSync(owner, 0o644);
      assert.throws(
        () => readValidationAttemptHistory(root, lockFixture.wire.validation_attempt_id),
        /STORE_FILE_MODE/u,
      );
      chmodSync(owner, 0o600);
      lock.release();
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

  it("anchors publication against a parent symlink swap and never writes through the replacement", () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    let lock;
    try {
      const state = startAttempt(root, "VRS1-STORE-ANCHORED-SWAP");
      lock = state.lock;
      assert.throws(
        () => appendRecord(root, state, "ACCEPTED", "NONE", undefined, {
          testOnlyWorkerHook: {
            point: "AFTER_ANCHOR",
            kind: "SWAP_ANCHORED_DIRECTORY",
            outsidePath: outside,
          },
        }),
        /STORE_DIRECTORY_REALPATH|STORE_DIRECTORY_SWAP_BLOCKED/u,
      );
      assert.deepEqual(readdirSync(outside), []);
      const attemptEntries = readdirSync(validationStoreRoot(root, state.attemptId));
      const anchored = attemptEntries.find((entry) => entry.startsWith("records.anchored-"));
      if (anchored) {
        assert.equal(readdirSync(join(validationStoreRoot(root, state.attemptId), anchored)).length, 1);
      } else {
        assert.ok(attemptEntries.includes("records"), JSON.stringify(attemptEntries));
      }
    } finally {
      lock?.release();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("treats relocation of an acquired directory capability as detected external mutation", {
    skip: process.platform === "win32" ? "Windows may deny rename of the worker cwd" : false,
  }, () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    let lock;
    try {
      const state = startAttempt(root, "VRS1-STORE-CAPABILITY-RELOCATION");
      lock = state.lock;
      assert.throws(
        () => appendRecord(root, state, "ACCEPTED", "NONE", undefined, {
          testOnlyWorkerHook: {
            point: "AFTER_LINK",
            kind: "MOVE_ANCHORED_DIRECTORY_OUTSIDE",
            outsidePath: outside,
          },
        }),
        /STORE_DIRECTORY_REALPATH/u,
      );
      assert.deepEqual(
        readdirSync(join(validationStoreRoot(root, state.attemptId), "records")),
        [],
      );
      const moved = readdirSync(outside);
      assert.equal(moved.length, 1, JSON.stringify(moved));
      const acquiredEntries = readdirSync(join(outside, moved[0]));
      assert.equal(acquiredEntries.filter((entry) => entry.endsWith(".json")).length, 2);
      assert.equal(acquiredEntries.some((entry) => entry.endsWith(".tmp")), true);
    } finally {
      lock?.release();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("binds the published target to the still-open runtime-created temp descriptor", () => {
    const root = temporaryRoot();
    let lock;
    try {
      const state = startAttempt(root, "VRS1-STORE-PUBLICATION-IDENTITY");
      lock = state.lock;
      assert.throws(
        () => appendRecord(root, state, "ACCEPTED", "NONE", undefined, {
          testOnlyWorkerHook: {
            point: "AFTER_LINK",
            kind: "REPLACE_LINKED_TARGET",
          },
        }),
        /STORE_FILE_IDENTITY/u,
      );
      const records = readdirSync(join(validationStoreRoot(root, state.attemptId), "records"));
      assert.equal(records.some((entry) => entry.endsWith(".replacement.tmp")), true);
      assert.equal(records.some((entry) => entry.startsWith("000001-")), true);
    } finally {
      lock?.release();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses atomic no-replace when a target appears immediately before publication", () => {
    const root = temporaryRoot();
    let lock;
    try {
      const state = startAttempt(root, "VRS1-STORE-NO-REPLACE");
      lock = state.lock;
      assert.throws(
        () => appendRecord(root, state, "ACCEPTED", "NONE", undefined, {
          testOnlyWorkerHook: {
            point: "BEFORE_LINK",
            kind: "INSERT_TARGET",
            bytesBase64: Buffer.from("{}\n", "utf8").toString("base64"),
          },
        }),
        /IMMUTABLE_FILE_CONFLICT/u,
      );
      const recordsDir = join(validationStoreRoot(root, state.attemptId), "records");
      const inserted = readdirSync(recordsDir).find((entry) => entry.startsWith("000001-"));
      assert.ok(inserted);
      assert.equal(readFileSync(join(recordsDir, inserted), "utf8"), "{}\n");
      assert.equal(readdirSync(recordsDir).some((entry) => entry.endsWith(".tmp")), false);
    } finally {
      lock?.release();
      rmSync(root, { recursive: true, force: true });
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
