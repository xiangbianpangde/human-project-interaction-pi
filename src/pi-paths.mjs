import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export function resolvePiAgentDir(env = process.env) {
  return resolve(
    env.HPI_PI_AGENT_DIR ||
      env.PI_CODING_AGENT_DIR ||
      env.PI_AGENT_DIR ||
      join(env.HOME || homedir(), ".pi", "agent"),
  );
}

function isPiPackageRoot(path) {
  const packageJson = join(path, "package.json");
  const loader = join(path, "dist", "core", "extensions", "loader.js");
  if (!existsSync(packageJson) || !existsSync(loader)) return false;
  try {
    return JSON.parse(readFileSync(packageJson, "utf8")).name === PI_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function packageCandidates(path) {
  return [
    resolve(path),
    resolve(path, PI_PACKAGE_NAME),
    resolve(path, "node_modules", PI_PACKAGE_NAME),
  ];
}

function ancestorPackage(path) {
  let current = resolve(path);
  if (!existsSync(current)) return undefined;
  try {
    current = realpathSync(current);
  } catch {
    return undefined;
  }
  current = dirname(current);
  while (true) {
    if (isPiPackageRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function resolvePiPackageRoot(options = {}) {
  const env = options.env ?? process.env;
  const candidates = [];
  for (const configured of [options.packageRoot, env.HPI_PI_PACKAGE_ROOT, env.PI_PACKAGE_DIR]) {
    if (configured) candidates.push(...packageCandidates(configured));
  }

  const finder = process.platform === "win32" ? "where" : "which";
  const executable = options.piExecutable || commandOutput(finder, ["pi"]).split(/\r?\n/u)[0];
  if (executable) {
    const fromExecutable = ancestorPackage(executable);
    if (fromExecutable) candidates.push(fromExecutable);
  }

  const npmRoot = commandOutput("npm", ["root", "-g"]);
  if (npmRoot) candidates.push(...packageCandidates(npmRoot));

  for (const candidate of candidates) {
    if (isPiPackageRoot(candidate)) return candidate;
  }
  throw new Error(
    "Unable to locate @earendil-works/pi-coding-agent; set HPI_PI_PACKAGE_ROOT or ensure pi is on PATH",
  );
}

export function resolvePiExtensionLoader(options = {}) {
  return join(resolvePiPackageRoot(options), "dist", "core", "extensions", "loader.js");
}
