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

  it("executes all 31 acceptance cases and validates against strict JSON Schema", async () => {
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
  });

  it("fails closed to NON-CONFORMANT if any case fails or invariants are missed", () => {
    const agent = new Ts001ValidationAgent();

    // Incomplete case set
    const incomplete = agent.compileValidationResult({
      candidateRef: { id: TS001_TASK_IMPL, revision: "1", sha256: "0".repeat(64) },
      executedCases: [{ case_id: "TS1-S-001", status: "PASSED", invariants_covered: [] }],
    });
    assert.strictEqual(incomplete.verdict, "NON-CONFORMANT");

    // Case with FAILED status
    const withFailure = agent.compileValidationResult({
      candidateRef: { id: TS001_TASK_IMPL, revision: "1", sha256: "0".repeat(64) },
      executedCases: Array.from({ length: 31 }, (_, i) => ({
        case_id: `CASE-${i}`,
        status: i === 0 ? "FAILED" : "PASSED",
        invariants_covered: TS001_DIRECT_INVARIANTS,
      })),
    });
    assert.strictEqual(withFailure.verdict, "NON-CONFORMANT");
  });
});
