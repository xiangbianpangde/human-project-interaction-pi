import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { TS001_FILES, loadTs001Pilot, normalizeTs001Pilot } from "../src/adapter.mjs";
import { ProjectionError, projectSource, rebuildTs001Projection } from "../src/projector.mjs";

const root = new URL("..", import.meta.url);
const rootPath = decodeURIComponent(root.pathname);
const sourceTexts = Object.fromEntries(
  Object.entries(TS001_FILES).map(([key, filename]) => [key, readFileSync(new URL(`../${filename}`, import.meta.url), "utf8")]),
);

describe("content-addressed HPS projection", () => {
  it("rebuilds byte-for-byte equivalent derived views from identical sources", () => {
    const first = rebuildTs001Projection(rootPath);
    const rebuiltAfterDiscard = rebuildTs001Projection(rootPath);
    assert.deepEqual(rebuiltAfterDiscard, first);
    assert.equal(rebuiltAfterDiscard.hps.projectionId, first.hps.projectionId);
    assert.equal(rebuiltAfterDiscard.briefs[0].briefId, first.briefs[0].briefId);
    assert.match(first.hps.projectionId, /^[a-f0-9]{64}$/);
    assert.match(first.briefs[0].briefId, /^HB-[a-f0-9]{64}$/);
  });

  it("changes projectionId when an upstream source snapshot changes", () => {
    const original = projectSource(loadTs001Pilot(rootPath));
    const changedSource = normalizeTs001Pilot({
      contractText: sourceTexts.contract,
      prdText: `${sourceTexts.prd}\n<!-- source revision fixture -->\n`,
      technicalDesignText: sourceTexts.technicalDesign,
    });
    const changed = projectSource(changedSource);
    assert.notEqual(changed.sourceDigest, original.sourceDigest);
    assert.notEqual(changed.hps.projectionId, original.hps.projectionId);
  });

  it("rejects a forged sourceDigest even when it has valid SHA-256 syntax", () => {
    const forged = loadTs001Pilot(rootPath);
    forged.sourceDigest = "0".repeat(64);
    assert.throws(
      () => projectSource(forged),
      /sourceDigest does not match the adapter and source snapshot/,
    );
  });
});

describe("semantic trace and orphan protection", () => {
  it("links Pain → TaskSlice and TaskSlice → Design / MachineResult", () => {
    const projection = rebuildTs001Projection(rootPath);
    const relations = projection.traces.map((trace) => trace.relation);
    assert.ok(relations.includes("motivates"));
    assert.ok(relations.includes("implements"));
    assert.ok(relations.includes("derives"));
    assert.deepEqual(
      projection.hps.traceLinkIds,
      [...projection.hps.traceLinkIds].sort(),
    );
  });

  it("rejects a TaskSlice with no Pain or Design association", () => {
    const source = loadTs001Pilot(rootPath);
    source.activeWork[0] = { ...source.activeWork[0], painRefs: [], designRefs: [] };
    assert.throws(() => projectSource(source), ProjectionError);
  });

  it("rejects duplicate logical ids before Brief and Trace can diverge", () => {
    const cases = [
      {
        name: "Pain",
        mutate(source) {
          source.pains.push(structuredClone(source.pains[0]));
        },
        expected: /duplicate id/,
      },
      {
        name: "Design",
        mutate(source) {
          source.designPoints.push(structuredClone(source.designPoints[0]));
        },
        expected: /duplicate id/,
      },
      {
        name: "TaskSlice",
        mutate(source) {
          source.activeWork.push(structuredClone(source.activeWork[0]));
        },
        expected: /duplicate taskId/,
      },
      {
        name: "MachineResult id",
        mutate(source) {
          const duplicate = structuredClone(source.machineResults[0]);
          duplicate.taskId = "TS-OTHER";
          source.machineResults.push(duplicate);
        },
        expected: /duplicate resultId/,
      },
      {
        name: "MachineResult task",
        mutate(source) {
          const duplicate = structuredClone(source.machineResults[0]);
          duplicate.resultId = "MR-OTHER";
          source.machineResults.push(duplicate);
        },
        expected: /duplicate taskId/,
      },
      {
        name: "EscalationRequest",
        mutate(source) {
          source.escalationRequests.push(structuredClone(source.escalationRequests[0]));
        },
        expected: /duplicate requestId/,
      },
    ];
    for (const testCase of cases) {
      const source = loadTs001Pilot(rootPath);
      testCase.mutate(source);
      assert.throws(() => projectSource(source), testCase.expected, testCase.name);
    }
  });
});

describe("deterministic Human Brief", () => {
  it("keeps machine and human states independent", () => {
    const projection = rebuildTs001Projection(rootPath);
    assert.equal(projection.hps.activeWork[0].machineStatus, "NOT-RUN");
    assert.equal(projection.hps.activeWork[0].humanStatus, "HUMAN_PENDING");
    assert.equal(projection.hps.phase, "HUMAN_DECISION_PENDING");
  });

  it("never hides NOT-RUN, remaining work, or risk", () => {
    const projection = rebuildTs001Projection(rootPath);
    const brief = projection.briefs[0];
    assert.match(brief.headline, /NOT-RUN/);
    assert.ok(brief.machineNotVerified.some((line) => line.includes("NOT-RUN")));
    assert.ok(brief.remaining.some((line) => line.includes("四组工程测试")));
    assert.ok(brief.remaining.some((line) => line.startsWith("明确未完成：")));
    assert.ok(brief.risks.length > 0);
  });

  it("labels injected agent claims as self-reported rather than verified", () => {
    const projection = rebuildTs001Projection(rootPath, {
      selfReports: ["117/117 tests passed", "hash verified"],
    });
    const brief = projection.briefs[0];
    assert.equal(brief.machineVerified.length, 0);
    assert.equal(brief.machineNotVerified.filter((line) => line.includes("Agent 自报")).length, 2);
    assert.equal(projection.hps.evidenceSummary.selfReported, 2);
    assert.equal(projection.hps.activeWork[0].machineStatus, "NOT-RUN");
  });
});
