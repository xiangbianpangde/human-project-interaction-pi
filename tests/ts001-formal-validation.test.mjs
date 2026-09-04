import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  TS001_CONTRACT_ID,
  TS001_CONTRACT_REVISION,
  TS001_DIRECT_INVARIANTS,
  TS001_TASK_IMPL,
  TS001_TASK_VAL,
  validatePathPermission,
  validateTs001RollbackSupersedes,
} from "../src/ts001-validation/contract.mjs";
import { Ts001ValidationAgent } from "../src/ts001-validation/agent.mjs";
import {
  createAjvValidator,
  runTs001AcceptanceSuite,
} from "../src/ts001-validation/runner.mjs";

describe("TS-001 formal validation milestone", () => {
  it("verifies manifest and baseline frozen SHA hashes", () => {
    const manifest = JSON.parse(readFileSync("tests/fixtures/ts001/manifest.json", "utf8"));
    assert.strictEqual(manifest.contract_id, TS001_CONTRACT_ID);
    assert.strictEqual(manifest.revision, TS001_CONTRACT_REVISION);
    assert.strictEqual(manifest.cases_count, 31);
    assert.strictEqual(
      manifest.authority_contract_sha256,
      "e0aeffc678717ba7416b5ff775683ec00919ecc9bdf6054327f6020dedfb9804",
    );
    assert.strictEqual(
      manifest.prd_sha256,
      "b9cdff8541bc7809aad32025e3c530a48b9e774c70a0af3e6437310cfe4a6c26",
    );
    assert.strictEqual(
      manifest.technical_design_sha256,
      "4a1e5c8720bce7cd5615f6e6de95854a7dcdddefb91915b6dd18f6667c1bfcf8",
    );
  });

  it("executes all 31 acceptance cases with exact 10 PASSED and 21 REJECTED polarity", async () => {
    const agent = new Ts001ValidationAgent();
    const { manifest, executedCases, validationResult } = await runTs001AcceptanceSuite({ agent });

    assert.strictEqual(executedCases.length, 31);
    assert.strictEqual(manifest.cases_manifest.length, 31);

    // Group counts
    const sCases = executedCases.filter((c) => c.case_id.startsWith("TS1-S-"));
    const pCases = executedCases.filter((c) => c.case_id.startsWith("TS1-P-"));
    const iCases = executedCases.filter((c) => c.case_id.startsWith("TS1-I-"));
    const rCases = executedCases.filter((c) => c.case_id.startsWith("TS1-R-"));

    assert.strictEqual(sCases.length, 11, "Group 1 Schema has 11 cases");
    assert.strictEqual(pCases.length, 7, "Group 2 Permission/Ref has 7 cases");
    assert.strictEqual(iCases.length, 8, "Group 3 Idempotency has 8 cases");
    assert.strictEqual(rCases.length, 5, "Group 4 Rollback has 5 cases");

    // Exact polarity match
    const passedCases = executedCases.filter((c) => c.status === "PASSED");
    const rejectedCases = executedCases.filter((c) => c.status === "REJECTED");
    assert.strictEqual(passedCases.length, 10, "Exactly 10 positive cases pass");
    assert.strictEqual(rejectedCases.length, 21, "Exactly 21 negative cases reject");

    // All direct invariants have explicit coverage
    const coveredInvariants = new Set(executedCases.flatMap((c) => c.invariants_covered));
    for (const inv of TS001_DIRECT_INVARIANTS) {
      assert.ok(coveredInvariants.has(inv), `Direct invariant ${inv} must be covered`);
    }

    // Strict wire schema validation of ValidationResult
    const ajv = createAjvValidator();
    const validate = ajv.getSchema("urn:hpi:wire:validation-result:v1");
    assert.ok(validate, "ValidationResult schema must be available");
    const valid = validate(validationResult);
    if (!valid) {
      assert.fail(`ValidationResult wire schema validation failed: ${JSON.stringify(validate.errors)}`);
    }

    assert.strictEqual(validationResult.verdict, "CONFORMANT");
    assert.strictEqual(validationResult.validator.role, "VALIDATION");
    assert.strictEqual(validationResult.validator.agent_id, agent.agentId);

    // Verify each case retains start/end timestamps
    for (const c of validationResult.executed_cases) {
      assert.ok(c.started_at, `case ${c.case_id} must have started_at`);
      assert.ok(c.completed_at, `case ${c.case_id} must have completed_at`);
    }
  });

  it("fails closed to NON-CONFORMANT if any case fails, IDs are forged, or polarity diverges", () => {
    const agent = new Ts001ValidationAgent();
    const manifest = JSON.parse(readFileSync("tests/fixtures/ts001/manifest.json", "utf8"));
    const candidateRef = { id: "COMMIT-test", revision: "rev-1", sha256: "tree-1" };

    // Adversarial witness 1: 31 arbitrary REJECTED records cannot yield CONFORMANT
    const allRejected = Array.from({ length: 31 }, (_, i) => ({
      case_id: `FORGED-${i}`,
      status: "REJECTED",
      invariants_covered: TS001_DIRECT_INVARIANTS,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }));
    const forgedResult = agent.compileValidationResult({
      candidateRef,
      canonicalManifest: manifest,
      executedCases: allRejected,
    });
    assert.strictEqual(forgedResult.verdict, "NON-CONFORMANT", "31 arbitrary REJECTED must not yield CONFORMANT");

    // Adversarial witness 2: Polarity mismatch (positive case rejected)
    const validMap = manifest.cases_manifest.map((c) => ({
      case_id: c.id,
      status: c.expected === "PASS" ? "PASSED" : "REJECTED",
      invariants_covered: TS001_DIRECT_INVARIANTS,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }));
    // Flip one positive case to REJECTED
    validMap[0].status = "REJECTED";
    const invertedResult = agent.compileValidationResult({
      candidateRef,
      canonicalManifest: manifest,
      executedCases: validMap,
    });
    assert.strictEqual(invertedResult.verdict, "NON-CONFORMANT", "Polarity mismatch must fail closed");

    // Adversarial witness 3: P1-TS001-7 — putting all 7 invariants onto S-001 fails closed
    const scrambledInvariants = manifest.cases_manifest.map((c) => ({
      case_id: c.id,
      status: c.expected === "PASS" ? "PASSED" : "REJECTED",
      evidence_pointer: c.evidence_pointer,
      invariants_covered: c.id === "TS1-S-001" ? [...TS001_DIRECT_INVARIANTS] : [],
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }));
    const scrambledResult = agent.compileValidationResult({
      candidateRef,
      canonicalManifest: manifest,
      executedCases: scrambledInvariants,
    });
    assert.strictEqual(scrambledResult.verdict, "NON-CONFORMANT", "Unassigned invariant labels must fail closed");

    // Adversarial witness 5: P1-TS001-5 — nonexistent evidence pointer fails closed
    const nonexistentPointer = manifest.cases_manifest.map((c) => ({
      case_id: c.id,
      status: c.expected === "PASS" ? "PASSED" : "REJECTED",
      evidence_pointer: "does/not/exist.json",
      invariants_covered: c.id === "TS1-S-010" ? ["INV-002"] : [],
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }));
    const nonexistentResult = agent.compileValidationResult({
      candidateRef,
      canonicalManifest: manifest,
      executedCases: nonexistentPointer,
    });
    assert.strictEqual(nonexistentResult.verdict, "NON-CONFORMANT", "Nonexistent evidence pointer must fail closed");

    // Adversarial witness 6: P1-TS001-8 — missing or tampered manifest_digest fails closed
    const tamperedManifest = { ...manifest };
    delete tamperedManifest.manifest_digest;
    assert.throws(
      () => agent.compileValidationResult({
        candidateRef,
        canonicalManifest: tamperedManifest,
        executedCases: validMap,
      }),
      /MANIFEST_DIGEST_REQUIRED/u,
      "Missing manifest_digest must fail closed",
    );

    const forgedDigestManifest = { ...manifest, manifest_digest: "a".repeat(64) };
    assert.throws(
      () => agent.compileValidationResult({
        candidateRef,
        canonicalManifest: forgedDigestManifest,
        executedCases: validMap,
      }),
      /MANIFEST_DIGEST_MISMATCH/u,
      "Forged manifest_digest must fail closed",
    );
  });

  it("converts unexpected implementation exceptions to FAILED (P1-TS001-1)", async () => {
    const agent = new Ts001ValidationAgent();
    const result = await agent.runCase({
      caseId: "TS1-CRASH-TEST",
      name: "crash test",
      command: "throw new TypeError('bug')",
      evidencePointer: "tests/fixtures/ts001/cases/schema/TS1-S-005.json",
      execute: async () => {
        throw new TypeError("unexpected null pointer / implementation bug");
      },
    });

    assert.strictEqual(result.status, "FAILED", "Unexpected TypeError must be FAILED, never REJECTED");
    assert.strictEqual(result.exit_code, 1);
    assert.strictEqual(result.error_details.code, "UNEXPECTED_ERROR");
  });

  it("enforces fail-closed G-011 and G-014 gates and forbids in-place overwrite (P1-TS001-2)", () => {
    const oldRef = { id: "OBJ-001", revision: "1" };
    const supersedesRef = { id: "OBJ-001", revision: "1" };

    // Missing g014Approved
    assert.throws(
      () => validateTs001RollbackSupersedes({ oldRef, newRevision: "2", supersedesRef, g011Approved: true }),
      /TS001_G014_GATE_REQUIRED/u,
    );
    // Explicit false g014Approved
    assert.throws(
      () => validateTs001RollbackSupersedes({ oldRef, newRevision: "2", supersedesRef, g014Approved: false, g011Approved: true }),
      /TS001_G014_GATE_REQUIRED/u,
    );

    // Missing g011Approved
    assert.throws(
      () => validateTs001RollbackSupersedes({ oldRef, newRevision: "2", supersedesRef, g014Approved: true }),
      /TS001_G011_GATE_REQUIRED/u,
    );
    // Explicit false g011Approved
    assert.throws(
      () => validateTs001RollbackSupersedes({ oldRef, newRevision: "2", supersedesRef, g014Approved: true, g011Approved: false }),
      /TS001_G011_GATE_REQUIRED/u,
    );

    // In-place revision overwrite attempt
    assert.throws(
      () => validateTs001RollbackSupersedes({ oldRef, newRevision: "1", supersedesRef, g014Approved: true, g011Approved: true }),
      /TS001_IN_PLACE_OVERWRITE_FORBIDDEN/u,
    );

    // Valid rollback
    const ok = validateTs001RollbackSupersedes({
      oldRef,
      newRevision: "2",
      supersedesRef,
      g014Approved: true,
      g011Approved: true,
    });
    assert.strictEqual(ok, true);
  });

  it("enforces boundary-safe path allowlist matching (P1-TS001-3 / INV-007)", () => {
    const scope = {
      allowed_paths: ["src/**", "tests/**"],
      forbidden_paths: ["canonical/**"],
    };

    // Legitimate path under src/
    assert.doesNotThrow(() => validatePathPermission("src/index.mjs", scope));

    // Boundary bypass attempt: src-escape/outside.txt must NOT match src/**
    assert.throws(
      () => validatePathPermission("src-escape/outside.txt", scope),
      /TS001_PERMISSION_OUTSIDE_ALLOWLIST/u,
    );

    // Forbidden path
    assert.throws(
      () => validatePathPermission("canonical/state.yaml", scope),
      /TS001_PERMISSION_OUTSIDE_ALLOWLIST/u,
    );
  });
});
