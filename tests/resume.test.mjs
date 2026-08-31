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
    assert.equal(data.authority, "SESSION_ONLY_NOT_PROJECT_CANONICAL");
    assert.equal(data.transportStatus, "PENDING_CANONICAL_WRITER");
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

  it("ignores unrelated custom entries", () => {
    const restored = restoreOutbox(
      [{ type: "custom", id: "other", customType: "other-extension", data: { accepted: true } }],
      projection.sourceDigest,
    );
    assert.equal(restored.items.length, 0);
    assert.equal(restored.errors.length, 0);
  });
});
