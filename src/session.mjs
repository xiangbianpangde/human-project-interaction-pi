import { candidateFreshness } from "./gate.mjs";
import { sha256, validateCandidateEvent } from "./contracts.mjs";

export const HPI_OUTBOX_ENTRY_TYPE = "hpi-candidate-outbox";
export const HPI_OUTBOX_SCHEMA = "hpi/session-outbox/v2";
export const SESSION_ADAPTER_VERSION = "hpi-session/0.2.0";

export class SessionOutboxError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SessionOutboxError";
    this.details = details;
  }
}

function exactObject(value, allowed, required, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionOutboxError(`${path} must be an object`);
  }
  for (const key of required) {
    if (!(key in value)) throw new SessionOutboxError(`${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new SessionOutboxError(`${path}.${key} is not allowed`);
  }
  return value;
}

function nonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SessionOutboxError(`${path} must be a non-empty string`);
  }
  return value;
}

function canonicalTimestamp(value, path) {
  nonEmptyString(value, path);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new SessionOutboxError(`${path} must be a canonical UTC ISO timestamp`);
  }
  return value;
}

function receiptIdFor(receipt, candidateDigest) {
  return `RECEIPT-${sha256({ receipt, candidateDigest }).slice(0, 24).toUpperCase()}`;
}

export function createOutboxEntry(candidate, { talkEventId, recordedAt } = {}) {
  validateCandidateEvent(candidate);
  const eventId = talkEventId ?? candidate.payload?.talkEventId;
  nonEmptyString(eventId, "talkEventId");
  const sourceTimestamp = recordedAt ?? candidate.createdAt;
  const parsed = new Date(sourceTimestamp);
  if (Number.isNaN(parsed.getTime())) throw new SessionOutboxError("recordedAt must be an ISO timestamp");
  const receipt = {
    talkEventId: eventId,
    candidateEventId: candidate.eventId,
    recordedAt: parsed.toISOString(),
  };
  const candidateDigest = sha256(candidate);
  return {
    schema: HPI_OUTBOX_SCHEMA,
    adapterVersion: SESSION_ADAPTER_VERSION,
    receiptId: receiptIdFor(receipt, candidateDigest),
    receipt,
    candidateDigest,
    candidate,
    transportStatus: "PENDING_CANONICAL_WRITER",
    authority: "SESSION_ONLY_NOT_PROJECT_CANONICAL",
  };
}

function isCustomOutboxEntry(entry) {
  return entry?.type === "custom" && entry.customType === HPI_OUTBOX_ENTRY_TYPE;
}

function validateOutboxData(data) {
  const object = exactObject(
    data,
    ["schema", "adapterVersion", "receiptId", "receipt", "candidateDigest", "candidate", "transportStatus", "authority"],
    ["schema", "adapterVersion", "receiptId", "receipt", "candidateDigest", "candidate", "transportStatus", "authority"],
    "outbox",
  );
  if (object.schema !== HPI_OUTBOX_SCHEMA) throw new SessionOutboxError("unsupported outbox schema");
  if (object.adapterVersion !== SESSION_ADAPTER_VERSION) {
    throw new SessionOutboxError("outbox adapterVersion is invalid");
  }
  if (object.transportStatus !== "PENDING_CANONICAL_WRITER") {
    throw new SessionOutboxError("outbox transportStatus is invalid");
  }
  if (object.authority !== "SESSION_ONLY_NOT_PROJECT_CANONICAL") {
    throw new SessionOutboxError("outbox authority boundary is invalid");
  }
  const receipt = exactObject(
    object.receipt,
    ["talkEventId", "candidateEventId", "recordedAt"],
    ["talkEventId", "candidateEventId", "recordedAt"],
    "outbox.receipt",
  );
  nonEmptyString(receipt.talkEventId, "outbox.receipt.talkEventId");
  nonEmptyString(receipt.candidateEventId, "outbox.receipt.candidateEventId");
  canonicalTimestamp(receipt.recordedAt, "outbox.receipt.recordedAt");
  if (receipt.candidateEventId !== object.candidate?.eventId) {
    throw new SessionOutboxError("receipt candidateEventId does not match candidate");
  }
  validateCandidateEvent(object.candidate);
  if (!/^[a-f0-9]{64}$/u.test(object.candidateDigest ?? "")) {
    throw new SessionOutboxError("outbox candidateDigest must be a lowercase SHA-256 digest");
  }
  if (object.candidateDigest !== sha256(object.candidate)) {
    throw new SessionOutboxError("outbox candidateDigest does not match candidate content");
  }
  if (object.receiptId !== receiptIdFor(receipt, object.candidateDigest)) {
    throw new SessionOutboxError("outbox receiptId does not match receipt and candidate digest");
  }
  return object;
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
