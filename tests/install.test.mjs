import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { install, installationPlan, status, uninstall } from "../scripts/link-install.mjs";
import { loadPiExtensions, resolvePiPackageRoot } from "./support/pi-runtime.mjs";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots = [];

async function temporaryAgentDir() {
  const root = await mkdtemp(join(tmpdir(), "hpi-link-test-"));
  temporaryRoots.push(root);
  return join(root, "agent");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Pi path resolution", () => {
  it("locates the installed Pi package without a Homebrew-specific absolute import", () => {
    assert.match(resolvePiPackageRoot(), /pi-coding-agent$/);
  });

  it("honors Pi's documented config variable with explicit package overrides first", () => {
    const root = rootPath;
    const target = (env) => installationPlan({ root, env })[0].target;
    assert.equal(
      target({ HPI_PI_AGENT_DIR: "/hpi", PI_CODING_AGENT_DIR: "/pi", PI_AGENT_DIR: "/legacy", HOME: "/home" }),
      "/hpi/skills/task/human-project-interaction",
    );
    assert.equal(
      target({ PI_CODING_AGENT_DIR: "/pi", PI_AGENT_DIR: "/legacy", HOME: "/home" }),
      "/pi/skills/task/human-project-interaction",
    );
    assert.equal(
      target({ PI_AGENT_DIR: "/legacy", HOME: "/home" }),
      "/legacy/skills/task/human-project-interaction",
    );
    assert.equal(
      target({ HOME: "/home" }),
      "/home/.pi/agent/skills/task/human-project-interaction",
    );
  });
});

describe("reversible Pi link installation", () => {
  it("links one source tree and loads the extension through its installed package entry", async () => {
    const agentDir = await temporaryAgentDir();
    const first = await install({ root: rootPath, agentDir });
    assert.deepEqual(first.map((item) => item.state), ["linked", "linked", "linked"]);

    for (const item of first) {
      assert.equal((await lstat(item.target)).isSymbolicLink(), true);
      assert.equal(resolve(join(item.target, ".."), await readlink(item.target)), item.source);
    }

    const loaded = await loadPiExtensions([join(agentDir, "extensions/hpi/index.ts")], rootPath);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.deepEqual([...loaded.extensions[0].tools.keys()].sort(), ["hpi_propose", "hpi_query"]);

    const skill = await readFile(join(agentDir, "skills/task/human-project-interaction/SKILL.md"), "utf8");
    const manifest = JSON.parse(
      await readFile(join(agentDir, "talk/styles/hpi-project/manifest.json"), "utf8"),
    );
    const wireManifest = JSON.parse(
      await readFile(join(agentDir, "extensions/hpi/schemas/manifest.v1.json"), "utf8"),
    );
    assert.match(skill, /name: human-project-interaction/);
    assert.equal(manifest.id, "hpi-project");
    assert.equal(wireManifest.schema_set, "hpi/wire/v1");
    assert.match(wireManifest.schema_set_digest, /^[a-f0-9]{64}$/);

    const replay = await install({ root: rootPath, agentDir });
    assert.deepEqual(replay.map((item) => item.state), ["linked", "linked", "linked"]);

    const removed = await uninstall({ root: rootPath, agentDir });
    assert.deepEqual(removed.map((item) => item.state), ["missing", "missing", "missing"]);
  });

  it("preflights collisions and leaves every target unchanged", async () => {
    const agentDir = await temporaryAgentDir();
    const conflict = join(agentDir, "extensions/hpi");
    await mkdir(conflict, { recursive: true });

    await assert.rejects(
      install({ root: rootPath, agentDir }),
      (error) => error.code === "HPI_INSTALL_CONFLICT" && /extension/.test(error.message),
    );
    const states = await status({ root: rootPath, agentDir });
    assert.deepEqual(states.map((item) => item.state), ["missing", "conflict", "missing"]);
    assert.equal((await lstat(conflict)).isDirectory(), true);
  });

  it("refuses uninstall when any target no longer points to this package", async () => {
    const agentDir = await temporaryAgentDir();
    const linked = await install({ root: rootPath, agentDir });
    const extension = linked.find((item) => item.id === "extension");
    const other = join(agentDir, "other-extension");
    await mkdir(other, { recursive: true });
    await unlink(extension.target);
    await symlink(other, extension.target, "dir");

    await assert.rejects(
      uninstall({ root: rootPath, agentDir }),
      (error) => error.code === "HPI_INSTALL_CONFLICT" && /extension/.test(error.message),
    );
    const states = await status({ root: rootPath, agentDir });
    assert.deepEqual(states.map((item) => item.state), ["linked", "conflict", "linked"]);
  });
});
