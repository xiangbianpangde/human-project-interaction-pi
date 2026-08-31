import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rebuildTs001Projection } from "../src/projector.mjs";
import {
  TalkContentError,
  buildTalkContent,
  serializeTalkContent,
  validateTalkContent,
} from "../src/talk-content.mjs";

const rootPath = decodeURIComponent(new URL("..", import.meta.url).pathname);
const projection = rebuildTs001Projection(rootPath);

describe("HPI /talk blueprint", () => {
  it("keeps machine and human status as separate enums", () => {
    const content = buildTalkContent(projection);
    assert.deepEqual(content.status, {
      machine: "NOT-RUN",
      human: "HUMAN_PENDING",
    });
    assert.equal("overallStatus" in content, false);
    assert.equal(content.project.phase, "HUMAN_DECISION_PENDING");
    assert.equal(content.meta.adapter, "ts001-pilot/0.1.0");
    assert.equal(content.meta.projectionId, projection.hps.projectionId);
    assert.equal(content.meta.briefId, projection.briefs[0].briefId);
  });

  it("keeps NOT-RUN, remaining, and risk in the always-visible L1", () => {
    const content = buildTalkContent(projection);
    assert.ok(content.l1.notVerified.some((line) => line.includes("NOT-RUN")));
    assert.ok(content.l1.remaining.length > 0);
    assert.ok(content.l1.risks.length > 0);
    assert.match(content.l0.current, /NOT-RUN/);
  });

  it("contains L2 semantic trace, L3 machine result, and L4 provenance", () => {
    const content = buildTalkContent(projection);
    assert.ok(content.l2.nodes.some((node) => node.type === "PAIN"));
    assert.ok(content.l2.nodes.some((node) => node.type === "TASK"));
    assert.ok(content.l2.links.some((link) => link.relation === "motivates"));
    assert.equal(content.l3.machineResult.verdict, "NOT-RUN");
    assert.equal(content.l4.sources.length, 3);
    assert.equal(content.l4.traceLinks.length, projection.traces.length);
  });

  it("offers one design route decision, not a machine evidence approval", () => {
    const content = buildTalkContent(projection);
    assert.equal(content.decision.category, "DESIGN");
    assert.equal((content.decision.question.match(/[?？]/g) ?? []).length, 1);
    const decisionText = JSON.stringify(content.decision.options);
    assert.doesNotMatch(decisionText, /117\/117|相信.*(?:hash|哈希)|批准.*测试/iu);
  });

  it("serializes without an aggregate PASS field", () => {
    const serialized = serializeTalkContent(projection);
    assert.doesNotMatch(serialized, /"overallStatus"/);
    assert.match(serialized, /"machine":"NOT-RUN"/);
    assert.match(serialized, /"human":"HUMAN_PENDING"/);
  });
});

describe("talk content fail-closed invariants", () => {
  it("rejects an aggregate status", () => {
    const content = buildTalkContent(projection);
    assert.throws(
      () => validateTalkContent({ ...content, overallStatus: "PASS" }),
      TalkContentError,
    );
  });

  it("rejects hidden NOT-RUN and invented status words", () => {
    const content = buildTalkContent(projection);
    assert.throws(
      () => validateTalkContent({ ...content, l1: { ...content.l1, notVerified: [] } }),
      /NOT-RUN must remain visible/,
    );
    assert.throws(
      () => validateTalkContent({ ...content, status: { ...content.status, machine: "PASS" } }),
      /status.machine is invalid/,
    );
  });
});
