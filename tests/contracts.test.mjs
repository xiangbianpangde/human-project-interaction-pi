import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ContractError,
  SCHEMAS,
  canonicalJson,
  contentId,
  deriveMachineVerdict,
  sha256,
  validateCandidateEvent,
  validateEscalationRequest,
  validateHps,
  validateMachineResult,
  validateSourceRef,
} from "../src/contracts.mjs";

const sourceRef = Object.freeze({
  id: "TS1-TEST-001",
  revision: "1",
  sha256: "a".repeat(64),
  pointer: "09_TS001_测试与回滚验收.md",
});

function escalation(overrides = {}) {
  return {
    schema: SCHEMAS.escalationRequest,
    requestId: "ER-TS001-DESIGN-001",
    projectId: "HPI-TS001-PILOT",
    category: "DESIGN",
    decisionUnit: "baseline-before-runtime",
    question: "是否接受先固定合同与测试基线，再进入 runtime？",
    facts: [
      {
        statement: "TS-001 的权威合同状态是 NOT-RUN。",
        sourceRef,
        evidenceStatus: "NOT_RUN",
      },
    ],
    options: [
      {
        optionId: "accept-route",
        label: "接受该路线",
        consequence: "保持 TS-001 为合同基线并进入后续 runtime 设计。",
        risk: "尚未产生工程通过结论。",
        reversible: true,
      },
      {
        optionId: "request-revision",
        label: "要求调整路线",
        consequence: "保持 HUMAN_PENDING 并继续讨论设计。",
        risk: "后续实现暂不启动。",
        reversible: true,
      },
    ],
    recommendation: "接受合同基线优先，但不把它解释为工程测试通过。",
    safeDefault: "NO_STATE_CHANGE",
    affectedRefs: [sourceRef],
    requestDigest: "b".repeat(64),
    oneQuestion: true,
    ...overrides,
  };
}

describe("canonical content addressing", () => {
  it("is stable across object-key order", () => {
    assert.equal(canonicalJson({ z: 2, a: { y: 3, x: 1 } }), '{"a":{"x":1,"y":3},"z":2}');
    assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
    assert.match(contentId("trace", { from: "P-1", to: "TS-1" }), /^trace-[a-f0-9]{64}$/);
  });

  it("rejects non-finite values", () => {
    assert.throws(() => canonicalJson({ value: Number.POSITIVE_INFINITY }), TypeError);
  });
});

describe("source and machine contracts", () => {
  it("requires a valid lower-case SHA-256 when a digest is present", () => {
    assert.equal(validateSourceRef(sourceRef), sourceRef);
    assert.throws(
      () => validateSourceRef({ id: "TS1", revision: "1", sha256: "BAD" }),
      ContractError,
    );
  });

  it("rejects informal verdict words and verified facts without evidence", () => {
    const result = {
      schema: SCHEMAS.machineResult,
      resultId: "MR-TS001",
      taskId: "TS001-IMPL",
      attemptId: "attempt-000",
      sourceRef,
      verdict: "NOT-RUN",
      facts: [],
      limitations: ["测试未运行"],
      unresolved: ["四组用例待执行"],
    };
    assert.equal(validateMachineResult(result), result);
    assert.throws(() => validateMachineResult({ ...result, verdict: "PASS" }), ContractError);
    assert.throws(
      () =>
        validateMachineResult({
          ...result,
          facts: [
            {
              id: "F-1",
              kind: "TEST",
              statement: "117/117",
              status: "VERIFIED",
              evidenceRefs: [],
            },
          ],
        }),
      /VERIFIED facts require/,
    );
  });

  it("never lets claims or isolated evidence override a non-pass authoritative verdict", () => {
    for (const authoritativeVerdict of [
      "NOT-RUN",
      "RUNNING",
      "INCOMPLETE",
      "DEVIATIONS_FOUND",
      "OUT_OF_SCOPE",
      "BLOCKED",
    ]) {
      assert.equal(
        deriveMachineVerdict({
          authoritativeVerdict,
          claimedVerdict: "PASS-ENGINEERING",
          facts: [{ status: "VERIFIED", evidenceRefs: [sourceRef] }],
        }),
        authoritativeVerdict,
      );
    }
  });

  it("requires authoritative PASS, a matching claim, and verified evidence for PASS-ENGINEERING", () => {
    assert.equal(
      deriveMachineVerdict({
        authoritativeVerdict: "PASS-ENGINEERING",
        claimedVerdict: "PASS-ENGINEERING",
        facts: [{ status: "VERIFIED", evidenceRefs: [sourceRef] }],
      }),
      "PASS-ENGINEERING",
    );
    assert.equal(
      deriveMachineVerdict({
        authoritativeVerdict: "PASS-ENGINEERING",
        claimedVerdict: "PASS-ENGINEERING",
        facts: [{ status: "SELF_REPORTED", evidenceRefs: [] }],
      }),
      "INCOMPLETE",
    );
    assert.equal(
      deriveMachineVerdict({
        authoritativeVerdict: "PASS-ENGINEERING",
        claimedVerdict: "INCOMPLETE",
        facts: [{ status: "VERIFIED", evidenceRefs: [sourceRef] }],
      }),
      "INCOMPLETE",
    );
  });
});

describe("human escalation contract", () => {
  it("accepts one narrow design decision", () => {
    const request = escalation();
    assert.equal(validateEscalationRequest(request), request);
  });

  it("does not expose MACHINE_FACT or EVIDENCE_GAP as human categories", () => {
    assert.throws(() => validateEscalationRequest(escalation({ category: "MACHINE_FACT" })), ContractError);
    assert.throws(() => validateEscalationRequest(escalation({ category: "EVIDENCE_GAP" })), ContractError);
  });

  it("rejects compound questions and oneQuestion=false", () => {
    assert.throws(
      () => validateEscalationRequest(escalation({ question: "测试通过吗？哈希一致吗？" })),
      /exactly one question mark/,
    );
    assert.throws(() => validateEscalationRequest(escalation({ oneQuestion: false })), /must be true/);
  });
});

describe("projection and candidate contracts", () => {
  it("requires content-addressed projection/source ids and separated statuses", () => {
    const hps = {
      schema: SCHEMAS.hps,
      projectId: "HPI-TS001-PILOT",
      projectionId: "c".repeat(64),
      projectorVersion: "0.1.0",
      sourceSnapshot: [sourceRef],
      sourceDigest: "d".repeat(64),
      phase: "HUMAN_DECISION_PENDING",
      intent: { statement: "先固定合同与测试基线。", sourceRef },
      pains: [],
      activeWork: [
        {
          taskId: "TS001-IMPL",
          whyNow: "runtime 前先冻结合同。",
          machineStatus: "NOT-RUN",
          humanStatus: "HUMAN_PENDING",
          latestChange: "测试合同已批准但未运行。",
        },
      ],
      changesSinceLastSeen: [],
      unresolved: [],
      risks: [],
      decisionRequestIds: ["ER-TS001-DESIGN-001"],
      evidenceSummary: { verified: 0, selfReported: 0, notRun: 1, incomplete: 0 },
      traceLinkIds: [],
    };
    assert.equal(validateHps(hps), hps);
    assert.throws(() => validateHps({ ...hps, sourceSnapshot: [] }), ContractError);
    assert.throws(
      () => validateHps({ ...hps, activeWork: [{ ...hps.activeWork[0], machineStatus: "PASS" }] }),
      ContractError,
    );
  });

  it("requires human decision candidates to bind current request digests", () => {
    const event = {
      schema: SCHEMAS.candidateEvent,
      eventId: "CE-1",
      eventType: "HumanDecisionProposed",
      projectId: "HPI-TS001-PILOT",
      basis: {
        sourceDigest: "d".repeat(64),
        requestId: "ER-TS001-DESIGN-001",
        requestDigest: "b".repeat(64),
      },
      payload: { action: "choose", optionId: "accept-route" },
      status: "CANDIDATE",
      createdAt: "2026-08-30T00:00:00.000Z",
    };
    assert.equal(validateCandidateEvent(event), event);
    assert.throws(
      () => validateCandidateEvent({ ...event, basis: { sourceDigest: "d".repeat(64) } }),
      /require requestId and requestDigest/,
    );
  });
});
