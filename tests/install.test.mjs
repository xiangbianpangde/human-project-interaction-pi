import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  install,
  installationPlan,
  status,
  testOnlyInstallWithHooks,
  testOnlyUninstallWithHooks,
  uninstall,
} from "../scripts/link-install.mjs";
import { loadPiExtensions, resolvePiPackageRoot } from "./support/pi-runtime.mjs";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots = [];

async function temporaryAgentDir() {
  const root = await mkdtemp(join(tmpdir(), "hpi-link-test-"));
  temporaryRoots.push(root);
  return join(root, "agent");
}

async function rejectedError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  assert.fail("operation unexpectedly succeeded");
}

async function assertMissing(path) {
  await assert.rejects(lstat(path), (error) => error.code === "ENOENT");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Pi path resolution", () => {
  it("locates the pinned Pi package without a Homebrew-specific absolute import", () => {
    const packageRoot = join(rootPath, "node_modules", "@earendil-works", "pi-coding-agent");
    assert.equal(resolvePiPackageRoot({ packageRoot }), resolve(packageRoot));
  });

  it("honors Pi's documented config variable with explicit package overrides first", () => {
    const root = rootPath;
    const skillSuffix = ["skills", "task", "human-project-interaction"];
    const target = (env) => installationPlan({ root, env })[0].target;
    assert.equal(
      target({ HPI_PI_AGENT_DIR: "/hpi", PI_CODING_AGENT_DIR: "/pi", PI_AGENT_DIR: "/legacy", HOME: "/home" }),
      resolve("/hpi", ...skillSuffix),
    );
    assert.equal(
      target({ PI_CODING_AGENT_DIR: "/pi", PI_AGENT_DIR: "/legacy", HOME: "/home" }),
      resolve("/pi", ...skillSuffix),
    );
    assert.equal(
      target({ PI_AGENT_DIR: "/legacy", HOME: "/home" }),
      resolve("/legacy", ...skillSuffix),
    );
    assert.equal(
      target({ HOME: "/home" }),
      resolve("/home", ".pi", "agent", ...skillSuffix),
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
    assert.deepEqual([...loaded.extensions[0].tools.keys()].sort(), ["hpi_propose", "hpi_query", "hpi_validation"]);

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
    await symlink(other, extension.target, process.platform === "win32" ? "junction" : "dir");

    await assert.rejects(
      uninstall({ root: rootPath, agentDir }),
      (error) => error.code === "HPI_INSTALL_CONFLICT" && /extension/.test(error.message),
    );
    const states = await status({ root: rootPath, agentDir });
    assert.deepEqual(states.map((item) => item.state), ["linked", "conflict", "linked"]);
  });

  it("retains a regular file or foreign link substituted after uninstall preflight", async () => {
    for (const replacement of ["file", "link"]) {
      const agentDir = await temporaryAgentDir();
      const linked = await install({ root: rootPath, agentDir });
      const skill = linked.find((item) => item.id === "skill");
      const foreignSource = join(agentDir, `foreign-${replacement}`);
      if (replacement === "link") await mkdir(foreignSource, { recursive: true });

      const error = await rejectedError(() => testOnlyUninstallWithHooks(
        { root: rootPath, agentDir },
        {
          beforeRemoval: async ({ item }) => {
            if (item.id !== "skill") return;
            await unlink(item.target);
            if (replacement === "file") {
              await writeFile(item.target, "foreign regular file\n", "utf8");
            } else {
              await symlink(
                foreignSource,
                item.target,
                process.platform === "win32" ? "junction" : "dir",
              );
            }
          },
        },
      ));

      assert.equal(error.code, "HPI_INSTALL_OWNERSHIP_LOST");
      assert.equal(error.details.itemId, "skill");
      assert.match(error.details.quarantinePath, /\.hpi-quarantine-/u);
      await assertMissing(skill.target);
      if (replacement === "file") {
        assert.equal(await readFile(error.details.quarantinePath, "utf8"), "foreign regular file\n");
      } else {
        assert.equal((await lstat(error.details.quarantinePath)).isSymbolicLink(), true);
        assert.equal(
          resolve(dirname(error.details.quarantinePath), await readlink(error.details.quarantinePath)),
          foreignSource,
        );
      }
      const states = await status({ root: rootPath, agentDir });
      assert.deepEqual(states.map((item) => item.state), ["missing", "linked", "linked"]);
    }
  });

  it("rechecks the random quarantine immediately before deleting it", async () => {
    const agentDir = await temporaryAgentDir();
    const linked = await install({ root: rootPath, agentDir });
    const skill = linked.find((item) => item.id === "skill");

    const error = await rejectedError(() => testOnlyUninstallWithHooks(
      { root: rootPath, agentDir },
      {
        beforeQuarantineUnlink: async ({ item, quarantinePath }) => {
          if (item.id !== "skill") return;
          await unlink(quarantinePath);
          await writeFile(quarantinePath, "late foreign replacement\n", "utf8");
        },
      },
    ));

    assert.equal(error.code, "HPI_INSTALL_OWNERSHIP_LOST");
    assert.equal(await readFile(error.details.quarantinePath, "utf8"), "late foreign replacement\n");
    await assertMissing(skill.target);
  });

  it("removes only its managed links when a later install step fails", async () => {
    const agentDir = await temporaryAgentDir();
    const error = await rejectedError(() => testOnlyInstallWithHooks(
      { root: rootPath, agentDir },
      {
        beforeCreate: ({ item }) => {
          if (item.id === "extension") {
            const injected = new Error("injected second-link failure");
            injected.code = "HPI_INSTALL_TEST_FAILURE";
            throw injected;
          }
        },
      },
    ));

    assert.equal(error.code, "HPI_INSTALL_TEST_FAILURE");
    assert.deepEqual(error.details.rollbackErrors, []);
    const states = await status({ root: rootPath, agentDir });
    assert.deepEqual(states.map((item) => item.state), ["missing", "missing", "missing"]);
  });

  it("uses ownership-preserving removal during install rollback", async () => {
    const agentDir = await temporaryAgentDir();
    const plan = installationPlan({ root: rootPath, agentDir });
    const skill = plan.find((item) => item.id === "skill");

    const error = await rejectedError(() => testOnlyInstallWithHooks(
      { root: rootPath, agentDir },
      {
        beforeCreate: ({ item }) => {
          if (item.id === "extension") {
            const injected = new Error("injected second-link failure");
            injected.code = "HPI_INSTALL_TEST_FAILURE";
            throw injected;
          }
        },
        beforeRollbackRemoval: async ({ item }) => {
          if (item.id !== "skill") return;
          await unlink(item.target);
          await writeFile(item.target, "foreign rollback replacement\n", "utf8");
        },
      },
    ));

    assert.equal(error.code, "HPI_INSTALL_ROLLBACK_INCOMPLETE");
    assert.equal(error.details.originalCode, "HPI_INSTALL_TEST_FAILURE");
    assert.equal(error.details.rollbackErrors.length, 1);
    const rollback = error.details.rollbackErrors[0];
    assert.equal(rollback.itemId, "skill");
    assert.equal(rollback.code, "HPI_INSTALL_OWNERSHIP_LOST");
    assert.equal(await readFile(rollback.quarantinePath, "utf8"), "foreign rollback replacement\n");
    await assertMissing(skill.target);
    const states = await status({ root: rootPath, agentDir });
    assert.deepEqual(states.map((item) => item.state), ["missing", "missing", "missing"]);
  });

  it("serializes cooperating installer mutations with a fail-closed lock", async () => {
    const agentDir = await temporaryAgentDir();
    const lockPath = join(agentDir, ".hpi-link-install.lock");
    let enteredResolve;
    let continueResolve;
    const entered = new Promise((resolvePromise) => {
      enteredResolve = resolvePromise;
    });
    const continueInstall = new Promise((resolvePromise) => {
      continueResolve = resolvePromise;
    });
    const first = testOnlyInstallWithHooks(
      { root: rootPath, agentDir },
      {
        beforeCreate: async ({ item }) => {
          if (item.id !== "skill") return;
          enteredResolve();
          await continueInstall;
        },
      },
    );
    await entered;
    try {
      await assert.rejects(
        install({ root: rootPath, agentDir }),
        (error) => error.code === "HPI_INSTALL_LOCKED" && error.details.lockPath === lockPath,
      );
      assert.equal((await lstat(lockPath)).isDirectory(), true);
    } finally {
      continueResolve();
    }
    const states = await first;
    assert.deepEqual(states.map((item) => item.state), ["linked", "linked", "linked"]);
    await assertMissing(lockPath);
  });

  it("does not automatically reclaim a residual installer lock", async () => {
    const agentDir = await temporaryAgentDir();
    const lockPath = join(agentDir, ".hpi-link-install.lock");
    await mkdir(lockPath, { recursive: true });

    await assert.rejects(
      install({ root: rootPath, agentDir }),
      (error) => error.code === "HPI_INSTALL_LOCKED" && error.details.lockPath === lockPath,
    );
    assert.equal((await lstat(lockPath)).isDirectory(), true);
  });
});
