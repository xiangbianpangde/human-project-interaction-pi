import { candidateFreshness } from "./gate.mjs";
import { sha256, validateCandidateEvent } from "./contracts.mjs";

export const HPI_OUTBOX_ENTRY_TYPE = "hpi-candidate-outbox";
export const HPI_OUTBOX_SCHEMA = "hpi/session-outbox/v1";
export const SESSION_ADAPTER_VERSION = "hpi-session/0.1.0";

export class SessionOutboxError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SessionOutboxError";
    this.details = details;
  }
}

export function createOutboxEntry(candidate, { talkEventId, recordedAt } = {}) {
  validateCandidateEvent(candidate);
  const eventId = talkEventId ?? candidate.payload?.talkEventId;
  if (typeof eventId !== "string" || eventId.trim() === "") {
    throw new SessionOutboxError("outbox entries require a talkEventId receipt");
  }
  const timestamp = recordedAt ?? candidate.createdAt;
  if (Number.isNaN(Date.parse(timestamp))) throw new SessionOutboxError("recordedAt must be an ISO timestamp");
  const receipt = {
    talkEventId: eventId,
    candidateEventId: candidate.eventId,
    recordedAt: new Date(timestamp).toISOString(),
  };
  return {
    schema: HPI_OUTBOX_SCHEMA,
    adapterVersion: SESSION_ADAPTER_VERSION,
    receiptId: `RECEIPT-${sha256(receipt).slice(0, 24).toUpperCase()}`,
    receipt,
    candidate,
    transportStatus: "PENDING_CANONICAL_WRITER",
    authority: "SESSION_ONLY_NOT_PROJECT_CANONICAL",
  };
}

function isCustomOutboxEntry(entry) {
  return entry?.type === "custom" && entry.customType === HPI_OUTBOX_ENTRY_TYPE;
}

function validateOutboxData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new SessionOutboxError("outbox data must be an object");
  }
  if (data.schema !== HPI_OUTBOX_SCHEMA) throw new SessionOutboxError("unsupported outbox schema");
  if (data.transportStatus !== "PENDING_CANONICAL_WRITER") {
    throw new SessionOutboxError("outbox transportStatus is invalid");
  }
  if (data.authority !== "SESSION_ONLY_NOT_PROJECT_CANONICAL") {
    throw new SessionOutboxError("outbox authority boundary is invalid");
  }
  if (!data.receipt || typeof data.receipt !== "object") {
    throw new SessionOutboxError("outbox receipt is required");
  }
  if (typeof data.receipt.talkEventId !== "string" || typeof data.receipt.candidateEventId !== "string") {
    throw new SessionOutboxError("outbox receipt ids are required");
  }
  if (data.receipt.candidateEventId !== data.candidate?.eventId) {
    throw new SessionOutboxError("receipt candidateEventId does not match candidate");
  }
  validateCandidateEvent(data.candidate);
  return data;
}

export function restoreOutbox(entries, currentSourceDigest) {
  if (!Array.isArray(entries)) throw new SessionOutboxError("session entries must be an array");
  if (!/^[a-f0-9]{64}$/.test(currentSourceDigest ?? "")) {
    throw new SessionOutboxError("currentSourceDigest must be a SHA-256 digest");
  }
  const byCandidate = new Map();
  const errors = [];
  for (const entry of entries) {
    if (!isCustomOutboxEntry(entry)) continue;
    try {
      const data = validateOutboxData(entry.data);
      if (!byCandidate.has(data.candidate.eventId)) {
        const freshness = candidateFreshness(data.candidate, currentSourceDigest);
        byCandidate.set(data.candidate.eventId, {
          entryId: entry.id,
          receipt: data.receipt,
          candidate: data.candidate,
          freshness,
          transportStatus: data.transportStatus,
          authority: data.authority,
        });
      }
    } catch (error) {
      errors.push({
        entryId: entry?.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const items = [...byCandidate.values()].sort((left, right) =>
    left.receipt.recordedAt.localeCompare(right.receipt.recordedAt) ||
    left.candidate.eventId.localeCompare(right.candidate.eventId),
  );
  return {
    schema: "hpi/restored-outbox/v1",
    currentSourceDigest,
    items,
    current: items.filter((item) => item.freshness.status === "CURRENT"),
    stale: items.filter((item) => item.freshness.status === "STALE"),
    errors,
  };
}

export function outboxHasTalkReceipt(restored, talkEventId) {
  return Boolean(restored?.items?.some((item) => item.receipt.talkEventId === talkEventId));
}

export function outboxHasCandidate(restored, candidateEventId) {
  return Boolean(restored?.items?.some((item) => item.candidate.eventId === candidateEventId));
}

export function summarizeOutbox(restored) {
  const items = Array.isArray(restored?.items) ? restored.items : [];
  return {
    total: items.length,
    current: items.filter((item) => item.freshness.status === "CURRENT").length,
    stale: items.filter((item) => item.freshness.status === "STALE").length,
    invalid: Array.isArray(restored?.errors) ? restored.errors.length : 0,
    canonicalCommitted: 0,
    boundary: "session candidate outbox only",
  };
}
