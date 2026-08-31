import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolvePiAgentDir } from "../src/pi-paths.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(packageRoot, "skills", "task", "human-project-interaction");
const validator = join(
  resolvePiAgentDir(),
  "skills",
  "task",
  "skill-authoring",
  "scripts",
  "validate.py",
);

if (!existsSync(validator)) {
  console.error(`Governed Skill validator is unavailable: ${validator}`);
  console.error("Install skill-authoring in PI_CODING_AGENT_DIR or set HPI_PI_AGENT_DIR for validation.");
  process.exitCode = 1;
} else {
  const result = spawnSync("python3", [validator, "--strict", skillPath], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
