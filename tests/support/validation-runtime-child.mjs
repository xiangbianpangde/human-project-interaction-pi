import {
  getValidationAttemptStatus,
  runValidationAttempt,
} from "../../src/validation-runtime/runtime.mjs";
import { acquireValidationAttemptLock } from "../../src/validation-runtime/store.mjs";

const [mode, projectRoot, value] = process.argv.slice(2);

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (mode === "run-stop") {
  const result = runValidationAttempt(projectRoot, value, {
    testOnlyStopAfterPhase: "RUNNING",
  });
  output({
    kind: result.kind,
    phases: result.history.records.map((record) => record.phase),
    locked: result.history.locked,
  });
} else if (mode === "run-crash") {
  const result = runValidationAttempt(projectRoot, value, {
    testOnlyStopAfterPhase: "RUNNING",
  });
  acquireValidationAttemptLock(projectRoot, result.attemptId, {
    invocation_id: "fresh-process-crash-test",
  });
  process.kill(process.pid, "SIGKILL");
} else if (mode === "run") {
  const result = runValidationAttempt(projectRoot, value);
  output({
    kind: result.kind,
    appendedRecords: result.appendedRecords,
    phases: result.history?.records.map((record) => record.phase) ?? [],
    locked: result.history?.locked ?? false,
  });
} else if (mode === "status") {
  const status = getValidationAttemptStatus(projectRoot, value);
  output({
    kind: status.history.kind,
    phases: status.history.records.map((record) => record.phase),
    locked: status.history.locked,
    interrupted: status.history.interrupted,
  });
} else {
  throw new Error(`unknown child mode ${mode}`);
}
