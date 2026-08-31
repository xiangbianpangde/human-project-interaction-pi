import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AdapterError,
  TS001_FILES,
  detectTs001Pilot,
  loadTs001Pilot,
  normalizeTs001Pilot,
  parseFrontmatter,
} from "../src/adapter.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceTexts = Object.fromEntries(
  Object.entries(TS001_FILES).map(([key, filename]) => [key, readFileSync(new URL(`../${filename}`, import.meta.url), "utf8")]),
);

describe("frontmatter parsing", () => {
  it("reads the TS-001 contract identity and closed arrays", () => {
    const parsed = parseFrontmatter(sourceTexts.contract, TS001_FILES.contract);
    assert.equal(parsed.data.contract_id, "TS1-TEST-001");
    assert.equal(parsed.data.revision, 1);
    assert.equal(parsed.data.test_status, "NOT-RUN");
    assert.deepEqual(parsed.data.task_slices, ["TS001-IMPL", "TS001-VAL"]);
  });

  it("fails closed on missing or duplicate frontmatter", () => {
    assert.throws(() => parseFrontmatter("# no frontmatter"), AdapterError);
    assert.throws(
      () => parseFrontmatter("---\nid: one\nid: two\n---\nbody"),
      /duplicate frontmatter key/,
    );
  });
});

describe("TS-001 pilot detection", () => {
  it("finds all three authoritative pilot inputs", () => {
    const result = detectTs001Pilot(root);
    assert.equal(result.available, true);
    assert.deepEqual(result.missing, []);
  });

  it("reports an unavailable adapter without creating files", () => {
    const result = detectTs001Pilot("/tmp/hpi-definitely-missing-project");
    assert.equal(result.available, false);
    assert.equal(result.missing.length, 3);
  });
});

describe("TS-001 normalization", () => {
  it("is deterministic for identical source snapshots", () => {
    const first = loadTs001Pilot(root);
    const second = loadTs001Pilot(root);
    assert.deepEqual(second, first);
    assert.equal(second.sourceDigest, first.sourceDigest);
    assert.equal(first.sourceSnapshot.length, 3);
  });

  it("keeps 117/117 and hash claims self-reported under authoritative NOT-RUN", () => {
    const source = loadTs001Pilot(root, {
      selfReports: ["117/117 tests passed", "hash verified", "所有测试成功"],
    });
    const result = source.machineResults[0];
    assert.equal(source.authority.machineStatus, "NOT-RUN");
    assert.equal(result.verdict, "NOT-RUN");
    assert.deepEqual(
      result.facts.slice(1).map((fact) => fact.status),
      ["SELF_REPORTED", "SELF_REPORTED", "SELF_REPORTED"],
    );
    assert.equal(source.escalationRequests[0].category, "DESIGN");
    assert.doesNotMatch(source.escalationRequests[0].question, /117|hash|哈希|相信/iu);
  });

  it("rejects an authority drift away from NOT-RUN instead of guessing", () => {
    const changed = sourceTexts.contract.replace("test_status: NOT-RUN", "test_status: PASS-ENGINEERING");
    assert.throws(
      () =>
        normalizeTs001Pilot({
          contractText: changed,
          prdText: sourceTexts.prd,
          technicalDesignText: sourceTexts.technicalDesign,
        }),
      /requires authoritative test_status NOT-RUN/,
    );
  });

  it("does not accept proposed design documents as implemented state", () => {
    const changedPrd = sourceTexts.prd.replace("status: proposed", "status: implemented");
    assert.throws(
      () =>
        normalizeTs001Pilot({
          contractText: sourceTexts.contract,
          prdText: changedPrd,
          technicalDesignText: sourceTexts.technicalDesign,
        }),
      /must remain proposed inputs/,
    );
  });
});
