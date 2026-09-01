import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolvePiAgentDir } from "../src/pi-paths.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(packageRoot, "skills", "task", "human-project-interaction");
const activeValidator = join(
  resolvePiAgentDir(),
  "skills",
  "task",
  "skill-authoring",
  "scripts",
  "validate.py",
);
const bundledValidator = join(
  packageRoot,
  "scripts",
  "vendor",
  "skill-authoring-validator",
  "validate.py",
);
const validator = existsSync(activeValidator) ? activeValidator : bundledValidator;
const pinnedPiPackage = join(
  packageRoot,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
);
const env = { ...process.env };
if (!env.PI_CODING_AGENT_PACKAGE && existsSync(join(pinnedPiPackage, "dist", "index.js"))) {
  env.PI_CODING_AGENT_PACKAGE = pinnedPiPackage;
}

if (!existsSync(validator)) {
  console.error(`Governed Skill validator is unavailable: ${activeValidator}`);
  console.error(`Bundled validator snapshot is unavailable: ${bundledValidator}`);
  process.exitCode = 1;
} else {
  const result = spawnSync("python3", [validator, "--strict", skillPath], {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
