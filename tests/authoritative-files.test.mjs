import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  inspectAuthoritativeFiles,
  readAuthoritativeFiles,
} from "../src/adapters/authoritative-files.mjs";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "hpi-authority-root-"));
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "README.md"), "root\n", "utf8");
  writeFileSync(join(root, "nested", "current.md"), "current\n", "utf8");
  return root;
}

const files = Object.freeze({ root: "README.md", current: "nested/current.md" });

describe("bounded authoritative Adapter files", () => {
  it("reads only regular declared files inside the project root", () => {
    const root = fixtureRoot();
    try {
      const inspected = inspectAuthoritativeFiles(root, files, { maxBytes: 1024 });
      assert.equal(inspected.available, true);
      assert.deepEqual(inspected.missing, []);
      assert.deepEqual(inspected.unsafe, []);
      assert.deepEqual(readAuthoritativeFiles(root, files, { maxBytes: 1024 }), {
        root: "root\n",
        current: "current\n",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects final and intermediate symlinks instead of following provenance outside the root", () => {
    const outside = mkdtempSync(join(tmpdir(), "hpi-authority-outside-"));
    writeFileSync(join(outside, "secret.md"), "secret\n", "utf8");
    writeFileSync(join(outside, "current.md"), "outside current\n", "utf8");

    const finalRoot = fixtureRoot();
    rmSync(join(finalRoot, "README.md"));
    symlinkSync(join(outside, "secret.md"), join(finalRoot, "README.md"));
    try {
      const inspected = inspectAuthoritativeFiles(finalRoot, files);
      assert.equal(inspected.available, false);
      assert.equal(inspected.unsafe.length, 1);
      assert.match(inspected.unsafe[0].error, /symbolic link/);
      assert.throws(() => readAuthoritativeFiles(finalRoot, files), /unavailable/);
    } finally {
      rmSync(finalRoot, { recursive: true, force: true });
    }

    const intermediateRoot = fixtureRoot();
    rmSync(join(intermediateRoot, "nested"), { recursive: true, force: true });
    symlinkSync(outside, join(intermediateRoot, "nested"));
    try {
      const inspected = inspectAuthoritativeFiles(intermediateRoot, files);
      assert.equal(inspected.available, false);
      assert.equal(inspected.unsafe.length, 1);
      assert.match(inspected.unsafe[0].error, /symbolic link/);
    } finally {
      rmSync(intermediateRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects oversized and non-regular authority inputs", () => {
    const oversizedRoot = fixtureRoot();
    writeFileSync(join(oversizedRoot, "README.md"), "x".repeat(1025), "utf8");
    try {
      const inspected = inspectAuthoritativeFiles(oversizedRoot, files, { maxBytes: 1024 });
      assert.equal(inspected.available, false);
      assert.match(inspected.unsafe[0].error, /exceeds 1024 bytes/);
    } finally {
      rmSync(oversizedRoot, { recursive: true, force: true });
    }

    const directoryRoot = fixtureRoot();
    rmSync(join(directoryRoot, "README.md"));
    mkdirSync(join(directoryRoot, "README.md"));
    try {
      const inspected = inspectAuthoritativeFiles(directoryRoot, files);
      assert.equal(inspected.available, false);
      assert.match(inspected.unsafe[0].error, /not a regular file/);
    } finally {
      rmSync(directoryRoot, { recursive: true, force: true });
    }
  });
});
