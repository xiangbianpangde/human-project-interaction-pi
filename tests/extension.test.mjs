import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadPiExtensions } from "./support/pi-runtime.mjs";
import { buildValidationAttemptFixture } from "./support/validation-runtime-fixture.mjs";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const extensionPath = resolve(rootPath, "extension/hpi/index.ts");

async function loadHpi() {
  const loaded = await loadPiExtensions([extensionPath], rootPath);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  return { loaded, extension: loaded.extensions[0] };
}

function assertSnakeCaseKeys(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSnakeCaseKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /[A-Z]/u, `${path}.${key} must use snake_case`);
    assertSnakeCaseKeys(child, `${path}.${key}`);
  }
}

function mockContext(cwd = rootPath) {
  const entries = [];
  const notifications = [];
  const statuses = new Map();
  return {
    entries,
    notifications,
    statuses,
    ctx: {
      cwd,
      mode: "print",
      hasUI: false,
      sessionManager: { getBranch: () => entries },
      ui: {
        setStatus: (key, value) => statuses.set(key, value),
        notify: (message, type) => notifications.push({ message, type }),
      },
    },
  };
}

describe("Pi extension registration", () => {
  it("loads with the installed Pi loader and registers the bounded API", async () => {
    const { extension } = await loadHpi();
    assert.deepEqual([...extension.commands.keys()], ["hpi"]);
    assert.deepEqual([...extension.tools.keys()].sort(), ["hpi_propose", "hpi_query", "hpi_validation"]);
    for (const hook of [
      "session_start",
      "session_shutdown",
      "before_agent_start",
      "agent_settled",
      "tool_call",
    ]) {
      assert.ok(extension.handlers.has(hook), `missing hook ${hook}`);
    }
    assert.equal(extension.tools.has("hpi_accept"), false);
    assert.equal(extension.tools.has("hpi_commit"), false);
    assert.equal(extension.tools.has("hpi_write_state"), false);
    assert.equal(extension.tools.has("hpi_run_formal_ts001"), false);
  });
});

describe("Pi lifecycle and query", () => {
  it("rebuilds HPS on session_start and injects an orientation-only appendix", async () => {
    const { extension } = await loadHpi();
    const { ctx, statuses } = mockContext();
    await extension.handlers.get("session_start")[0]({ type: "session_start", reason: "startup" }, ctx);
    assert.equal(statuses.get("hpi"), "hpi:NOT-RUN/HUMAN_PENDING");
    const result = await extension.handlers.get("before_agent_start")[0](
      { type: "before_agent_start", prompt: "status", systemPrompt: "base", systemPromptOptions: {} },
      ctx,
    );
    assert.match(result.systemPrompt, /machine=NOT-RUN/);
    assert.match(result.systemPrompt, /orientation, not a permission or transaction boundary/);
    assert.match(result.systemPrompt, /executionWireSchemaSet=hpi\/wire\/execution\/v2/);
    assert.match(result.systemPrompt, /executionWireSchemaSetDigest=[a-f0-9]{64}/);
    assert.match(result.systemPrompt, /cannot write project canonical state/);
  });

  it("returns deterministic talk content without changing the session", async () => {
    const { extension } = await loadHpi();
    const { ctx, entries } = mockContext();
    const tool = extension.tools.get("hpi_query").definition;
    const result = await tool.execute("query-1", { op: "brief" }, undefined, undefined, ctx);
    const data = result.details.data;
    assert.equal(data.talkStyleId, "hpi-project");
    assert.equal(data.talkContent.status.machine, "NOT-RUN");
    assert.equal(data.talkContent.status.human, "HUMAN_PENDING");
    assert.equal("overallStatus" in data.talkContent, false);
    assert.equal(entries.length, 0);
  });

  it("exports schema-bound snake_case wire objects without enabling inbound writes", async () => {
    const { extension } = await loadHpi();
    const { ctx, entries } = mockContext();
    const tool = extension.tools.get("hpi_query").definition;
    const result = await tool.execute("query-wire", { op: "wire" }, undefined, undefined, ctx);
    const data = result.details.data;
    assert.equal(data.schema_set, "hpi/wire/v1");
    assert.equal(data.naming, "snake_case");
    assert.equal(data.inbound_runtime, "NOT_IMPLEMENTED");
    assert.ok(data.objects.length >= 6);
    assert.ok(data.objects.some((object) => object.schema === "hpi/wire/hps/v1"));
    assert.ok(data.objects.some((object) => object.schema === "hpi/wire/human-brief/v1"));
    assert.equal(data.execution_contract.schema_set, "hpi/wire/execution/v2");
    assert.match(data.execution_contract.schema_set_digest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(
      data.execution_contract.dependencies.map((dependency) => dependency.schema_set),
      ["hpi/wire/v1", "hpi/wire/execution/v1"],
    );
    assert.equal(data.execution_contract.runtime_intake, "NOT_IMPLEMENTED");
    assert.equal(data.execution_contract.canonical_writer, "NOT_IMPLEMENTED");
    assert.equal(data.execution_contract.available_project_objects, 0);
    assert.equal(data.execution_contract.lifecycle_mode, "SCHEMA_AND_PURE_PREVIEW_ONLY");
    assert.equal(data.validation_runtime_contract.schema_set, "hpi/wire/validation-runtime/v1");
    assert.match(data.validation_runtime_contract.schema_set_digest, /^[a-f0-9]{64}$/u);
    assert.equal(data.validation_runtime_contract.inbound_runtime, "validation_attempt_input_only");
    assert.equal(data.validation_runtime_contract.project_canonical_write, "FORBIDDEN");
    assert.equal(data.validation_runtime_contract.formal_ts001_status, "NOT-RUN");
    assertSnakeCaseKeys(data);
    assert.equal(entries.length, 0);
  });

  it("blocks HPI tool calls when the supported adapter is absent", async () => {
    const { extension } = await loadHpi();
    const { ctx } = mockContext("/tmp/hpi-no-supported-adapter");
    const result = await extension.handlers.get("tool_call")[0](
      { type: "tool_call", toolCallId: "x", toolName: "hpi_query", input: { op: "status" } },
      ctx,
    );
    assert.equal(result.block, true);
    assert.match(result.reason, /fail-closed/);
  });
});

describe("Pi validation-runtime tool", () => {
  it("previews and runs only the explicit machine-only attempt without session or canonical authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "hpi-extension-validation-"));
    try {
      const fixture = buildValidationAttemptFixture(root, { attemptId: "VRS1-EXTENSION-001" });
      const { extension } = await loadHpi();
      const { ctx, entries } = mockContext(root);
      const tool = extension.tools.get("hpi_validation").definition;

      const preview = await tool.execute(
        "validation-preview",
        { op: "preview", manifestPath: fixture.manifestPointer },
        undefined,
        undefined,
        ctx,
      );
      assert.equal(preview.details.data.preview.accepted, true);
      assert.equal(preview.details.data.preview.wroteStore, false);
      assert.equal(existsSync(join(root, fixture.wire.isolated_write_root)), false);

      const run = await tool.execute(
        "validation-run",
        { op: "run", manifestPath: fixture.manifestPointer },
        undefined,
        undefined,
        ctx,
      );
      const data = run.details.data;
      assert.equal(data.runtime.kind, "MACHINE_RESULT_PRODUCED");
      assert.equal(data.runtime.machineResult.verdict, "PASS-ENGINEERING");
      assert.equal(data.runtime.authority.projectCanonicalWrite, "FORBIDDEN");
      assert.equal(data.boundary.formalTs001Status, "NOT-RUN");
      assert.equal(data.projection.hps.activeWork[0].humanStatus, "NOT_NEEDED");
      assert.equal(data.projection.hps.activeWork[1].machineStatus, "NOT-RUN");
      assert.match(data.talkContent.l0.current, /正式 TS-001 仍为 NOT-RUN/u);
      assert.equal(entries.length, 0);

      const status = await tool.execute(
        "validation-status",
        { op: "status", attemptId: fixture.wire.validation_attempt_id },
        undefined,
        undefined,
        ctx,
      );
      assert.equal(status.details.data.status.history.kind, "TERMINAL");
      assert.equal(status.details.data.status.history.locked, false);
      assert.equal(entries.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("/hpi command execution", () => {
  it("reports dual-axis status without starting an agent turn", async () => {
    const { loaded, extension } = await loadHpi();
    const { ctx, notifications } = mockContext();
    const sent = [];
    loaded.runtime.sendUserMessage = (...args) => sent.push(args);

    await extension.commands.get("hpi").handler("status", ctx);

    assert.equal(sent.length, 0);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].message, /"machineStatus": "NOT-RUN"/);
    assert.match(notifications[0].message, /"humanStatus": "HUMAN_PENDING"/);
    assert.match(notifications[0].message, /"projectCanonicalWrite": "NOT_IMPLEMENTED_BY_HPI"/);
    assert.match(notifications[0].message, /"wireSchemaSet": "hpi\/wire\/v1"/);
    assert.match(notifications[0].message, /"wireSchemaSetDigest": "[a-f0-9]{64}"/);
    assert.match(notifications[0].message, /"executionWireSchemaSet": "hpi\/wire\/execution\/v2"/);
    assert.match(notifications[0].message, /"executionWireSchemaSetDigest": "[a-f0-9]{64}"/);
    assert.match(notifications[0].message, /"executionRuntimeIntake": "NOT_IMPLEMENTED"/);
    assert.match(notifications[0].message, /"validationRuntimeIntake": "VALIDATION_ATTEMPT_INPUT_V1_ONLY"/);
    assert.match(notifications[0].message, /"formalTs001Status": "NOT-RUN"/);
  });

  it("exports /hpi wire without starting an agent turn", async () => {
    const { loaded, extension } = await loadHpi();
    const { ctx, entries, notifications } = mockContext();
    const sent = [];
    loaded.runtime.sendUserMessage = (...args) => sent.push(args);

    await extension.commands.get("hpi").handler("wire", ctx);

    assert.equal(sent.length, 0);
    assert.equal(entries.length, 0);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].message, /"schema_set": "hpi\/wire\/v1"/);
    assert.match(notifications[0].message, /"inbound_runtime": "NOT_IMPLEMENTED"/);
    assert.match(notifications[0].message, /"schema_set": "hpi\/wire\/execution\/v2"/);
    assert.match(notifications[0].message, /"available_project_objects": 0/);
    assert.match(notifications[0].message, /"schema_set": "hpi\/wire\/validation-runtime\/v1"/);
    assert.match(notifications[0].message, /"formal_ts001_status": "NOT-RUN"/);
    assert.doesNotMatch(notifications[0].message, /"projectId"|"machineStatus"/);
  });

  it("routes open to the governed skill instead of mutating project state", async () => {
    const { loaded, extension } = await loadHpi();
    const { ctx, entries } = mockContext();
    const sent = [];
    loaded.runtime.sendUserMessage = (message, options) => sent.push({ message, options });

    await extension.commands.get("hpi").handler("", ctx);

    assert.deepEqual(sent, [
      {
        message: "/skill:human-project-interaction open",
        options: { expandPromptTemplates: true },
      },
    ]);
    assert.equal(entries.length, 0);
  });

  it("verifies projection determinism without claiming TS-001 execution", async () => {
    const { extension } = await loadHpi();
    const { ctx, notifications } = mockContext();

    await extension.commands.get("hpi").handler("verify", ctx);

    assert.equal(notifications.length, 1);
    assert.match(notifications[0].message, /"deterministic": true/);
    assert.match(notifications[0].message, /"machine": "NOT-RUN"/);
    assert.match(notifications[0].message, /"wireSchemaSet": "hpi\/wire\/v1"/);
    assert.match(notifications[0].message, /"wireSchemaSetDigest": "[a-f0-9]{64}"/);
    assert.match(notifications[0].message, /"executionWireSchemaSet": "hpi\/wire\/execution\/v2"/);
    assert.match(notifications[0].message, /"executionWireSchemaSetDigest": "[a-f0-9]{64}"/);
    assert.match(notifications[0].message, /"validationWireSchemaSet": "hpi\/wire\/validation-runtime\/v1"/);
    assert.match(notifications[0].message, /"validationWireSchemaSetDigest": "[a-f0-9]{64}"/);
    assert.match(notifications[0].message, /projection and frozen schema-lineage verification only; execution lifecycle is pure preview and the adapter does not run project tests or write canonical state/);
  });
});

describe("Pi candidate outbox", () => {
  it("persists escalation only when it binds the current projector-owned request", async () => {
    const { loaded, extension } = await loadHpi();
    const { ctx, entries } = mockContext();
    loaded.runtime.appendEntry = (customType, data) => {
      entries.push({
        type: "custom",
        id: `entry-${entries.length + 1}`,
        parentId: null,
        customType,
        data,
      });
    };
    const query = extension.tools.get("hpi_query").definition;
    const status = await query.execute("query-status", { op: "status" }, undefined, undefined, ctx);
    const decisions = await query.execute("query-decisions", { op: "decisions" }, undefined, undefined, ctx);
    const request = decisions.details.data.requests[0];
    const propose = extension.tools.get("hpi_propose").definition;
    const accepted = await propose.execute(
      "bound-escalation",
      {
        op: "escalation",
        payloadJson: JSON.stringify({
          projectId: status.details.data.hps.projectId,
          category: request.category,
          requestId: request.requestId,
          requestDigest: request.requestDigest,
          sourceDigest: status.details.data.hps.sourceDigest,
        }),
      },
      undefined,
      undefined,
      ctx,
    );
    assert.match(accepted.content[0].text, /"kind": "HUMAN_DECISION_REQUIRED"/);
    assert.equal(entries.length, 1);

    const unbound = await propose.execute(
      "unbound-escalation",
      {
        op: "escalation",
        payloadJson: JSON.stringify({
          projectId: status.details.data.hps.projectId,
          category: "DESIGN",
          decisionUnit: "spoofed-machine-fact",
          question: "foo 文件在吗？",
          sourceDigest: status.details.data.hps.sourceDigest,
        }),
      },
      undefined,
      undefined,
      ctx,
    );
    assert.match(unbound.content[0].text, /"kind": "UNTRUSTED_ESCALATION_REJECTED"|"kind": "NOT_RUN"/);
    assert.equal(entries.length, 1);
  });

  it("rejects machine-fact escalation without appending an entry", async () => {
    const { extension } = await loadHpi();
    const { ctx, entries } = mockContext();
    const tool = extension.tools.get("hpi_propose").definition;
    const result = await tool.execute(
      "proposal-machine-fact",
      {
        op: "escalation",
        payloadJson: JSON.stringify({
          projectId: "HPI-TS001-PILOT",
          category: "DESIGN",
          decisionUnit: "confirm test facts",
          question: "你是否接受 117/117 已通过、hash 一致？",
        }),
      },
      undefined,
      undefined,
      ctx,
    );
    assert.match(result.content[0].text, /"kind": "NOT_RUN"/);
    assert.equal(entries.length, 0);
  });

  it("deduplicates a replayed model proposal by toolCallId", async () => {
    const { loaded, extension } = await loadHpi();
    const { ctx, entries } = mockContext();
    loaded.runtime.appendEntry = (customType, data) => {
      entries.push({
        type: "custom",
        id: `entry-${entries.length + 1}`,
        parentId: null,
        customType,
        data,
      });
    };
    const tool = extension.tools.get("hpi_propose").definition;
    const params = { op: "pain", statement: "三天后仍不知道为什么做这个任务。" };
    const first = await tool.execute("stable-tool-call", params, undefined, undefined, ctx);
    const replay = await tool.execute("stable-tool-call", params, undefined, undefined, ctx);
    assert.equal(entries.length, 1);
    assert.match(first.content[0].text, /"duplicate": false/);
    assert.match(replay.content[0].text, /"duplicate": true/);
    assert.equal(entries[0].customType, "hpi-candidate-outbox");
    assert.equal(entries[0].data.authority, "SESSION_ONLY_NOT_PROJECT_CANONICAL");
    assert.equal("hps" in entries[0].data, false);
  });
});
