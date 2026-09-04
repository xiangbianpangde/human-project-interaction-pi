import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sha256 } from "../contracts.mjs";
import {
  TS001_CANONICAL_INVARIANT_CASES,
  TS001_CONTRACT_ID,
  TS001_CONTRACT_REVISION,
  TS001_DIRECT_INVARIANTS,
  TS001_TASK_VAL,
  Ts001ValidationError,
} from "./contract.mjs";

export const TS001_VALIDATOR_AGENT_ID = "agent-ts001-validator";
export const TS001_VALIDATOR_ROLE = "VALIDATION";

export class Ts001ValidationAgent {
  constructor({ agentId = TS001_VALIDATOR_AGENT_ID } = {}) {
    this.agentId = agentId;
    this.role = TS001_VALIDATOR_ROLE;
  }

  async runCase({
    caseId,
    name,
    command,
    environment = `Node ${process.version}; ${process.platform}`,
    inputPath,
    inputContent,
    execute,
    invariantsCovered = [],
    evidencePointer,
  }) {
    const startedAt = new Date().toISOString();
    let inputSha256;
    if (inputContent !== undefined) {
      inputSha256 = sha256(inputContent);
    } else if (inputPath) {
      inputSha256 = sha256(readFileSync(inputPath, "utf8"));
    } else {
      inputSha256 = "0".repeat(64);
    }

    let status = "FAILED";
    let exitCode = 1;
    let outputSha256 = "0".repeat(64);
    let errorDetails = null;

    try {
      const result = await execute();
      exitCode = result?.exitCode ?? 0;
      outputSha256 = sha256(result?.output ?? "");
      status = result?.status ?? (exitCode === 0 ? "PASSED" : "REJECTED");
    } catch (err) {
      if (err instanceof Ts001ValidationError) {
        exitCode = 2;
        outputSha256 = sha256(err.message || String(err));
        status = "REJECTED";
        errorDetails = { code: err.code, message: err.message };
      } else {
        exitCode = 1;
        outputSha256 = sha256(err.stack || String(err));
        status = "FAILED";
        errorDetails = { code: "UNEXPECTED_ERROR", message: err.message };
      }
    }

    if (!evidencePointer || typeof evidencePointer !== "string" || !evidencePointer.trim()) {
      throw new Ts001ValidationError("EVIDENCE_POINTER_REQUIRED", `case ${caseId} requires a non-empty evidencePointer (§9.2)`);
    }

    const completedAt = new Date().toISOString();
    return {
      case_id: caseId,
      status,
      command,
      environment,
      input_ref: {
        id: `INPUT-${caseId}`,
        revision: "1",
        sha256: inputSha256,
        ...(inputPath ? { pointer: inputPath } : {}),
      },
      output_sha256: outputSha256,
      exit_code: exitCode,
      invariants_covered: invariantsCovered,
      evidence_pointer: evidencePointer,
      error_details: errorDetails,
      started_at: startedAt,
      completed_at: completedAt,
    };
  }

  compileValidationResult({
    validationId = `VAL-TS001-${randomUUID()}`,
    taskRef = {
      id: TS001_TASK_VAL,
      revision: "1",
      sha256: "0".repeat(64),
      pointer: "tests/fixtures/ts001/task-slices/ts001-val.v2.json",
    },
    candidateRef,
    contractRef = {
      id: TS001_CONTRACT_ID,
      revision: TS001_CONTRACT_REVISION,
      sha256: "e0aeffc678717ba7416b5ff775683ec00919ecc9bdf6054327f6020dedfb9804",
      pointer: "09_TS001_测试与回滚验收.md",
    },
    canonicalManifest,
    executedCases = [],
  }) {
    if (!canonicalManifest || !Array.isArray(canonicalManifest.cases_manifest)) {
      throw new Ts001ValidationError("MANIFEST_REQUIRED", "canonicalManifest with cases_manifest is required");
    }
    const expectedManifest = canonicalManifest.cases_manifest;
    if (expectedManifest.length !== 31) {
      throw new Ts001ValidationError("MANIFEST_INVALID", `canonical manifest must contain exactly 31 cases, got: ${expectedManifest.length}`);
    }

    // P2: Verify canonical manifest trust anchor / digest
    if (canonicalManifest.contract_id !== TS001_CONTRACT_ID || canonicalManifest.revision !== TS001_CONTRACT_REVISION) {
      throw new Ts001ValidationError("MANIFEST_CONTRACT_MISMATCH", `manifest contract/revision mismatch: ${canonicalManifest.contract_id}@${canonicalManifest.revision}`);
    }
    if (canonicalManifest.manifest_digest) {
      const computedManifestDigest = sha256({
        contract_id: canonicalManifest.contract_id,
        revision: canonicalManifest.revision,
        authority_contract_sha256: canonicalManifest.authority_contract_sha256,
        prd_sha256: canonicalManifest.prd_sha256,
        technical_design_sha256: canonicalManifest.technical_design_sha256,
        cases_count: canonicalManifest.cases_count,
        cases_manifest: canonicalManifest.cases_manifest,
      });
      if (canonicalManifest.manifest_digest !== computedManifestDigest) {
        throw new Ts001ValidationError("MANIFEST_DIGEST_MISMATCH", "canonicalManifest digest verification failed");
      }
    }

    if (!candidateRef || !candidateRef.id || !candidateRef.revision || !candidateRef.sha256) {
      throw new Ts001ValidationError("CANDIDATE_REF_REQUIRED", "candidate_ref with id, revision, and sha256 is required");
    }

    const manifestMap = new Map(expectedManifest.map((c) => [c.id, c.expected]));
    const executedMap = new Map();
    const duplicateIds = [];
    const unknownIds = [];

    for (const c of executedCases) {
      if (executedMap.has(c.case_id)) {
        duplicateIds.push(c.case_id);
      }
      if (!manifestMap.has(c.case_id)) {
        unknownIds.push(c.case_id);
      }
      executedMap.set(c.case_id, c);
    }

    const missingIds = [];
    const polarityMismatches = [];

    for (const [id, expected] of manifestMap.entries()) {
      const executed = executedMap.get(id);
      if (!executed) {
        missingIds.push(id);
        continue;
      }
      if (expected === "PASS" && executed.status !== "PASSED") {
        polarityMismatches.push({ id, expected, actual: executed.status });
      } else if (expected === "REJECT" && executed.status !== "REJECTED") {
        polarityMismatches.push({ id, expected, actual: executed.status });
      }
    }

    // P1-TS001-7: Invariant labels must strictly match canonical assigned cases
    const canonicalCasesForInv = new Map();
    for (const [inv, caseIds] of Object.entries(TS001_CANONICAL_INVARIANT_CASES)) {
      for (const c of caseIds) {
        if (!canonicalCasesForInv.has(c)) canonicalCasesForInv.set(c, new Set());
        canonicalCasesForInv.get(c).add(inv);
      }
    }

    for (const [inv, expectedCases] of Object.entries(TS001_CANONICAL_INVARIANT_CASES)) {
      for (const caseId of expectedCases) {
        const executed = executedMap.get(caseId);
        if (!executed || !executed.invariants_covered || !executed.invariants_covered.includes(inv)) {
          polarityMismatches.push({ caseId, missingInvariant: inv });
        }
      }
    }

    for (const c of executedCases) {
      for (const inv of c.invariants_covered || []) {
        if (!canonicalCasesForInv.get(c.case_id)?.has(inv)) {
          polarityMismatches.push({ caseId: c.case_id, unassignedInvariant: inv });
        }
      }
    }

    // P1-TS001-5: 100% of executed cases must carry non-empty evidence_pointer
    const missingEvidencePointers = executedCases.filter((c) => !c.evidence_pointer || !c.evidence_pointer.trim());
    if (missingEvidencePointers.length > 0) {
      polarityMismatches.push({ missingEvidencePointers: missingEvidencePointers.map((c) => c.case_id) });
    }

    const anyFailed = executedCases.some((c) => c.status === "FAILED");
    const allInvariantsCovered = new Set(executedCases.flatMap((c) => c.invariants_covered || []));
    const missingDirectInvariants = TS001_DIRECT_INVARIANTS.filter((inv) => !allInvariantsCovered.has(inv));

    const isConformant =
      executedCases.length === 31 &&
      duplicateIds.length === 0 &&
      unknownIds.length === 0 &&
      missingIds.length === 0 &&
      polarityMismatches.length === 0 &&
      !anyFailed &&
      missingDirectInvariants.length === 0;

    const verdict = isConformant ? "CONFORMANT" : "NON-CONFORMANT";

    const wireCases = executedCases.map((c) => ({
      case_id: c.case_id,
      status: c.status,
      command: c.command,
      environment: c.environment,
      input_ref: c.input_ref,
      output_sha256: c.output_sha256,
      exit_code: c.exit_code,
      invariants_covered: c.invariants_covered || [],
      evidence_pointer: c.evidence_pointer,
      started_at: c.started_at,
      completed_at: c.completed_at,
    }));

    return {
      schema: "hpi/wire/validation-result/v1",
      validation_id: validationId,
      task_ref: taskRef,
      candidate_ref: candidateRef,
      contract_ref: contractRef,
      verdict,
      executed_cases: wireCases,
      summary: `Executed ${executedCases.length}/31 TS-001 acceptance test cases. Verdict: ${verdict}.`,
      limitations: [
        "TS-001 仅验证四组用例与纯数据 fixture 合同；不包含完整 filesystem gate/Run 运行时。",
        "正式科学与临床主张不因此通过而产生；canonical 入库需额外权限门禁。",
      ],
      validator: {
        agent_id: this.agentId,
        role: this.role,
      },
      created_at: new Date().toISOString(),
    };
  }
}
