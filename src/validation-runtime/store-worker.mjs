import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, normalize } from "node:path";

import {
  VALIDATION_STORE_PREFIX,
  validationAttemptId,
} from "./contract.mjs";

const MAX_STORE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const RECORD_FILE = /^(\d{6})-([a-f0-9]{64})\.json$/u;
const RESULT_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,255})-([a-f0-9]{64})\.json$/u;
const MANIFEST_FILE = /^manifest-([a-f0-9]{64})\.json$/u;
const AREAS = Object.freeze({
  input: MANIFEST_FILE,
  records: RECORD_FILE,
  "machine-results": RESULT_FILE,
});
const PRIVATE_PREFIX = ".pi/artifacts/hpi-validation";

class StoreWorkerError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "StoreWorkerError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new StoreWorkerError(code, message, details);
}

function identity(stats) {
  return { dev: String(stats.dev), ino: String(stats.ino) };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function canonicalReal(path = ".") {
  const value = realpathSync.native ? realpathSync.native(path) : realpathSync(path);
  const normalized = normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function expectedRealChild(parent, segment) {
  const value = normalize(join(parent, segment));
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function safeSegment(value, name = "segment") {
  if (
    typeof value !== "string" ||
    value === "" ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail("STORE_WORKER_PATH", `${name} is not one safe path segment`);
  }
  return value;
}

function assertPrivateDirectory(stats, label) {
  if (process.platform === "win32") return;
  const mode = Number(stats.mode & 0o777n);
  if ((mode & 0o077) !== 0) {
    fail("STORE_DIRECTORY_MODE", `${label} must not be group/world accessible`, { mode });
  }
  if (typeof process.getuid === "function" && Number(stats.uid) !== process.getuid()) {
    fail("STORE_DIRECTORY_OWNER", `${label} must be owned by the runtime user`);
  }
}

function assertPrivateFileStats(stats, label, { expectedLinks = 1 } = {}) {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail("UNSAFE_STORE_ENTRY", `${label} must be a non-symlink regular file`);
  }
  if (stats.size > BigInt(MAX_STORE_FILE_BYTES)) {
    fail("STORE_ENTRY_OVERSIZE", `${label} exceeds ${MAX_STORE_FILE_BYTES} bytes`);
  }
  if (process.platform !== "win32") {
    const mode = Number(stats.mode & 0o777n);
    if (mode !== 0o600) fail("STORE_FILE_MODE", `${label} must have mode 0600`, { mode });
    if (typeof process.getuid === "function" && Number(stats.uid) !== process.getuid()) {
      fail("STORE_FILE_OWNER", `${label} must be owned by the runtime user`);
    }
    if (stats.nlink !== BigInt(expectedLinks)) {
      fail("STORE_FILE_LINK_COUNT", `${label} must have exactly ${expectedLinks} hard link(s)`, {
        nlink: String(stats.nlink),
      });
    }
  }
}

function assertAnchoredCwd(expectedStats, expectedReal, label) {
  const actualStats = statSync(".", { bigint: true });
  const actualIdentity = identity(actualStats);
  if (!sameIdentity(actualIdentity, expectedStats)) {
    fail("STORE_DIRECTORY_IDENTITY", `${label} changed while anchoring`, {
      expected: expectedStats,
      actual: actualIdentity,
    });
  }
  const actualReal = canonicalReal(".");
  if (actualReal !== expectedReal) {
    fail("STORE_DIRECTORY_REALPATH", `${label} resolved outside its anchored path`, {
      expected: expectedReal,
      actual: actualReal,
    });
  }
}

function createOrInspectDirectory(segment, relativeCurrent, create) {
  safeSegment(segment);
  if (!existsSync(segment)) {
    if (!create) fail("STORE_DIRECTORY_MISSING", `${relativeCurrent} does not exist`);
    try {
      mkdirSync(segment, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const stats = lstatSync(segment, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail("UNSAFE_STORE_PATH", `${relativeCurrent} is not a non-symlink directory`);
  }
  if (relativeCurrent === PRIVATE_PREFIX || relativeCurrent.startsWith(`${PRIVATE_PREFIX}/`)) {
    assertPrivateDirectory(stats, relativeCurrent);
  }
  return stats;
}

function anchorSegments(segments, { create }) {
  let expectedReal = canonicalReal(".");
  let relativeCurrent = "";
  for (const segment of segments) {
    relativeCurrent = relativeCurrent ? `${relativeCurrent}/${segment}` : segment;
    const before = createOrInspectDirectory(segment, relativeCurrent, create);
    const expectedIdentity = identity(before);
    expectedReal = expectedRealChild(expectedReal, segment);
    process.chdir(segment);
    assertAnchoredCwd(expectedIdentity, expectedReal, relativeCurrent);
    if (relativeCurrent === PRIVATE_PREFIX || relativeCurrent.startsWith(`${PRIVATE_PREFIX}/`)) {
      assertPrivateDirectory(statSync(".", { bigint: true }), relativeCurrent);
    }
  }
  return { expectedReal, expectedIdentity: identity(statSync(".", { bigint: true })) };
}

function syncCwd() {
  if (process.platform === "win32") return;
  const descriptor = openSync(".", constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readSafeRelativeFile(name, { expectedIdentity, expectedLinks = 1 } = {}) {
  safeSegment(name, "targetName");
  const inspected = lstatSync(name, { bigint: true });
  assertPrivateFileStats(inspected, name, { expectedLinks });
  const descriptor = openSync(name, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assertPrivateFileStats(opened, name, { expectedLinks });
    const openedIdentity = identity(opened);
    if (!sameIdentity(identity(inspected), openedIdentity)) {
      fail("STORE_FILE_IDENTITY", `${name} changed between inspection and open`);
    }
    if (expectedIdentity && !sameIdentity(expectedIdentity, openedIdentity)) {
      fail("STORE_FILE_IDENTITY", `${name} is not the runtime-created filesystem object`, {
        expected: expectedIdentity,
        actual: openedIdentity,
      });
    }
    return { bytes: readFileSync(descriptor), identity: openedIdentity, stats: opened };
  } finally {
    closeSync(descriptor);
  }
}

function testOnlyHook(request, point, tempName) {
  const hook = request.testOnlyHook;
  if (!hook || hook.point !== point) return;
  if (process.env.HPI_VALIDATION_STORE_TEST_HOOKS !== "1") {
    fail("STORE_TEST_HOOK_DISABLED", "store race hooks are disabled outside tests");
  }
  if (hook.kind === "INSERT_TARGET") {
    const bytes = decodeBytes(hook.bytesBase64, "test hook entry");
    const descriptor = openSync(
      request.targetName,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      if (process.platform !== "win32") fchmodSync(descriptor, 0o600);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    return;
  }
  if (hook.kind === "REPLACE_LINKED_TARGET") {
    if (point !== "AFTER_LINK" || !tempName) {
      fail("STORE_TEST_HOOK", "REPLACE_LINKED_TARGET requires AFTER_LINK");
    }
    const replacement = `.${request.targetName}.${randomUUID()}.replacement.tmp`;
    const sourceBytes = readFileSync(tempName);
    unlinkSync(request.targetName);
    const descriptor = openSync(
      replacement,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      if (process.platform !== "win32") fchmodSync(descriptor, 0o600);
      writeFileSync(descriptor, sourceBytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    linkSync(replacement, request.targetName);
    return;
  }
  if (hook.kind === "MOVE_ANCHORED_DIRECTORY_OUTSIDE") {
    const outside = hook.outsidePath;
    const outsideStats = lstatSync(outside, { bigint: true });
    if (!outsideStats.isDirectory() || outsideStats.isSymbolicLink()) {
      fail("STORE_TEST_HOOK_OUTSIDE", "outsidePath must be a non-symlink directory");
    }
    const current = canonicalReal(".");
    const moved = join(outside, `anchored-${randomUUID()}`);
    try {
      renameSync(current, moved);
    } catch (error) {
      fail("STORE_DIRECTORY_SWAP_BLOCKED", "the platform blocked anchored-directory relocation", {
        causeCode: error?.code,
      });
    }
    mkdirSync(current, { mode: 0o700 });
    return;
  }
  if (hook.kind === "SWAP_ANCHORED_DIRECTORY") {
    const outside = hook.outsidePath;
    const outsideStats = lstatSync(outside, { bigint: true });
    if (!outsideStats.isDirectory() || outsideStats.isSymbolicLink()) {
      fail("STORE_TEST_HOOK_OUTSIDE", "outsidePath must be a non-symlink directory");
    }
    const current = canonicalReal(".");
    const moved = `${current}.anchored-${randomUUID()}`;
    try {
      renameSync(current, moved);
    } catch (error) {
      fail("STORE_DIRECTORY_SWAP_BLOCKED", "the platform blocked anchored-directory replacement", {
        causeCode: error?.code,
      });
    }
    symlinkSync(outside, current, process.platform === "win32" ? "junction" : "dir");
    return;
  }
  fail("STORE_TEST_HOOK", `unknown test hook ${String(hook.kind)}`, { tempName });
}

function unlinkOwnedRelativeName(name, expectedIdentity) {
  let inspected;
  try {
    inspected = lstatSync(name, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (
    !inspected.isFile() ||
    inspected.isSymbolicLink() ||
    !sameIdentity(identity(inspected), expectedIdentity)
  ) {
    fail("STORE_TEMP_IDENTITY", `${name} is no longer the runtime-created temporary file`);
  }
  unlinkSync(name);
  return true;
}

function publishRelative(request, bytes, assertAuthority = () => {}) {
  const target = safeSegment(request.targetName, "targetName");
  const temp = `.${target}.${randomUUID()}.tmp`;
  let descriptor;
  let tempIdentity;
  let cleanupPermitted = false;
  try {
    assertAuthority();
    testOnlyHook(request, "AFTER_AUTHORITY_PRECHECK", temp);
    descriptor = openSync(
      temp,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    if (process.platform !== "win32") fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const written = fstatSync(descriptor, { bigint: true });
    assertPrivateFileStats(written, temp);
    tempIdentity = identity(written);
    cleanupPermitted = true;

    assertAuthority();
    testOnlyHook(request, "BEFORE_LINK", temp);
    try {
      linkSync(temp, target);
    } catch (error) {
      if (!existsSync(target)) {
        fail("STORE_ATOMIC_NO_REPLACE", "atomic no-replace publication is unavailable", {
          causeCode: error?.code,
        });
      }
      const existing = readSafeRelativeFile(target);
      if (!existing.bytes.equals(bytes)) {
        fail("IMMUTABLE_FILE_CONFLICT", `existing immutable file differs: ${target}`);
      }
      assertAuthority();
      unlinkOwnedRelativeName(temp, tempIdentity);
      cleanupPermitted = false;
      syncCwd();
      return { replay: true };
    }

    testOnlyHook(request, "AFTER_LINK", temp);
    assertAuthority();
    const linked = readSafeRelativeFile(target, {
      expectedIdentity: tempIdentity,
      expectedLinks: 2,
    });
    if (!linked.bytes.equals(bytes)) {
      fail("STORE_POST_PUBLISH_MISMATCH", `${target} differs immediately after publication`);
    }

    unlinkOwnedRelativeName(temp, tempIdentity);
    cleanupPermitted = false;
    syncCwd();
    const stillOpen = fstatSync(descriptor, { bigint: true });
    assertPrivateFileStats(stillOpen, target);
    if (!sameIdentity(identity(stillOpen), tempIdentity)) {
      fail("STORE_FILE_IDENTITY", "published object identity changed while its temp descriptor remained open");
    }
    assertAuthority();
    const persisted = readSafeRelativeFile(target, { expectedIdentity: tempIdentity });
    if (!persisted.bytes.equals(bytes)) {
      fail("STORE_POST_PUBLISH_MISMATCH", `${target} differs after durable publication`);
    }
    assertAuthority();
    return { replay: false };
  } catch (error) {
    if (cleanupPermitted && tempIdentity) {
      try {
        assertAuthority();
        if (unlinkOwnedRelativeName(temp, tempIdentity)) syncCwd();
      } catch {
        // Hostile namespace drift leaves visible residue rather than deleting an unbound entry.
      }
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateTarget(area, name) {
  const pattern = AREAS[area];
  if (!pattern) fail("STORE_WORKER_AREA", `unsupported store area ${String(area)}`);
  if (!pattern.test(name)) fail("STORE_WORKER_FILENAME", `${name} is invalid for ${area}`);
}

function decodeBytes(value, label) {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    fail("STORE_WORKER_BYTES", `${label} must be canonical padded base64 text`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > MAX_STORE_FILE_BYTES) {
    fail("STORE_ENTRY_OVERSIZE", `${label} exceeds ${MAX_STORE_FILE_BYTES} bytes`);
  }
  return bytes;
}

function assertInitialRoot(request) {
  const expected = request.rootIdentity;
  if (!expected || typeof expected.dev !== "string" || typeof expected.ino !== "string") {
    fail("STORE_WORKER_ROOT_IDENTITY", "rootIdentity is required");
  }
  const actual = identity(statSync(".", { bigint: true }));
  if (!sameIdentity(actual, expected)) {
    fail("STORE_WORKER_ROOT_IDENTITY", "project root changed before worker start", { expected, actual });
  }
  const actualReal = canonicalReal(".");
  const expectedReal = process.platform === "win32"
    ? normalize(request.rootRealpath).toLowerCase()
    : normalize(request.rootRealpath);
  if (actualReal !== expectedReal) {
    fail("STORE_WORKER_ROOT_REALPATH", "project root realpath changed before worker start", {
      expected: expectedReal,
      actual: actualReal,
    });
  }
}

function attemptSegments(attemptId, child) {
  const prefix = VALIDATION_STORE_PREFIX.split("/");
  return [...prefix, validationAttemptId(attemptId), ...(child ? [safeSegment(child, "area")] : [])];
}

function ensureAttemptChildren() {
  for (const child of Object.keys(AREAS)) {
    createOrInspectDirectory(child, `${VALIDATION_STORE_PREFIX}/<attempt>/${child}`, true);
  }
}

function acquireLock(request) {
  const anchored = anchorSegments(attemptSegments(request.attemptId), { create: true });
  ensureAttemptChildren();
  try {
    mkdirSync(".lock", { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("ATTEMPT_LOCKED", `attempt ${request.attemptId} is locked`);
    throw error;
  }
  const lockStats = createOrInspectDirectory(".lock", `${VALIDATION_STORE_PREFIX}/${request.attemptId}/.lock`, false);
  const lockIdentity = identity(lockStats);
  const lockReal = expectedRealChild(anchored.expectedReal, ".lock");
  process.chdir(".lock");
  assertAnchoredCwd(lockIdentity, lockReal, ".lock");
  try {
    const ownerBytes = decodeBytes(request.bytesBase64, "lock owner");
    const published = publishRelative(
      { ...request, targetName: "owner.json" },
      ownerBytes,
      () => assertAnchoredCwd(lockIdentity, lockReal, ".lock"),
    );
    if (published.replay) fail("ATTEMPT_LOCKED", `attempt ${request.attemptId} already has a lock owner`);
    assertAnchoredCwd(lockIdentity, lockReal, ".lock");
    return { replay: false };
  } catch (error) {
    // Do not delete through a pathname after a failed acquire. Residue is intentional fail-closed evidence.
    throw error;
  }
}

function releaseLock(request) {
  const anchored = anchorSegments(attemptSegments(request.attemptId), { create: false });
  const lockStats = createOrInspectDirectory(".lock", `${VALIDATION_STORE_PREFIX}/${request.attemptId}/.lock`, false);
  const lockIdentity = identity(lockStats);
  const lockReal = expectedRealChild(anchored.expectedReal, ".lock");
  process.chdir(".lock");
  assertAnchoredCwd(lockIdentity, lockReal, ".lock");
  const ownerEntry = readSafeRelativeFile("owner.json");
  let owner;
  try {
    owner = JSON.parse(ownerEntry.bytes.toString("utf8"));
  } catch (error) {
    fail("UNSAFE_ATTEMPT_LOCK", "lock owner must be valid JSON", { cause: String(error) });
  }
  if (owner?.attempt_id !== request.attemptId || owner?.lock_token !== request.lockToken) {
    fail("ATTEMPT_LOCK_IDENTITY", "lock token or attempt identity differs");
  }
  assertAnchoredCwd(lockIdentity, lockReal, ".lock");
  unlinkOwnedRelativeName("owner.json", ownerEntry.identity);
  syncCwd();
  process.chdir("..");
  assertAnchoredCwd(anchored.expectedIdentity, anchored.expectedReal, "attempt root");
  const currentLock = lstatSync(".lock", { bigint: true });
  if (
    !currentLock.isDirectory() ||
    currentLock.isSymbolicLink() ||
    !sameIdentity(identity(currentLock), lockIdentity)
  ) {
    fail("ATTEMPT_LOCK_IDENTITY", "lock directory changed before release");
  }
  rmdirSync(".lock");
  syncCwd();
  return { released: true };
}

function publish(request) {
  validateTarget(request.area, request.targetName);
  const anchored = anchorSegments(attemptSegments(request.attemptId, request.area), { create: true });
  testOnlyHook(request, "AFTER_ANCHOR", undefined);
  const bytes = decodeBytes(request.bytesBase64, "store entry");
  const result = publishRelative(
    request,
    bytes,
    () => assertAnchoredCwd(anchored.expectedIdentity, anchored.expectedReal, request.area),
  );
  assertAnchoredCwd(anchored.expectedIdentity, anchored.expectedReal, request.area);
  return result;
}

function execute(request) {
  assertInitialRoot(request);
  if (request.op === "publish") return publish(request);
  if (request.op === "acquire_lock") return acquireLock(request);
  if (request.op === "release_lock") return releaseLock(request);
  fail("STORE_WORKER_OPERATION", `unsupported operation ${String(request.op)}`);
}

function main() {
  try {
    const raw = readFileSync(0);
    if (raw.length > MAX_REQUEST_BYTES) fail("STORE_WORKER_REQUEST", "worker request is oversized");
    const request = JSON.parse(raw.toString("utf8"));
    const result = execute(request);
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    const output = {
      ok: false,
      error: {
        code: typeof error?.code === "string" ? error.code : "STORE_WORKER_FAILURE",
        message: error instanceof Error ? error.message : String(error),
        details: error?.details ?? {},
      },
    };
    process.stderr.write(`${JSON.stringify(output)}\n`);
    process.exitCode = 1;
  }
}

main();
