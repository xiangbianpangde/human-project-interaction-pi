import {
  HUMAN_STATUSES,
  MACHINE_VERDICTS,
  sha256,
  validateSourceRef,
} from "../contracts.mjs";

export const NORMALIZED_SOURCE_SCHEMA = "hpi/normalized-source/v1";

export class AdapterContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AdapterContractError";
    this.details = details;
  }
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdapterContractError(`${name} must be an object`);
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdapterContractError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new AdapterContractError(`${name} must be an array`);
  return value;
}

function sourceSortKey(ref) {
  return [ref.id, ref.revision, ref.sha256 ?? "", ref.pointer ?? ""].join("\u0000");
}

export function canonicalSourceSnapshot(sourceSnapshot) {
  const refs = requireArray(sourceSnapshot, "sourceSnapshot");
  if (refs.length === 0) throw new AdapterContractError("sourceSnapshot must not be empty");
  const logicalRevisions = new Set();
  for (const [index, ref] of refs.entries()) {
    try {
      validateSourceRef(ref, `sourceSnapshot[${index}]`);
    } catch (error) {
      throw new AdapterContractError(error.message, { cause: error });
    }
    const logicalRevision = `${ref.id}@${ref.revision}`;
    if (logicalRevisions.has(logicalRevision)) {
      throw new AdapterContractError(`sourceSnapshot contains duplicate logical revision ${logicalRevision}`);
    }
    logicalRevisions.add(logicalRevision);
  }
  return [...refs].sort((left, right) => sourceSortKey(left).localeCompare(sourceSortKey(right)));
}

export function computeSourceDigest(adapter, sourceSnapshot) {
  return sha256({
    adapter: requireString(adapter, "adapter"),
    sourceSnapshot: canonicalSourceSnapshot(sourceSnapshot),
  });
}

export function createSourceRef({ id, revision, text, pointer }) {
  if (typeof text !== "string") throw new AdapterContractError("source text must be a string");
  const ref = {
    id: String(id),
    revision: String(revision),
    sha256: sha256(text.replace(/\r\n/g, "\n")),
    pointer: String(pointer),
  };
  try {
    validateSourceRef(ref);
  } catch (error) {
    throw new AdapterContractError(error.message, { cause: error });
  }
  return ref;
}

export function validateNormalizedSourceEnvelope(source) {
  const object = requireObject(source, "normalized source");
  if (object.schema !== NORMALIZED_SOURCE_SCHEMA) {
    throw new AdapterContractError(`normalized source schema must equal ${NORMALIZED_SOURCE_SCHEMA}`);
  }
  const adapter = requireString(object.adapter, "adapter");
  requireString(object.projectId, "projectId");
  requireString(object.projectTitle, "projectTitle");
  const snapshot = canonicalSourceSnapshot(object.sourceSnapshot);
  const expectedDigest = computeSourceDigest(adapter, snapshot);
  if (object.sourceDigest !== expectedDigest) {
    throw new AdapterContractError("sourceDigest does not match the adapter and source snapshot", {
      expected: expectedDigest,
      actual: object.sourceDigest,
    });
  }

  const authority = requireObject(object.authority, "authority");
  if (!MACHINE_VERDICTS.includes(authority.machineStatus)) {
    throw new AdapterContractError("authority.machineStatus is invalid");
  }
  if (!HUMAN_STATUSES.includes(authority.humanStatus)) {
    throw new AdapterContractError("authority.humanStatus is invalid");
  }

  const brief = requireObject(object.brief, "brief");
  requireString(brief.headline, "brief.headline");
  const next = requireObject(brief.next, "brief.next");
  requireString(next.statement, "brief.next.statement");
  requireString(next.reason, "brief.next.reason");

  for (const field of [
    "pains",
    "designPoints",
    "activeWork",
    "machineResults",
    "escalationRequests",
    "unresolved",
    "risks",
    "outOfScope",
  ]) {
    requireArray(object[field], field);
  }
  return source;
}
