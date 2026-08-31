import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, readlink, stat, symlink, unlink } from "node:fs/promises";

import { resolvePiAgentDir } from "../src/pi-paths.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

export function installationPlan(options = {}) {
  const root = resolve(options.root || PACKAGE_ROOT);
  const agentDir = resolve(options.agentDir || resolvePiAgentDir(options.env));
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

export async function status(options = {}) {
  const plan = installationPlan(options);
  return Promise.all(plan.map(classify));
}

export async function install(options = {}) {
  const plan = installationPlan(options);
  await verifySources(plan);
  const before = await Promise.all(plan.map(classify));
  rejectConflicts(before, "install");

  const created = [];
  try {
    for (const item of before) {
      if (item.state === "linked") continue;
      await mkdir(dirname(item.target), { recursive: true });
      await symlink(item.source, item.target, process.platform === "win32" ? "junction" : "dir");
      created.push(item.target);
    }
  } catch (error) {
    for (const target of created.reverse()) {
      try {
        await unlink(target);
      } catch {
        // Best-effort rollback; the original error remains authoritative.
      }
    }
    throw new Error(`HPI install failed and rolled back newly created links: ${error.message}`);
  }
  return status(options);
}

export async function uninstall(options = {}) {
  const before = await status(options);
  rejectConflicts(before, "uninstall");
  for (const item of before) {
    if (item.state === "linked") await unlink(item.target);
  }
  return status(options);
}

function printStates(action, states) {
  console.log(`HPI ${action}`);
  for (const item of states) {
    console.log(`- ${item.id}: ${item.state} (${item.target}${item.state === "linked" ? ` -> ${item.source}` : ""})`);
  }
  if (action === "install") {
    console.log("Boundary: links expose one source tree; HPI still cannot write project canonical state.");
    console.log("Reload Pi so extension, skill, and /talk style discovery run again.");
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
