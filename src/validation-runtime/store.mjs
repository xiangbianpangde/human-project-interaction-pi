import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";

import { sha256, validateMachineResult } from "../contracts.mjs";
import { readAuthoritativeFileBuffers } from "../adapters/authoritative-files.mjs";
import { toWireMachineResult } from "../wire.mjs";
import { frozenIdentityKey } from "../execution/contract.mjs";
import { loadValidationRuntimeWireSchemaSet } from "../wire-schema.mjs";
import {
  VALIDATION_STORE_PREFIX,
  sha256Bytes,
  validateValidationRecordChain,
  validationAttemptId,
} from "./contract.mjs";
import {
  fromWireValidationAttemptInput,
  fromWireValidationAttemptRecord,
  toWireValidationAttemptRecord,
} from "./codecs.mjs";

const MAX_STORE_FILE_BYTES = 2 * 1024 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const RECORD_FILE = /^(\d{6})-([a-f0-9]{64})\.json$/u;
const RESULT_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,255})-([a-f0-9]{64})\.json$/u;
const MANIFEST_FILE = /^manifest-([a-f0-9]{64})\.json$/u;

export class ValidationRuntimeStoreError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ValidationRuntimeStoreError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ValidationRuntimeStoreError(code, message, details);
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function safeRoot(projectRoot) {
  const root = resolve(projectRoot);
  if (!existsSync(root)) fail("PROJECT_ROOT_MISSING", `project root does not exist: ${root}`);
  const stats = lstatSync(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail("UNSAFE_PROJECT_ROOT", "project root must be a non-symlink directory");
  }
  return root;
}

function ensureSafeDirectoryChain(projectRoot, relativePath) {
  const root = safeRoot(projectRoot);
  const candidate = resolve(root, relativePath);
  if (!inside(root, candidate)) fail("STORE_PATH_ESCAPE", `${relativePath} escapes project root`);
  let current = root;
  let relativeCurrent = "";
  for (const segment of relativePath.split("/")) {
    current = join(current, segment);
    relativeCurrent = relativeCurrent ? `${relativeCurrent}/${segment}` : segment;
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stats = lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail("UNSAFE_STORE_PATH", `${relativePath} contains a non-directory or symlink`, { path: current });
    }
    try {
      if (
        process.platform !== "win32" &&
        (relativeCurrent === ".pi/artifacts/hpi-validation" ||
          relativeCurrent.startsWith(".pi/artifacts/hpi-validation/"))
      ) {
        const mode = statSync(current).mode & 0o777;
        if ((mode & 0o077) !== 0) fail("STORE_DIRECTORY_MODE", `${current} must not be group/world accessible`);
      }
    } catch (error) {
      if (error instanceof ValidationRuntimeStoreError) throw error;
      fail("STORE_DIRECTORY_INSPECTION", `cannot inspect ${current}`, { cause: error });
    }
  }
  return candidate;
}

export function validationAttemptStorePaths(projectRoot, attemptId) {
  validationAttemptId(attemptId);
  const root = safeRoot(projectRoot);
  const relativeRoot = `${VALIDATION_STORE_PREFIX}/${attemptId}`;
  const attemptRoot = resolve(root, relativeRoot);
  if (!inside(root, attemptRoot)) fail("STORE_PATH_ESCAPE", "attempt store escapes project root");
  return {
    projectRoot: root,
    relativeRoot,
    attemptRoot,
    inputDir: join(attemptRoot, "input"),
    recordsDir: join(attemptRoot, "records"),
    machineResultsDir: join(attemptRoot, "machine-results"),
    lockDir: join(attemptRoot, ".lock"),
  };
}

export function inspectValidationStoreBoundary(projectRoot, attemptId) {
  const paths = validationAttemptStorePaths(projectRoot, attemptId);
  let current = paths.projectRoot;
  for (const segment of paths.relativeRoot.split("/")) {
    current = join(current, segment);
    if (!existsSync(current)) continue;
    const stats = lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail("UNSAFE_STORE_PATH", `${paths.relativeRoot} contains a non-directory or symlink`, {
        path: current,
      });
    }
  }
  return { ...paths, available: true, projectCanonicalChanged: false };
}

function ensureAttemptDirectories(projectRoot, attemptId) {
  const paths = validationAttemptStorePaths(projectRoot, attemptId);
  ensureSafeDirectoryChain(projectRoot, paths.relativeRoot);
  for (const child of ["input", "records", "machine-results"]) {
    ensureSafeDirectoryChain(projectRoot, `${paths.relativeRoot}/${child}`);
  }
  return paths;
}

function syncDirectory(path) {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicPublishBytes(target, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_STORE_FILE_BYTES) {
    fail("STORE_ENTRY_OVERSIZE", `immutable store entries must be Buffers of at most ${MAX_STORE_FILE_BYTES} bytes`);
  }
  const parent = dirname(target);
  const temp = join(parent, `.${basename(target)}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (existsSync(target)) {
    const existing = readFileSync(target);
    rmSync(temp, { force: true });
    if (!existing.equals(bytes)) {
      fail("IMMUTABLE_FILE_CONFLICT", `existing immutable file differs: ${target}`);
    }
    return { replay: true, path: target };
  }
  renameSync(temp, target);
  syncDirectory(parent);
  return { replay: false, path: target };
}

function atomicPublishJson(target, value) {
  return atomicPublishBytes(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

export function acquireValidationAttemptLock(projectRoot, attemptId, owner = {}) {
  loadValidationRuntimeWireSchemaSet();
  const paths = ensureAttemptDirectories(projectRoot, attemptId);
  try {
    mkdirSync(paths.lockDir, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail("ATTEMPT_LOCKED", `attempt ${attemptId} already has an active or stale lock`, {
        lockDir: paths.lockDir,
      });
    }
    throw error;
  }
  try {
    atomicPublishJson(join(paths.lockDir, "owner.json"), {
      ...owner,
      schema: "hpi/validation-attempt-lock/v1",
      attempt_id: attemptId,
      pid: process.pid,
      acquired_at: new Date().toISOString(),
    });
  } catch (error) {
    rmSync(paths.lockDir, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return {
    paths,
    release() {
      if (released) return;
      rmSync(paths.lockDir, { recursive: true, force: true });
      syncDirectory(paths.attemptRoot);
      released = true;
    },
  };
}

export function publishValidationInputSnapshot(projectRoot, attemptId, wireInputBytes) {
  validationAttemptId(attemptId);
  const bytes = Buffer.from(wireInputBytes);
  let wire;
  try {
    wire = JSON.parse(UTF8.decode(bytes));
  } catch (error) {
    fail("INPUT_SNAPSHOT_INVALID", "input snapshot must be valid UTF-8 JSON before publication", {
      cause: error,
    });
  }
  let parsed;
  try {
    parsed = fromWireValidationAttemptInput(wire, "inputSnapshot").internal;
  } catch (error) {
    fail("INPUT_SNAPSHOT_INVALID", "input snapshot violates the frozen validation contract", {
      cause: error,
    });
  }
  if (parsed.validationAttemptId !== attemptId) {
    fail("INPUT_SNAPSHOT_ATTEMPT", "input snapshot attempt identity differs from its store root");
  }
  const paths = ensureAttemptDirectories(projectRoot, attemptId);
  const digest = sha256Bytes(bytes);
  const target = join(paths.inputDir, `manifest-${digest}.json`);
  atomicPublishBytes(target, bytes);
  return {
    id: attemptId,
    revision: parsed.inputRevision,
    sha256: digest,
    pointer: `${paths.relativeRoot}/input/${basename(target)}`,
  };
}

export function publishValidationRecord(projectRoot, recordDraft) {
  const wire = toWireValidationAttemptRecord(recordDraft);
  const paths = ensureAttemptDirectories(projectRoot, recordDraft.validationAttemptId);
  const name = `${String(wire.sequence).padStart(6, "0")}-${wire.record_revision}.json`;
  const published = atomicPublishJson(join(paths.recordsDir, name), wire);
  return {
    wire,
    internal: fromWireValidationAttemptRecord(wire).internal,
    replay: published.replay,
    ref: {
      id: wire.record_id,
      revision: wire.record_revision,
      sha256: wire.record_revision,
      pointer: `${paths.relativeRoot}/records/${name}`,
    },
  };
}

export function publishValidationMachineResult(projectRoot, attemptId, machineResult) {
  validationAttemptId(attemptId);
  validateMachineResult(machineResult);
  if (machineResult.attemptId !== attemptId) {
    fail("MACHINE_RESULT_ATTEMPT", "MachineResult attemptId differs from its store root");
  }
  const wire = toWireMachineResult(machineResult);
  const paths = ensureAttemptDirectories(projectRoot, attemptId);
  const name = `${wire.result_id}-${wire.result_revision}.json`;
  const published = atomicPublishJson(join(paths.machineResultsDir, name), wire);
  return {
    wire,
    replay: published.replay,
    ref: {
      id: wire.result_id,
      revision: wire.result_revision,
      sha256: wire.result_revision,
      pointer: `${paths.relativeRoot}/machine-results/${name}`,
    },
  };
}

function projectRelative(root, absolute) {
  return relative(root, absolute).split(sep).join("/");
}

function safeStoredFiles(projectRoot, directory, pattern, kind) {
  if (!existsSync(directory)) return [];
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail("UNSAFE_STORE_PATH", `${kind} directory is not a safe directory`);
  }
  return readdirSync(directory).map((name) => {
    const match = pattern.exec(name);
    if (!match) fail("UNEXPECTED_STORE_ENTRY", `unexpected ${kind} entry ${name}`);
    const absolute = join(directory, name);
    const entryStats = lstatSync(absolute);
    if (!entryStats.isFile() || entryStats.isSymbolicLink()) {
      fail("UNSAFE_STORE_ENTRY", `${kind} entry ${name} is not a regular file`);
    }
    if (entryStats.size > MAX_STORE_FILE_BYTES) {
      fail("STORE_ENTRY_OVERSIZE", `${kind} entry ${name} exceeds ${MAX_STORE_FILE_BYTES} bytes`);
    }
    return { name, match, pointer: projectRelative(safeRoot(projectRoot), absolute) };
  });
}

function parseStoredMachineResult(wire, path) {
  exactWireKeys(
    wire,
    [
      "schema",
      "result_id",
      "task_id",
      "attempt_id",
      "result_revision",
      "source_ref",
      "verdict",
      "facts",
      "limitations",
      "unresolved",
    ],
    path,
  );
  const internal = {
    schema: "hpi/machine-result/v1",
    resultId: wire.result_id,
    taskId: wire.task_id,
    attemptId: wire.attempt_id,
    sourceRef: fromStoredRef(wire.source_ref, `${path}.source_ref`),
    verdict: wire.verdict,
    facts: wire.facts.map((fact, index) => {
      exactWireKeys(
        fact,
        ["fact_id", "kind", "statement", "status", "evidence_refs"],
        `${path}.facts[${index}]`,
      );
      return {
        id: fact.fact_id,
        kind: fact.kind,
        statement: fact.statement,
        status: fact.status,
        evidenceRefs: fact.evidence_refs.map((ref, refIndex) =>
          fromStoredRef(ref, `${path}.facts[${index}].evidence_refs[${refIndex}]`),
        ),
      };
    }),
    limitations: [...wire.limitations],
    unresolved: [...wire.unresolved],
  };
  validateMachineResult(internal, path);
  const expected = sha256(internal);
  if (wire.result_revision !== expected) {
    fail("MACHINE_RESULT_REVISION_MISMATCH", `${path}.result_revision differs from content`, {
      expected,
      actual: wire.result_revision,
    });
  }
  return internal;
}

function validateStoredMachineResultBinding(machineResult, terminal, attemptId) {
  if (
    machineResult.resultId !== `MR-VRS1-${attemptId}` ||
    machineResult.taskId !== `VRS1-${attemptId}` ||
    machineResult.attemptId !== attemptId
  ) {
    fail("MACHINE_RESULT_SCOPE", "stored MachineResult identity is outside this validation attempt");
  }
  if (
    frozenIdentityKey(machineResult.sourceRef) !== frozenIdentityKey(terminal.previousRecordRef) ||
    machineResult.sourceRef.pointer !== terminal.previousRecordRef.pointer
  ) {
    fail("MACHINE_RESULT_SOURCE", "stored MachineResult must derive from the immutable RUNNING record");
  }
  const allPassed = terminal.gateOutcomes.every((outcome) => outcome.status === "PASSED");
  const expectedVerdict = allPassed ? "PASS-ENGINEERING" : "INCOMPLETE";
  if (machineResult.verdict !== expectedVerdict) {
    fail("MACHINE_RESULT_VERDICT", `stored MachineResult must equal ${expectedVerdict}`);
  }
  if (machineResult.facts.length !== terminal.gateOutcomes.length) {
    fail("MACHINE_RESULT_FACTS", "stored MachineResult must contain exactly one fact per V1 Gate");
  }
  terminal.gateOutcomes.forEach((outcome, index) => {
    const fact = machineResult.facts[index];
    const expectedStatus = outcome.status === "PASSED"
      ? "VERIFIED"
      : outcome.status === "FAILED"
        ? "FAILED"
        : "NOT_RUN";
    if (
      fact?.id !== `FACT-${attemptId}-${outcome.gate}` ||
      fact?.status !== expectedStatus
    ) {
      fail("MACHINE_RESULT_FACTS", `fact ${index} does not bind ${outcome.gate} and its status`);
    }
    if (
      outcome.status === "PASSED" &&
      !fact.evidenceRefs.some(
        (ref) =>
          frozenIdentityKey(ref) === frozenIdentityKey(terminal.previousRecordRef) &&
          ref.pointer === terminal.previousRecordRef.pointer,
      )
    ) {
      fail("MACHINE_RESULT_FACTS", `verified fact ${fact.id} must cite the immutable RUNNING record`);
    }
  });
}

function exactWireKeys(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("STORE_RECORD_SHAPE", `${path} must be an object`);
  }
  for (const key of keys) if (!(key in value)) fail("STORE_RECORD_SHAPE", `${path}.${key} is required`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail("STORE_RECORD_SHAPE", `${path}.${key} is not allowed`);
  }
  return value;
}

function fromStoredRef(value, path) {
  exactWireKeys(value, ["id", "revision", "sha256", ...(value?.pointer === undefined ? [] : ["pointer"])], path);
  return {
    id: value.id,
    revision: value.revision,
    sha256: value.sha256,
    ...(value.pointer === undefined ? {} : { pointer: value.pointer }),
  };
}

export function readValidationAttemptHistory(projectRoot, attemptId) {
  loadValidationRuntimeWireSchemaSet();
  const paths = validationAttemptStorePaths(projectRoot, attemptId);
  if (!existsSync(paths.attemptRoot)) {
    return {
      kind: "NOT_FOUND",
      attemptId,
      records: [],
      recordRefs: [],
      latest: null,
      terminal: null,
      interrupted: false,
      locked: false,
      machineResult: null,
      inputRef: null,
      inputManifest: null,
      uncommittedMachineResultCount: 0,
      projectCanonicalChanged: false,
    };
  }
  const rootStats = lstatSync(paths.attemptRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail("UNSAFE_STORE_PATH", "attempt root is not a safe directory");
  }
  const allowedAttemptEntries = new Set(["input", "records", "machine-results", ".lock"]);
  for (const entry of readdirSync(paths.attemptRoot)) {
    if (!allowedAttemptEntries.has(entry)) {
      fail("UNEXPECTED_STORE_ENTRY", `unexpected attempt-root entry ${entry}`);
    }
  }
  const locked = existsSync(paths.lockDir);
  if (locked) {
    const lockStats = lstatSync(paths.lockDir);
    if (!lockStats.isDirectory() || lockStats.isSymbolicLink()) {
      fail("UNSAFE_ATTEMPT_LOCK", "attempt lock must be a non-symlink directory");
    }
    const lockEntries = readdirSync(paths.lockDir);
    if (lockEntries.length !== 1 || lockEntries[0] !== "owner.json") {
      fail("UNSAFE_ATTEMPT_LOCK", "attempt lock must contain only owner.json");
    }
    const ownerPath = join(paths.lockDir, "owner.json");
    const ownerStats = lstatSync(ownerPath);
    if (!ownerStats.isFile() || ownerStats.isSymbolicLink() || ownerStats.size > MAX_STORE_FILE_BYTES) {
      fail("UNSAFE_ATTEMPT_LOCK", "attempt lock owner must be a bounded regular file");
    }
    let owner;
    try {
      owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    } catch (error) {
      fail("UNSAFE_ATTEMPT_LOCK", "attempt lock owner must be valid JSON", { cause: error });
    }
    if (
      owner?.schema !== "hpi/validation-attempt-lock/v1" ||
      owner?.attempt_id !== attemptId ||
      !Number.isSafeInteger(owner?.pid) ||
      typeof owner?.acquired_at !== "string"
    ) {
      fail("UNSAFE_ATTEMPT_LOCK", "attempt lock owner identity is invalid");
    }
  }
  const inputFiles = safeStoredFiles(projectRoot, paths.inputDir, MANIFEST_FILE, "input manifest");
  if (inputFiles.length > 1) {
    fail("INPUT_SNAPSHOT_CARDINALITY", "one attempt must not contain multiple input snapshots", {
      count: inputFiles.length,
    });
  }
  const resultFiles = safeStoredFiles(projectRoot, paths.machineResultsDir, RESULT_FILE, "machine result");
  if (resultFiles.length > 1) {
    fail("MACHINE_RESULT_CARDINALITY", "one attempt must not contain multiple machine-result snapshots", {
      count: resultFiles.length,
    });
  }
  const recordFiles = safeStoredFiles(projectRoot, paths.recordsDir, RECORD_FILE, "record")
    .sort((left, right) => left.name.localeCompare(right.name));
  const recordPointers = Object.fromEntries(recordFiles.map((file, index) => [`record${index}`, file.pointer]));
  const recordBytes = readAuthoritativeFileBuffers(projectRoot, recordPointers, {
    maxBytes: MAX_STORE_FILE_BYTES,
  });
  const records = recordFiles.map((file, index) => {
    let wire;
    try {
      wire = JSON.parse(recordBytes[`record${index}`].toString("utf8"));
    } catch (error) {
      fail("STORE_RECORD_JSON", `${file.name} is not valid JSON`, { cause: error });
    }
    const parsed = fromWireValidationAttemptRecord(wire, `records[${index}]`);
    if (Number(file.match[1]) !== parsed.internal.sequence || file.match[2] !== parsed.internal.recordRevision) {
      fail("STORE_RECORD_FILENAME", `${file.name} differs from its record identity`);
    }
    return parsed.internal;
  });
  const chain = validateValidationRecordChain(records);
  if (chain.length > 0 && inputFiles.length !== 1) {
    fail("INPUT_SNAPSHOT_CARDINALITY", "a recorded attempt must have exactly one input manifest snapshot", {
      count: inputFiles.length,
    });
  }
  let inputManifest = null;
  let storedInputRef = null;
  if (inputFiles.length === 1) {
    const inputFile = inputFiles[0];
    const bytes = readAuthoritativeFileBuffers(projectRoot, { input: inputFile.pointer }, {
      maxBytes: MAX_STORE_FILE_BYTES,
    }).input;
    const rawDigest = sha256Bytes(bytes);
    if (rawDigest !== inputFile.match[1]) {
      fail("INPUT_SNAPSHOT_FILENAME", `${inputFile.name} differs from its raw-byte digest`);
    }
    let wire;
    try {
      wire = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      fail("INPUT_SNAPSHOT_JSON", `${inputFile.name} is not valid JSON`, { cause: error });
    }
    inputManifest = fromWireValidationAttemptInput(wire, "inputManifest").internal;
    if (inputManifest.validationAttemptId !== attemptId) {
      fail("INPUT_SNAPSHOT_ATTEMPT", "input snapshot attempt identity differs from its store root");
    }
    storedInputRef = {
      id: attemptId,
      revision: inputManifest.inputRevision,
      sha256: rawDigest,
      pointer: inputFile.pointer,
    };
    if (
      chain.length > 0 &&
      (frozenIdentityKey(chain[0].inputRef) !== frozenIdentityKey(storedInputRef) ||
        chain[0].inputRef.pointer !== storedInputRef.pointer)
    ) {
      fail("INPUT_SNAPSHOT_IDENTITY", "record input_ref differs from the stored manifest snapshot");
    }
  }
  const recordRefs = chain.map((record, index) => ({
    id: record.recordId,
    revision: record.recordRevision,
    sha256: record.recordRevision,
    pointer: recordFiles[index].pointer,
  }));
  const latest = chain.at(-1) ?? null;
  const terminal = latest?.phase === "TERMINAL" ? latest : null;
  let machineResult = null;
  if (terminal?.machineResultRef) {
    if (resultFiles.length !== 1) {
      fail("MACHINE_RESULT_CARDINALITY", "a produced terminal result requires exactly one snapshot");
    }
    const match = resultFiles.find(
      (file) => file.match[1] === terminal.machineResultRef.id && file.match[2] === terminal.machineResultRef.revision,
    );
    if (!match) fail("MACHINE_RESULT_MISSING", "terminal machine_result_ref does not resolve");
    if (terminal.machineResultRef.pointer !== match.pointer) {
      fail("MACHINE_RESULT_POINTER", "terminal machine_result_ref pointer differs from store path");
    }
    const bytes = readAuthoritativeFileBuffers(projectRoot, { result: match.pointer }, {
      maxBytes: MAX_STORE_FILE_BYTES,
    }).result;
    let wire;
    try {
      wire = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      fail("MACHINE_RESULT_JSON", `${match.name} is not valid JSON`, { cause: error });
    }
    machineResult = parseStoredMachineResult(wire, "machineResult");
    if (
      machineResult.resultId !== terminal.machineResultRef.id ||
      machineResult.attemptId !== attemptId ||
      sha256(machineResult) !== terminal.machineResultRef.sha256
    ) {
      fail("MACHINE_RESULT_IDENTITY", "terminal machine_result_ref differs from stored result");
    }
    validateStoredMachineResultBinding(machineResult, terminal, attemptId);
  } else if (terminal && resultFiles.length > 0) {
    fail("UNCOMMITTED_MACHINE_RESULT", "a non-producing terminal record must not retain a result snapshot");
  }
  const hasPartialState = chain.length > 0 || inputManifest !== null || resultFiles.length > 0;
  return {
    kind: terminal ? "TERMINAL" : hasPartialState ? "INCOMPLETE_INTERRUPTED" : "EMPTY",
    attemptId,
    records: chain,
    recordRefs,
    latest,
    terminal,
    interrupted: hasPartialState && !terminal,
    locked,
    machineResult,
    inputRef: storedInputRef,
    inputManifest,
    uncommittedMachineResultCount: terminal ? 0 : resultFiles.length,
    projectCanonicalChanged: false,
  };
}

export function readValidationInputSnapshots(projectRoot, attemptId) {
  const paths = validationAttemptStorePaths(projectRoot, attemptId);
  const files = safeStoredFiles(projectRoot, paths.inputDir, MANIFEST_FILE, "input manifest");
  return files.map((file) => ({ name: file.name, digest: file.match[1], pointer: file.pointer }));
}

export function validationRecordRef(record) {
  return {
    id: record.recordId,
    revision: record.recordRevision,
    sha256: record.recordRevision,
    ...(record.pointer === undefined ? {} : { pointer: record.pointer }),
  };
}

export function sameValidationInput(left, right) {
  return frozenIdentityKey(left) === frozenIdentityKey(right);
}
