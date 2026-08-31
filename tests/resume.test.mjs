import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCandidateFromTalkEvent } from "../src/gate.mjs";
import { rebuildTs001Projection } from "../src/projector.mjs";
import {
  HPI_OUTBOX_ENTRY_TYPE,
  createOutboxEntry,
  outboxHasCandidate,
  outboxHasTalkReceipt,
  restoreOutbox,
  summarizeOutbox,
} from "../src/session.mjs";

const rootPath = decodeURIComponent(new URL("..", import.meta.url).pathname);
const projection = rebuildTs001Projection(rootPath);
const request = projection.escalationRequests[0];

function candidateResult(eventId = "talk-event-001") {
  return createCandidateFromTalkEvent(
    {
      id: eventId,
      ts: Date.parse("2026-08-30T00:00:00.000Z"),
      type: "hpi.decision.choose",
      surface: "main",
      payload: {
        requestId: request.requestId,
        requestDigest: request.requestDigest,
        sourceDigest: projection.sourceDigest,
        optionId: "accept-baseline-first",
      },
    },
    projection,
  ).candidate;
}

function customEntry(id, data) {
  return { type: "custom", id, parentId: null, customType: HPI_OUTBOX_ENTRY_TYPE, data };
}

describe("session-only candidate outbox", () => {
  it("persists a receipt and candidate but never HPS or canonical state", () => {
    const candidate = candidateResult();
    const data = createOutboxEntry(candidate);
    assert.equal(data.schema, "hpi/session-outbox/v2");
    assert.equal(data.adapterVersion, "hpi-session/0.2.0");
    assert.equal(data.authority, "SESSION_ONLY_NOT_PROJECT_CANONICAL");
    assert.equal(data.transportStatus, "PENDING_CANONICAL_WRITER");
    assert.match(data.candidateDigest, /^[a-f0-9]{64}$/u);
    assert.equal(data.candidate.status, "CANDIDATE");
    assert.equal("hps" in data, false);
    assert.equal("humanResult" in data, false);
    assert.equal("canonical" in data, false);
  });

  it("restores and deduplicates receipts on resume", () => {
    const candidate = candidateResult();
    const data = createOutboxEntry(candidate);
    const restored = restoreOutbox(
      [customEntry("entry-1", data), customEntry("entry-duplicate", data)],
      projection.sourceDigest,
    );
    assert.equal(restored.items.length, 1);
    assert.equal(restored.current.length, 1);
    assert.equal(restored.stale.length, 0);
    assert.equal(outboxHasTalkReceipt(restored, "talk-event-001"), true);
    assert.equal(outboxHasCandidate(restored, candidate.eventId), true);
    assert.deepEqual(summarizeOutbox(restored), {
      total: 1,
      current: 1,
      stale: 0,
      invalid: 0,
      canonicalCommitted: 0,
      boundary: "session candidate outbox only",
    });
  });

  it("marks the old decision candidate stale after source changes", () => {
    const data = createOutboxEntry(candidateResult());
    const restored = restoreOutbox([customEntry("entry-1", data)], "f".repeat(64));
    assert.equal(restored.current.length, 0);
    assert.equal(restored.stale.length, 1);
    assert.equal(restored.stale[0].freshness.status, "STALE");
    assert.equal(restored.stale[0].candidate.basis.sourceDigest, projection.sourceDigest);
  });

  it("isolates damaged entries instead of treating them as decisions", () => {
    const good = createOutboxEntry(candidateResult());
    const bad = {
      ...good,
      authority: "PROJECT_CANONICAL",
    };
    const restored = restoreOutbox(
      [customEntry("bad-entry", bad), customEntry("good-entry", good)],
      projection.sourceDigest,
    );
    assert.equal(restored.items.length, 1);
    assert.equal(restored.errors.length, 1);
    assert.match(restored.errors[0].error, /authority boundary is invalid/);
  });

  it("quarantines malformed receipt envelopes without breaking valid recovery", () => {
    const good = createOutboxEntry(candidateResult());
    const corruptions = [
      ["missing recordedAt", (data) => delete data.receipt.recordedAt, /recordedAt is required/],
      ["null recordedAt", (data) => { data.receipt.recordedAt = null; }, /non-empty string/],
      ["number recordedAt", (data) => { data.receipt.recordedAt = 123; }, /non-empty string/],
      ["non-canonical recordedAt", (data) => { data.receipt.recordedAt = "2026-08-30"; }, /canonical UTC ISO/],
      ["forged receipt id", (data) => { data.receiptId = "RECEIPT-FORGED"; }, /does not match receipt and candidate digest/],
      ["missing candidate digest", (data) => { delete data.candidateDigest; }, /candidateDigest is required/],
      ["forged candidate digest", (data) => { data.candidateDigest = "0".repeat(64); }, /does not match candidate content/],
      ["tampered candidate", (data) => { data.candidate.payload.action = "tampered"; }, /does not match candidate content/],
      ["wrong adapter", (data) => { data.adapterVersion = "hpi-session/other"; }, /adapterVersion is invalid/],
      ["extra envelope key", (data) => { data.accepted = true; }, /accepted is not allowed/],
    ];
    const entries = corruptions.map(([name, mutate], index) => {
      const data = structuredClone(good);
      mutate(data);
      return customEntry(`bad-${index}-${name}`, data);
    });
    entries.push(customEntry("good-entry", good));

    const restored = restoreOutbox(entries, projection.sourceDigest);
    assert.equal(restored.items.length, 1);
    assert.equal(restored.current.length, 1);
    assert.equal(restored.errors.length, corruptions.length);
    corruptions.forEach(([, , expected], index) => {
      assert.match(restored.errors[index].error, expected);
    });
  });

  it("ignores unrelated custom entries", () => {
    const restored = restoreOutbox(
      [{ type: "custom", id: "other", customType: "other-extension", data: { accepted: true } }],
      projection.sourceDigest,
    );
    assert.equal(restored.items.length, 0);
    assert.equal(restored.errors.length, 0);
  });
});
