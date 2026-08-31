import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AdapterContractError,
  canonicalSourceSnapshot,
  computeSourceDigest,
  validateNormalizedSourceEnvelope,
} from "../src/adapters/contract.mjs";

const first = Object.freeze({
  id: "SOURCE-A",
  revision: "1",
  sha256: "a".repeat(64),
  pointer: "a.md",
});
const second = Object.freeze({
  id: "SOURCE-B",
  revision: "2",
  sha256: "b".repeat(64),
  pointer: "b.md",
});

function envelope(overrides = {}) {
  const sourceSnapshot = overrides.sourceSnapshot ?? [first, second];
  const adapter = overrides.adapter ?? "example-readonly/0.1.0";
  return {
    schema: "hpi/normalized-source/v1",
    adapter,
    projectId: "EXAMPLE",
    projectTitle: "Example project",
    sourceSnapshot,
    sourceDigest: computeSourceDigest(adapter, sourceSnapshot),
    authority: { machineStatus: "INCOMPLETE", humanStatus: "NOT_NEEDED" },
    brief: {
      headline: "Example project is incomplete.",
      next: { statement: "Read the current pointer.", reason: "It is authoritative." },
    },
    pains: [],
    designPoints: [],
    activeWork: [],
    machineResults: [],
    escalationRequests: [],
    unresolved: [],
    risks: [],
    outOfScope: [],
    ...overrides,
  };
}

describe("normalized adapter source contract", () => {
  it("computes one digest independent of source ordering", () => {
    assert.deepEqual(canonicalSourceSnapshot([second, first]), [first, second]);
    assert.equal(
      computeSourceDigest("example-readonly/0.1.0", [first, second]),
      computeSourceDigest("example-readonly/0.1.0", [second, first]),
    );
  });

  it("rejects duplicate logical source revisions", () => {
    assert.throws(
      () => canonicalSourceSnapshot([first, { ...first, sha256: "c".repeat(64) }]),
      AdapterContractError,
    );
  });

  it("rejects a syntactically valid but forged digest", () => {
    assert.throws(
      () => validateNormalizedSourceEnvelope(envelope({ sourceDigest: "0".repeat(64) })),
      /sourceDigest does not match the adapter and source snapshot/,
    );
  });

  it("requires adapter-neutral project presentation fields", () => {
    assert.equal(validateNormalizedSourceEnvelope(envelope()).projectTitle, "Example project");
    assert.throws(
      () => validateNormalizedSourceEnvelope(envelope({ projectTitle: "" })),
      /projectTitle/,
    );
  });
});
