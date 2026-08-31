import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TS001_FILES } from "../src/adapter.mjs";
import { sealRecord } from "../src/execution/contract.mjs";
import { rebuildTs001Projection } from "../src/projector.mjs";
import { sha256Bytes } from "../src/validation-runtime/contract.mjs";
import { previewValidationAttempt } from "../src/validation-runtime/intake.mjs";
import { runAndProjectValidationAttempt } from "../src/validation-runtime.mjs";
import { buildValidationAttemptProjection } from "../src/validation-runtime/projection.mjs";
import {
  getValidationAttemptStatus,
  runValidationAttempt,
} from "../src/validation-runtime/runtime.mjs";
import { buildValidationAttemptFixture, validationStoreRoot } from "./support/validation-runtime-fixture.mjs";

const childScript = fileURLToPath(new URL("./support/validation-runtime-child.mjs", import.meta.url));

function temporaryRoot() {
  return mkdtempSync(join(tmpdir(), "hpi-validation-runtime-"));
}

function authorityDigests(root) {
  return Object.fromEntries(
    Object.values(TS001_FILES).map((pointer) => [pointer, sha256Bytes(readFileSync(join(root, pointer)))]),
  );
}

function projectFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => statSync(join(root, entry)).isFile())
    .map((entry) => entry.split(sep).join("/"))
    .toSorted();
}

function runChild(mode, root, value) {
  return spawnSync(process.execPath, [childScript, mode, root, value], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
    timeout: 30_000,
  });
}

function childJson(child) {
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

describe("Validation Runtime Slice V1 end-to-end", () => {
  it("previews with zero writes, runs only inside the isolated store, and keeps formal TS-001 NOT-RUN", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-E2E-001" });
      const beforeAuthority = authorityDigests(root);
      const beforeProjectionId = rebuildTs001Projection(root).hps.projectionId;
      const beforeFiles = projectFiles(root);
      const storeRoot = validationStoreRoot(root, fixture.wire.validation_attempt_id);

      const preview = previewValidationAttempt(root, fixture.manifestPointer);
      assert.equal(preview.accepted, true);
      assert.equal(preview.wroteStore, false);
      assert.equal(existsSync(storeRoot), false);
      assert.deepEqual(projectFiles(root), beforeFiles);

      const result = runValidationAttempt(root, fixture.manifestPointer);
      assert.equal(result.kind, "MACHINE_RESULT_PRODUCED");
      assert.equal(result.machineResult.verdict, "PASS-ENGINEERING");
      assert.equal(result.appendedRecords, 4);
      assert.deepEqual(result.history.records.map((record) => record.phase), [
        "DECLARED",
        "ACCEPTED",
        "RUNNING",
        "TERMINAL",
      ]);
      assert.equal(result.history.terminal.outcome, "MACHINE_RESULT_PRODUCED");
      assert.equal(result.authority.projectCanonicalWrite, "FORBIDDEN");
      assert.equal(result.projectCanonicalChanged, false);
      assert.deepEqual(authorityDigests(root), beforeAuthority);

      const added = projectFiles(root).filter((pointer) => !beforeFiles.includes(pointer));
      assert.equal(added.length > 0, true);
      assert.equal(
        added.every((pointer) => pointer.startsWith(`${fixture.wire.isolated_write_root}/`)),
        true,
        JSON.stringify(added),
      );

      const projected = buildValidationAttemptProjection(root, fixture.wire.validation_attempt_id);
      assert.equal(projected.projection.adapter, "ts001-validation-runtime/0.1.0");
      assert.equal(projected.projection.hps.phase, "MACHINE_VALIDATION");
      assert.equal(projected.projection.hps.activeWork[0].machineStatus, "PASS-ENGINEERING");
      assert.equal(projected.projection.hps.activeWork[0].humanStatus, "NOT_NEEDED");
      assert.equal(projected.projection.hps.activeWork[1].machineStatus, "NOT-RUN");
      assert.match(projected.projection.briefs[0].headline, /正式 TS-001 仍为 NOT-RUN/u);
      assert.equal(projected.projection.escalationRequests.length, 0);

      rmSync(storeRoot, { recursive: true, force: true });
      assert.deepEqual(authorityDigests(root), beforeAuthority);
      assert.equal(rebuildTs001Projection(root).hps.projectionId, beforeProjectionId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns exact replay without append and blocks divergent input under the same attempt ID", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-REPLAY-001" });
      const first = runValidationAttempt(root, fixture.manifestPointer);
      const beforeFiles = projectFiles(validationStoreRoot(root, fixture.wire.validation_attempt_id));

      const replay = runValidationAttempt(root, fixture.manifestPointer);
      assert.equal(replay.kind, "EXACT_REPLAY");
      assert.equal(replay.replay, true);
      assert.equal(replay.appendedRecords, 0);
      assert.deepEqual(projectFiles(validationStoreRoot(root, fixture.wire.validation_attempt_id)), beforeFiles);

      const divergent = buildValidationAttemptFixture(root, {
        attemptId: fixture.wire.validation_attempt_id,
        declaredAt: "2026-08-31T12:00:01Z",
        filename: "divergent.json",
      });
      const conflict = runValidationAttempt(root, divergent.manifestPointer);
      assert.equal(conflict.kind, "BLOCKED_CONFLICT");
      assert.equal(conflict.conflict.code, "ATTEMPT_IDENTITY_CONFLICT");
      assert.equal(conflict.appendedRecords, 0);
      assert.deepEqual(projectFiles(validationStoreRoot(root, fixture.wire.validation_attempt_id)), beforeFiles);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("projects a historical local PASS as INCOMPLETE after the current TS-001 source drifts", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-PROJECTION-STALE" });
      const completed = runValidationAttempt(root, fixture.manifestPointer);
      assert.equal(completed.machineResult.verdict, "PASS-ENGINEERING");
      appendFileSync(join(root, TS001_FILES.technicalDesign), "\ncurrent source drift after terminal\n", "utf8");
      const projected = buildValidationAttemptProjection(root, fixture.wire.validation_attempt_id);
      assert.equal(projected.history.machineResult.verdict, "PASS-ENGINEERING");
      assert.equal(projected.validationMachineResult.verdict, "INCOMPLETE");
      assert.equal(projected.projection.hps.activeWork[0].machineStatus, "INCOMPLETE");
      assert.match(projected.validationMachineResult.facts[0].statement, /different TS-001 source revision/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails a stale reload-style validation contract identity before any store write", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-STALE-CONTRACT" });
      const stale = structuredClone(fixture.wire);
      stale.validation_contract.schema_set_digest = "0".repeat(64);
      delete stale.input_revision;
      const resealed = sealRecord(stale, "input_revision");
      writeFileSync(fixture.manifestPath, `${JSON.stringify(resealed, null, 2)}\n`, "utf8");
      assert.throws(
        () => previewValidationAttempt(root, fixture.manifestPointer),
        /MANIFEST_CONTRACT/u,
      );
      assert.equal(existsSync(validationStoreRoot(root, fixture.wire.validation_attempt_id)), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records deterministic INPUT_REJECTED when a declared raw-byte ref drifts", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-REF-DRIFT" });
      appendFileSync(join(root, TS001_FILES.technicalDesign), "\nexternal drift after declaration\n", "utf8");

      const preview = previewValidationAttempt(root, fixture.manifestPointer);
      assert.equal(preview.accepted, false);
      assert.equal(preview.gateOutcomes.find((entry) => entry.gate === "V1_REFERENCE").status, "FAILED");
      assert.equal(existsSync(validationStoreRoot(root, fixture.wire.validation_attempt_id)), false);

      const result = runValidationAttempt(root, fixture.manifestPointer);
      assert.equal(result.kind, "INPUT_REJECTED");
      assert.equal(result.machineResult, null);
      assert.equal(result.history.terminal.outcome, "INPUT_REJECTED");
      assert.deepEqual(result.history.records.map((record) => record.phase), ["DECLARED", "TERMINAL"]);
      assert.equal(result.history.records[1].gateOutcomes.find((entry) => entry.gate === "V1_REFERENCE").status, "FAILED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves the rejection receipt even when the base projection becomes unavailable", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-BASE-UNAVAILABLE" });
      const contractPath = join(root, TS001_FILES.contract);
      const drifted = readFileSync(contractPath, "utf8").replace("test_status: NOT-RUN", "test_status: PASS");
      writeFileSync(contractPath, drifted, "utf8");
      const completed = runAndProjectValidationAttempt(root, fixture.manifestPointer);
      assert.equal(completed.runtime.kind, "INPUT_REJECTED");
      assert.equal(completed.runtime.history.terminal.outcome, "INPUT_REJECTED");
      assert.match(completed.projectionError, /pilot requires authoritative test_status NOT-RUN/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never resumes a partial attempt and accepts retry only under a new ID bound to the exact latest record", () => {
    const root = temporaryRoot();
    try {
      const oldFixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-OLD-INTERRUPTED" });
      const interrupted = runValidationAttempt(root, oldFixture.manifestPointer, {
        testOnlyStopAfterPhase: "RUNNING",
      });
      assert.equal(interrupted.kind, "INCOMPLETE_INTERRUPTED");
      assert.equal(interrupted.history.records.length, 3);

      const same = runValidationAttempt(root, oldFixture.manifestPointer);
      assert.equal(same.kind, "INCOMPLETE_INTERRUPTED");
      assert.equal(same.appendedRecords, 0);
      assert.equal(same.history.records.length, 3);

      const retryOf = interrupted.history.recordRefs.at(-1);
      const retryFixture = buildValidationAttemptFixture(root, {
        attemptId: "VRS1-NEW-RETRY",
        retryOf,
      });
      const retry = runValidationAttempt(root, retryFixture.manifestPointer);
      assert.equal(retry.kind, "MACHINE_RESULT_PRODUCED");
      assert.equal(retry.machineResult.verdict, "PASS-ENGINEERING");
      assert.equal(retry.history.inputManifest.retryOf.id, retryOf.id);
      assert.equal(getValidationAttemptStatus(root, oldFixture.wire.validation_attempt_id).history.records.length, 3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rechecks refs before terminal and refuses PASS if source bytes change during the attempt", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-TOCTOU" });
      let clockCalls = 0;
      const result = runValidationAttempt(root, fixture.manifestPointer, {
        now() {
          clockCalls += 1;
          if (clockCalls === 3) {
            appendFileSync(join(root, TS001_FILES.technicalDesign), "\nconcurrent external change\n", "utf8");
          }
          return `2026-08-31T14:00:0${clockCalls}Z`;
        },
      });
      assert.equal(result.kind, "MACHINE_RESULT_PRODUCED");
      assert.equal(result.machineResult.verdict, "INCOMPLETE");
      assert.equal(result.machineResult.facts.some((fact) => fact.status === "FAILED"), true);
      assert.equal(result.history.terminal.outcome, "MACHINE_RESULT_PRODUCED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("fresh-process recovery semantics", () => {
  it("classifies a normal process-A non-terminal stop as interrupted in fresh process B", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-FRESH-INTERRUPTED" });
      const processA = childJson(runChild("run-stop", root, fixture.manifestPointer));
      assert.deepEqual(processA.phases, ["DECLARED", "ACCEPTED", "RUNNING"]);
      const processB = childJson(runChild("status", root, fixture.wire.validation_attempt_id));
      assert.equal(processB.kind, "INCOMPLETE_INTERRUPTED");
      assert.equal(processB.interrupted, true);
      assert.equal(processB.locked, false);
      const noResume = childJson(runChild("run", root, fixture.manifestPointer));
      assert.equal(noResume.kind, "INCOMPLETE_INTERRUPTED");
      assert.equal(noResume.appendedRecords, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves a crash lock and refuses stale-lock reclaim in a fresh process", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-FRESH-CRASH" });
      const crashed = runChild("run-crash", root, fixture.manifestPointer);
      assert.equal(crashed.signal, "SIGKILL");
      const status = childJson(runChild("status", root, fixture.wire.validation_attempt_id));
      assert.equal(status.kind, "INCOMPLETE_INTERRUPTED");
      assert.equal(status.locked, true);
      const blocked = runChild("run", root, fixture.manifestPointer);
      assert.notEqual(blocked.status, 0);
      assert.match(blocked.stderr, /ATTEMPT_LOCKED/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
