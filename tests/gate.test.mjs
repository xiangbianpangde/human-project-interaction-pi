import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GateError,
  candidateFreshness,
  createCandidateFromTalkEvent,
  createProposalCandidate,
  evaluateEscalation,
  inspectMachineFactQuestion,
} from "../src/gate.mjs";
import { rebuildTs001Projection } from "../src/projector.mjs";

const rootPath = decodeURIComponent(new URL("..", import.meta.url).pathname);
const projection = rebuildTs001Projection(rootPath);
const request = projection.escalationRequests[0];
const context = {
  machineStatus: projection.hps.activeWork[0].machineStatus,
  sourceDigest: projection.sourceDigest,
  trustedRequests: projection.escalationRequests,
};

function requestBinding(overrides = {}) {
  return {
    projectId: projection.projectId,
    category: request.category,
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    sourceDigest: projection.sourceDigest,
    ...overrides,
  };
}

function talkEvent(type, payload = {}, id = "evt-001") {
  return {
    id,
    ts: Date.parse("2026-08-30T00:00:00.000Z"),
    type,
    surface: "main",
    payload: {
      requestId: request.requestId,
      requestDigest: request.requestDigest,
      sourceDigest: projection.sourceDigest,
      ...payload,
    },
  };
}

describe("machine-fact inspection", () => {
  const machineQuestions = [
    "你是否相信 117/117 已通过？",
    "请确认 hash verified。",
    "是否接受 Schema 已全部通过？",
    "你相信 RB-0001 → CF-0001 → RB-0002 的证据链吗？",
    "请确认没有越界写入和网络获取。",
    "Can you approve that all tests passed?",
  ];

  for (const question of machineQuestions) {
    it(`detects: ${question}`, () => {
      const result = inspectMachineFactQuestion(question);
      assert.equal(result.isMachineFact, true);
      assert.ok(result.indicators.length > 0);
    });
  }

  it("does not misclassify the baseline-first design decision", () => {
    const result = inspectMachineFactQuestion("你是否接受先固定合同与测试基线，再进入 runtime 实现？");
    assert.equal(result.isMachineFact, false);
  });
});

describe("Human Escalation Gate", () => {
  it("rejects the original 117/hash trust request under NOT-RUN", () => {
    const result = evaluateEscalation(
      {
        projectId: projection.projectId,
        category: "DESIGN",
        decisionUnit: "确认工程结果",
        question: "你是否接受 31/31、32/32、117/117 以及 hash 一致？",
      },
      context,
    );
    assert.equal(result.kind, "NOT_RUN");
    assert.equal(result.machineStatus, "NOT-RUN");
    assert.equal(result.humanEscalation, null);
    assert.ok(result.indicators.includes("test-count"));
  });

  it("returns an evidence gap instead of asking a human to trust missing proof", () => {
    const result = evaluateEscalation(
      {
        projectId: projection.projectId,
        category: "EVIDENCE_GAP",
        decisionUnit: "missing-run-log",
        question: "日志在哪里？",
        missingEvidence: ["命令", "日志 SHA"],
      },
      { ...context, machineStatus: "INCOMPLETE" },
    );
    assert.equal(result.kind, "EVIDENCE_GAP");
    assert.equal(result.humanEscalation, null);
    assert.deepEqual(result.missingEvidence, ["命令", "日志 SHA"]);
  });

  it("accepts one narrow design decision and computes its digest", () => {
    const result = evaluateEscalation(
      requestBinding({
        decisionUnit: request.decisionUnit,
        question: request.question,
      }),
      context,
    );
    assert.equal(result.kind, "HUMAN_DECISION_REQUIRED");
    assert.equal(result.request.category, "DESIGN");
    assert.match(result.request.requestDigest, /^[a-f0-9]{64}$/);
    assert.equal(result.request.oneQuestion, true);
  });

  it("rejects tampered human questions instead of minting a new request", () => {
    const result = evaluateEscalation(
      requestBinding({
        decisionUnit: request.decisionUnit,
        question: "是否接受设计？是否批准范围？",
      }),
      context,
    );
    assert.equal(result.kind, "UNTRUSTED_ESCALATION_REJECTED");
    assert.equal(result.humanEscalation, null);
    assert.match(result.reason, /differs from the bound escalation request/);
  });

  it("rejects machine-fact paraphrases mislabeled as human categories", () => {
    for (const question of [
      "foo 文件在吗？",
      "这个引用能打开吗？",
      "schema 能解析？",
      "这些测试现在是绿的吗？",
      "哈希一样吗？",
      "有没有写到项目目录之外？",
      "有访问网络吗？",
      "Is foo.json present in the workspace?",
    ]) {
      const result = evaluateEscalation(
        {
          projectId: projection.projectId,
          category: "DESIGN",
          decisionUnit: "spoofed-machine-fact",
          question,
          sourceDigest: projection.sourceDigest,
        },
        context,
      );
      assert.ok(
        ["NOT_RUN", "MACHINE_FACT_REJECTED", "UNTRUSTED_ESCALATION_REJECTED"].includes(result.kind),
        `${question}: ${result.kind}`,
      );
      assert.equal(result.humanEscalation, null);
    }
  });

  it("rejects stale or missing projector request bindings", () => {
    for (const binding of [
      requestBinding({ requestDigest: "0".repeat(64) }),
      requestBinding({ sourceDigest: "0".repeat(64) }),
      requestBinding({ requestId: "ER-UNKNOWN" }),
    ]) {
      const result = evaluateEscalation(binding, context);
      assert.equal(result.kind, "UNTRUSTED_ESCALATION_REJECTED");
      assert.equal(result.humanEscalation, null);
    }
  });
});

describe("talk event → session candidate", () => {
  it("creates a candidate, never a HumanResult or committed event", () => {
    const result = createCandidateFromTalkEvent(
      talkEvent("hpi.decision.choose", { optionId: "accept-baseline-first" }),
      projection,
    );
    assert.equal(result.kind, "CANDIDATE_CREATED");
    assert.equal(result.candidate.eventType, "HumanDecisionProposed");
    assert.equal(result.candidate.status, "CANDIDATE");
    assert.equal(result.candidate.payload.optionId, "accept-baseline-first");
    assert.equal("humanResultId" in result.candidate, false);
    assert.equal("committed" in result.candidate, false);
  });

  it("treats navigation and refresh events as read-only", () => {
    for (const type of ["hpi.view.l2", "hpi.view.machine_result", "hpi.view.evidence", "hpi.refresh"]) {
      const result = createCandidateFromTalkEvent({ id: `evt-${type}`, type, payload: {} }, projection);
      assert.equal(result.kind, "READ_ONLY");
      assert.equal(result.candidate, null);
    }
  });

  it("rejects stale source and request digests", () => {
    const staleSource = createCandidateFromTalkEvent(
      talkEvent("hpi.decision.choose", {
        sourceDigest: "f".repeat(64),
        optionId: "accept-baseline-first",
      }),
      projection,
    );
    assert.equal(staleSource.kind, "STALE");

    const staleRequest = createCandidateFromTalkEvent(
      talkEvent("hpi.decision.choose", {
        requestDigest: "e".repeat(64),
        optionId: "accept-baseline-first",
      }),
      projection,
    );
    assert.equal(staleRequest.kind, "STALE");
  });

  it("rejects unknown options and untrusted event types", () => {
    assert.throws(
      () =>
        createCandidateFromTalkEvent(
          talkEvent("hpi.decision.choose", { optionId: "approve-tests" }),
          projection,
        ),
      /unknown decision option/,
    );
    assert.throws(
      () => createCandidateFromTalkEvent({ id: "evt-bad", type: "hpi.commit", payload: {} }, projection),
      GateError,
    );
  });
});

describe("other candidate proposals and freshness", () => {
  it("creates Pain proposals as candidates bound to source", () => {
    const candidate = createProposalCandidate(
      {
        op: "pain",
        projectId: projection.projectId,
        sourceDigest: projection.sourceDigest,
        statement: "三天后仍不知道为什么做这个任务。",
      },
      new Date("2026-08-30T00:00:00.000Z"),
    );
    assert.equal(candidate.eventType, "PainProposed");
    assert.equal(candidate.status, "CANDIDATE");
    assert.equal(candidateFreshness(candidate, projection.sourceDigest).status, "CURRENT");
    assert.equal(candidateFreshness(candidate, "0".repeat(64)).status, "STALE");
  });

  it("deduplicates replayed model proposals by stable tool-call origin", () => {
    const input = {
      op: "change",
      projectId: projection.projectId,
      sourceDigest: projection.sourceDigest,
      statement: "调整 brief 默认聚合方式。",
      objectId: "HB-1",
      originId: "tool-call-stable-001",
    };
    const first = createProposalCandidate(input, new Date("2026-08-30T00:00:00.000Z"));
    const replay = createProposalCandidate(input, new Date("2026-08-30T01:00:00.000Z"));
    assert.equal(replay.eventId, first.eventId);
    assert.notEqual(replay.createdAt, first.createdAt);
  });
});
