import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";

import { resolvePiAgentDir } from "../src/pi-paths.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_LOCK_NAME = ".hpi-link-install.lock";
const INSTALL_LOCK_SCHEMA = "hpi/link-install-lock/v1";
const MAX_LOCK_OWNER_BYTES = 4096n;

const MANAGED_LINKS = Object.freeze([
  {
    id: "skill",
    source: (root) => join(root, "skills", "task", "human-project-interaction"),
    target: (agentDir) => join(agentDir, "skills", "task", "human-project-interaction"),
  },
  {
    id: "extension",
    // Link the package root so extension/hpi/index.ts can keep ../../src imports.
    source: (root) => root,
    target: (agentDir) => join(agentDir, "extensions", "hpi"),
  },
  {
    id: "talk-style",
    source: (root) => join(root, "talk", "styles", "hpi-project"),
    target: (agentDir) => join(agentDir, "talk", "styles", "hpi-project"),
  },
]);

function piAgentDirectory(options = {}) {
  return resolve(options.agentDir || resolvePiAgentDir(options.env));
}

export function installationPlan(options = {}) {
  const root = resolve(options.root || PACKAGE_ROOT);
  const agentDir = piAgentDirectory(options);
  return MANAGED_LINKS.map((item) => ({
    id: item.id,
    source: resolve(item.source(root)),
    target: resolve(item.target(agentDir)),
  }));
}

async function classify(item) {
  let info;
  try {
    info = await lstat(item.target);
  } catch (error) {
    if (error?.code === "ENOENT") return { ...item, state: "missing" };
    throw error;
  }
  if (!info.isSymbolicLink()) {
    return { ...item, state: "conflict", reason: "target exists and is not a symbolic link" };
  }
  const rawTarget = await readlink(item.target);
  const linkedSource = resolve(dirname(item.target), rawTarget);
  if (linkedSource !== item.source) {
    return {
      ...item,
      state: "conflict",
      reason: `target links to ${linkedSource}`,
      linkedSource,
    };
  }
  return { ...item, state: "linked", linkedSource };
}

async function verifySources(plan) {
  for (const item of plan) {
    let info;
    try {
      info = await stat(item.source);
    } catch (error) {
      throw new Error(`HPI install source is unavailable for ${item.id}: ${item.source} (${error.message})`);
    }
    if (!info.isDirectory()) {
      throw new Error(`HPI install source is not a directory for ${item.id}: ${item.source}`);
    }
  }
}

function rejectConflicts(states, action) {
  const conflicts = states.filter((item) => item.state === "conflict");
  if (!conflicts.length) return;
  const detail = conflicts.map((item) => `${item.id}: ${item.target} (${item.reason})`).join("; ");
  const error = new Error(`HPI ${action} refused: ${detail}`);
  error.code = "HPI_INSTALL_CONFLICT";
  throw error;
}

function entryIdentity(info) {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    mode: String(info.mode),
    size: String(info.size),
    birthtimeNs: String(info.birthtimeNs ?? ""),
  };
}

function sameEntryIdentity(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.birthtimeNs === right.birthtimeNs;
}

async function inspectManagedLink(item, target = item.target) {
  const candidate = { ...item, target };
  let before;
  try {
    before = await lstat(target, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: false, state: "missing", reason: "entry disappeared during ownership verification" };
    }
    throw error;
  }
  const beforeIdentity = entryIdentity(before);
  let classified;
  try {
    classified = await classify(candidate);
  } catch (error) {
    return {
      ok: false,
      state: "conflict",
      reason: `entry could not be classified safely: ${error.code ?? error.message}`,
      beforeIdentity,
    };
  }
  let after;
  try {
    after = await lstat(target, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: false, state: "missing", reason: "entry disappeared during ownership verification" };
    }
    throw error;
  }
  const afterIdentity = entryIdentity(after);
  if (!sameEntryIdentity(beforeIdentity, afterIdentity)) {
    return {
      ok: false,
      state: "conflict",
      reason: "entry identity changed during ownership verification",
      beforeIdentity,
      afterIdentity,
    };
  }
  if (classified.state !== "linked") {
    return {
      ok: false,
      state: classified.state,
      reason: classified.reason ?? "entry is not the expected managed link",
      identity: afterIdentity,
    };
  }
  return { ok: true, identity: afterIdentity };
}

function ownershipLostError(item, action, details = {}) {
  const retained = details.quarantinePath
    ? ` The observed entry was retained at ${details.quarantinePath}.`
    : "";
  const error = new Error(
    `HPI ${action} refused: ${item.id} ownership changed at ${item.target}.${retained}`,
  );
  error.code = "HPI_INSTALL_OWNERSHIP_LOST";
  error.details = {
    itemId: item.id,
    target: item.target,
    ...details,
  };
  return error;
}

async function invokeHook(hooks, name, payload) {
  if (typeof hooks?.[name] === "function") await hooks[name](payload);
}

function quarantinePath(target, purpose) {
  return join(dirname(target), `.${basename(target)}.hpi-${purpose}-${randomUUID()}`);
}

async function removeManagedLink(item, { action, hooks, beforeHook = "beforeRemoval" }) {
  await invokeHook(hooks, beforeHook, { action, item: { ...item } });
  const quarantine = quarantinePath(item.target, "quarantine");
  try {
    await rename(item.target, quarantine);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw ownershipLostError(item, action, {
        reason: "managed entry disappeared before atomic quarantine",
      });
    }
    throw error;
  }

  const quarantined = await inspectManagedLink(item, quarantine);
  if (!quarantined.ok) {
    throw ownershipLostError(item, action, {
      quarantinePath: quarantine,
      observedState: quarantined.state,
      reason: quarantined.reason,
    });
  }

  await invokeHook(hooks, "beforeQuarantineUnlink", {
    action,
    item: { ...item },
    quarantinePath: quarantine,
  });
  const final = await inspectManagedLink(item, quarantine);
  if (!final.ok || !sameEntryIdentity(quarantined.identity, final.identity)) {
    throw ownershipLostError(item, action, {
      quarantinePath: quarantine,
      observedState: final.state,
      reason: final.reason ?? "quarantined entry identity changed before deletion",
    });
  }

  await unlink(quarantine);
}

function installerLockPath(options = {}) {
  return join(piAgentDirectory(options), INSTALL_LOCK_NAME);
}

function installerLockedError(lockPath) {
  const error = new Error(
    `HPI installer is already running or left a fail-closed lock: ${lockPath}`,
  );
  error.code = "HPI_INSTALL_LOCKED";
  error.details = { lockPath };
  return error;
}

async function acquireInstallerLock(options = {}) {
  const agentDir = piAgentDirectory(options);
  const lockPath = installerLockPath(options);
  await mkdir(agentDir, { recursive: true });
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw installerLockedError(lockPath);
    throw error;
  }
  const token = randomUUID();
  const ownerPath = join(lockPath, "owner.json");
  try {
    await writeFile(ownerPath, `${JSON.stringify({
      schema: INSTALL_LOCK_SCHEMA,
      lock_token: token,
      pid: process.pid,
      acquired_at: new Date().toISOString(),
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    const wrapped = new Error(`HPI installer lock initialization failed at ${lockPath}: ${error.message}`);
    wrapped.code = "HPI_INSTALL_LOCK_INIT";
    wrapped.details = { lockPath };
    wrapped.cause = error;
    throw wrapped;
  }
  return { lockPath, ownerPath, token };
}

async function inspectLockDirectory(path) {
  let info;
  try {
    info = await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, reason: "lock directory disappeared" };
    throw error;
  }
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform !== "win32" && Number(info.mode & 0o077n) !== 0) ||
    (process.platform !== "win32" &&
      typeof process.getuid === "function" &&
      Number(info.uid) !== process.getuid())
  ) {
    return { ok: false, reason: "lock path is not a private owned directory" };
  }
  return { ok: true, identity: entryIdentity(info) };
}

async function inspectLockOwner(ownerPath, token) {
  let before;
  try {
    before = await lstat(ownerPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, reason: "lock owner disappeared" };
    throw error;
  }
  const beforeIdentity = entryIdentity(before);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > MAX_LOCK_OWNER_BYTES ||
    (process.platform !== "win32" && Number(before.mode & 0o777n) !== 0o600) ||
    (process.platform !== "win32" &&
      typeof process.getuid === "function" &&
      Number(before.uid) !== process.getuid())
  ) {
    return { ok: false, reason: "lock owner is not a private bounded regular file" };
  }
  let owner;
  try {
    owner = JSON.parse(await readFile(ownerPath, "utf8"));
  } catch (error) {
    return { ok: false, reason: `lock owner is invalid JSON: ${error.message}` };
  }
  let after;
  try {
    after = await lstat(ownerPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, reason: "lock owner disappeared" };
    throw error;
  }
  const afterIdentity = entryIdentity(after);
  if (!sameEntryIdentity(beforeIdentity, afterIdentity)) {
    return { ok: false, reason: "lock owner identity changed during verification" };
  }
  if (
    owner?.schema !== INSTALL_LOCK_SCHEMA ||
    owner?.lock_token !== token
  ) {
    return { ok: false, reason: "lock owner token or schema differs" };
  }
  return { ok: true, identity: afterIdentity };
}

async function releaseInstallerLock(lock) {
  const quarantine = `${lock.lockPath}.release-${randomUUID()}`;
  try {
    await rename(lock.lockPath, quarantine);
  } catch (error) {
    const wrapped = new Error(`HPI installer lock disappeared or changed before release: ${lock.lockPath}`);
    wrapped.code = "HPI_INSTALL_LOCK_LOST";
    wrapped.details = { lockPath: lock.lockPath };
    wrapped.cause = error;
    throw wrapped;
  }
  const lockDirectory = await inspectLockDirectory(quarantine);
  if (!lockDirectory.ok) {
    const error = new Error(`HPI installer lock ownership changed; retained ${quarantine}: ${lockDirectory.reason}`);
    error.code = "HPI_INSTALL_LOCK_LOST";
    error.details = {
      lockPath: lock.lockPath,
      quarantinePath: quarantine,
      reason: lockDirectory.reason,
    };
    throw error;
  }
  const ownerPath = join(quarantine, "owner.json");
  const owner = await inspectLockOwner(ownerPath, lock.token);
  if (!owner.ok) {
    const error = new Error(`HPI installer lock ownership changed; retained ${quarantine}: ${owner.reason}`);
    error.code = "HPI_INSTALL_LOCK_LOST";
    error.details = { lockPath: lock.lockPath, quarantinePath: quarantine, reason: owner.reason };
    throw error;
  }
  const finalDirectory = await inspectLockDirectory(quarantine);
  const final = await inspectLockOwner(ownerPath, lock.token);
  if (
    !finalDirectory.ok ||
    !sameEntryIdentity(lockDirectory.identity, finalDirectory.identity) ||
    !final.ok ||
    !sameEntryIdentity(owner.identity, final.identity)
  ) {
    const error = new Error(`HPI installer lock owner changed before release; retained ${quarantine}`);
    error.code = "HPI_INSTALL_LOCK_LOST";
    error.details = {
      lockPath: lock.lockPath,
      quarantinePath: quarantine,
      reason: finalDirectory.reason ?? final.reason,
    };
    throw error;
  }
  await unlink(ownerPath);
  try {
    await rmdir(quarantine);
  } catch (error) {
    const wrapped = new Error(`HPI installer lock quarantine is not empty; retained ${quarantine}`);
    wrapped.code = "HPI_INSTALL_LOCK_LOST";
    wrapped.details = { lockPath: lock.lockPath, quarantinePath: quarantine };
    wrapped.cause = error;
    throw wrapped;
  }
}

async function withInstallerLock(options, operation) {
  const lock = await acquireInstallerLock(options);
  let value;
  let operationError;
  try {
    value = await operation();
  } catch (error) {
    operationError = error;
  }
  let releaseError;
  try {
    await releaseInstallerLock(lock);
  } catch (error) {
    releaseError = error;
  }
  if (operationError) {
    if (releaseError) {
      operationError.details = {
        ...(operationError.details ?? {}),
        lockReleaseError: {
          code: releaseError.code,
          message: releaseError.message,
          details: releaseError.details,
        },
      };
    }
    throw operationError;
  }
  if (releaseError) throw releaseError;
  return value;
}

function rollbackFailure(originalError, rollbackErrors) {
  const suffix = rollbackErrors.length
    ? `; ${rollbackErrors.length} created entry/entries were retained because ownership changed`
    : "";
  const error = new Error(
    `HPI install failed and rolled back newly created links${suffix}: ${originalError.message}`,
  );
  error.code = rollbackErrors.length
    ? "HPI_INSTALL_ROLLBACK_INCOMPLETE"
    : (originalError.code ?? "HPI_INSTALL_FAILED");
  error.cause = originalError;
  error.details = {
    originalCode: originalError.code,
    rollbackErrors: rollbackErrors.map((entry) => ({
      itemId: entry.item.id,
      code: entry.error.code,
      message: entry.error.message,
      ...(entry.error.details ?? {}),
    })),
  };
  return error;
}

export async function status(options = {}) {
  const plan = installationPlan(options);
  return Promise.all(plan.map(classify));
}

async function installInternal(options = {}, hooks) {
  const plan = installationPlan(options);
  await verifySources(plan);
  return withInstallerLock(options, async () => {
    const before = await Promise.all(plan.map(classify));
    rejectConflicts(before, "install");

    const created = [];
    try {
      for (const item of before) {
        if (item.state === "linked") continue;
        await invokeHook(hooks, "beforeCreate", { item: { ...item }, created: [...created] });
        await mkdir(dirname(item.target), { recursive: true });
        await symlink(item.source, item.target, process.platform === "win32" ? "junction" : "dir");
        created.push(item);
        await invokeHook(hooks, "afterCreate", { item: { ...item }, created: [...created] });
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const item of created.reverse()) {
        try {
          await removeManagedLink(item, {
            action: "install rollback",
            hooks,
            beforeHook: "beforeRollbackRemoval",
          });
        } catch (rollbackError) {
          rollbackErrors.push({ item, error: rollbackError });
        }
      }
      throw rollbackFailure(error, rollbackErrors);
    }
    return status(options);
  });
}

export async function install(options = {}) {
  return installInternal(options);
}

async function uninstallInternal(options = {}, hooks) {
  const initial = await status(options);
  if (initial.every((item) => item.state === "missing")) return initial;
  return withInstallerLock(options, async () => {
    const before = await status(options);
    rejectConflicts(before, "uninstall");
    for (const item of before) {
      if (item.state === "linked") {
        await removeManagedLink(item, { action: "uninstall", hooks });
      }
    }
    return status(options);
  });
}

export async function uninstall(options = {}) {
  return uninstallInternal(options);
}

function assertTestContext() {
  if (process.env.NODE_TEST_CONTEXT === undefined) {
    const error = new Error("HPI installer race hooks are available only under node --test");
    error.code = "HPI_INSTALL_TEST_HOOK_DISABLED";
    throw error;
  }
}

export async function testOnlyInstallWithHooks(options = {}, hooks = {}) {
  assertTestContext();
  return installInternal(options, hooks);
}

export async function testOnlyUninstallWithHooks(options = {}, hooks = {}) {
  assertTestContext();
  return uninstallInternal(options, hooks);
}

function printStates(action, states) {
  console.log(`HPI ${action}`);
  for (const item of states) {
    console.log(`- ${item.id}: ${item.state} (${item.target}${item.state === "linked" ? ` -> ${item.source}` : ""})`);
  }
  if (action === "install") {
    console.log("Boundary: links expose one source tree; HPI still cannot write project canonical state.");
    console.log("Start a fresh Pi process/session so extension, Skill, and /talk discovery use one current module graph.");
    console.log("A /reload may retain stale transitive modules and is not restart or recovery proof.");
  }
}

async function main() {
  const action = (process.argv[2] || "status").toLowerCase();
  if (!new Set(["install", "uninstall", "status"]).has(action)) {
    throw new Error("Usage: node scripts/link-install.mjs [install|uninstall|status]");
  }
  const states = action === "install" ? await install() : action === "uninstall" ? await uninstall() : await status();
  printStates(action, states);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
