import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { detectProjectAdapter } from "../../src/adapters/registry.mjs";
import {
  createCandidateFromTalkEvent,
  createProposalCandidate,
  evaluateEscalation,
} from "../../src/gate.mjs";
import { rebuildProjectProjection } from "../../src/projector.mjs";
import {
  HPI_OUTBOX_ENTRY_TYPE,
  createOutboxEntry,
  outboxHasCandidate,
  outboxHasTalkReceipt,
  restoreOutbox,
  summarizeOutbox,
} from "../../src/session.mjs";
import { buildTalkContent } from "../../src/talk-content.mjs";
import {
  loadExecutionWireSchemaSet,
  loadWireSchemaSet,
} from "../../src/wire-schema.mjs";
import {
  toWireEscalationRequest,
  toWireHps,
  toWireHumanBrief,
  toWireMachineResult,
  toWireTraceLink,
} from "../../src/wire.mjs";

const QUERY_OPS = ["status", "brief", "trace", "evidence", "decisions", "wire"] as const;
const PROPOSE_OPS = ["escalation", "pain", "change", "ingest_talk_event"] as const;
const HPI_TOOL_NAMES = new Set(["hpi_query", "hpi_propose"]);
const MAX_TOOL_TEXT_BYTES = 45_000;

type RuntimeState = {
  cwd?: string;
  projection?: any;
  restoredOutbox?: any;
  detected?: ReturnType<typeof detectProjectAdapter>;
  error?: string;
  refreshedAt?: string;
  sourceChanged?: boolean;
  wireSchema?: {
    schemaSet: string;
    naming: string;
    schemaSetDigest: string;
  };
  executionWireSchema?: {
    schemaSet: string;
    naming: string;
    schemaSetDigest: string;
    dependencies: Array<{ schema_set: string; schema_set_digest: string }>;
  };
};

function compactJson(value: unknown): string {
  const full = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(full, "utf8") <= MAX_TOOL_TEXT_BYTES) return full;
  return `${full.slice(0, MAX_TOOL_TEXT_BYTES)}\n\n[HPI output truncated at ${MAX_TOOL_TEXT_BYTES} bytes; structured details retain the complete result.]`;
}

function parseJsonObject(value: string | undefined, name: string): Record<string, unknown> {
  if (!value?.trim()) throw new Error(`${name} is required and must be JSON`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must decode to an object`);
  }
  return parsed as Record<string, unknown>;
}

function commandArgs(args: string): { sub: string; rest: string } {
  const trimmed = args.trim();
  if (!trimmed) return { sub: "open", rest: "" };
  const split = trimmed.indexOf(" ");
  return split < 0
    ? { sub: trimmed.toLowerCase(), rest: "" }
    : { sub: trimmed.slice(0, split).toLowerCase(), rest: trimmed.slice(split + 1).trim() };
}

function wireObjects(projection: any, objectId?: string): any[] {
  const candidates = [
    {
      ids: [projection.projectId, projection.hps.projectionId],
      value: toWireHps(projection.hps),
    },
    ...projection.briefs.map((brief: any) => ({
      ids: [brief.briefId, brief.projectId],
      value: toWireHumanBrief(brief),
    })),
    ...projection.machineResults.map((result: any) => ({
      ids: [result.resultId, result.taskId],
      value: toWireMachineResult(result),
    })),
    ...projection.escalationRequests.map((request: any) => ({
      ids: [request.requestId, request.projectId],
      value: toWireEscalationRequest(request),
    })),
    ...projection.traces.map((trace: any) => ({
      ids: [trace.linkId, trace.from.id, trace.to.id],
      value: toWireTraceLink(trace),
    })),
  ];
  return candidates
    .filter((candidate) => !objectId || candidate.ids.includes(objectId))
    .map((candidate) => candidate.value);
}

export default function hpiExtension(pi: ExtensionAPI) {
  let state: RuntimeState = {};

  function setStatus(ctx: ExtensionContext): void {
    if (!state.projection) {
      ctx.ui.setStatus("hpi", undefined);
      return;
    }
    const work = state.projection.hps.activeWork[0];
    ctx.ui.setStatus("hpi", `hpi:${work.machineStatus}/${work.humanStatus}`);
  }

  function refresh(ctx: ExtensionContext): RuntimeState {
    const detected = detectProjectAdapter(ctx.cwd);
    if (!detected.available) {
      state = {
        cwd: ctx.cwd,
        detected,
        error: `unsupported project adapter; missing: ${detected.missing.join(", ")}`,
        refreshedAt: new Date().toISOString(),
      };
      setStatus(ctx);
      return state;
    }
    try {
      const previousDigest = state.projection?.sourceDigest;
      const loadedWireSchema = loadWireSchemaSet();
      const loadedExecutionWireSchema = loadExecutionWireSchemaSet();
      const projection = rebuildProjectProjection(ctx.cwd);
      const restoredOutbox = restoreOutbox(ctx.sessionManager.getBranch(), projection.sourceDigest);
      state = {
        cwd: ctx.cwd,
        detected,
        projection,
        restoredOutbox,
        refreshedAt: new Date().toISOString(),
        sourceChanged: Boolean(previousDigest && previousDigest !== projection.sourceDigest),
        wireSchema: {
          schemaSet: loadedWireSchema.schemaSet,
          naming: loadedWireSchema.naming,
          schemaSetDigest: loadedWireSchema.schemaSetDigest,
        },
        executionWireSchema: {
          schemaSet: loadedExecutionWireSchema.schemaSet,
          naming: loadedExecutionWireSchema.naming,
          schemaSetDigest: loadedExecutionWireSchema.schemaSetDigest,
          dependencies: loadedExecutionWireSchema.dependencies,
        },
      };
    } catch (error) {
      state = {
        cwd: ctx.cwd,
        detected,
        error: error instanceof Error ? error.message : String(error),
        refreshedAt: new Date().toISOString(),
      };
    }
    setStatus(ctx);
    return state;
  }

  function requireProjection(ctx: ExtensionContext): any {
    refresh(ctx);
    if (!state.projection) {
      throw new Error(`HPI fail-closed: ${state.error ?? "projection unavailable"}`);
    }
    return state.projection;
  }

  function query(op: (typeof QUERY_OPS)[number], objectId: string | undefined, ctx: ExtensionContext): unknown {
    const projection = requireProjection(ctx);
    if (op === "status") {
      return {
        adapter: projection.adapter,
        hps: projection.hps,
        wireSchemaSet: state.wireSchema?.schemaSet,
        wireSchemaSetDigest: state.wireSchema?.schemaSetDigest,
        executionWireSchemaSet: state.executionWireSchema?.schemaSet,
        executionWireSchemaSetDigest: state.executionWireSchema?.schemaSetDigest,
        executionWireDependencies: state.executionWireSchema?.dependencies,
        wireNaming: state.wireSchema?.naming,
        outbox: summarizeOutbox(state.restoredOutbox),
        boundaries: {
          projectCanonicalWrite: "NOT_IMPLEMENTED_BY_HPI",
          fullMultiAgentRuntime: "NOT_IMPLEMENTED",
          executionRuntimeIntake: "NOT_IMPLEMENTED",
          executionLifecycle: "SCHEMA_AND_PURE_PREVIEW_ONLY",
          projectMachineStatus: projection.hps.activeWork[0].machineStatus,
        },
      };
    }
    if (op === "brief") {
      const talkContent = buildTalkContent(projection, { restoredOutbox: state.restoredOutbox });
      return {
        adapter: projection.adapter,
        brief: projection.briefs[0],
        talkStyleId: "hpi-project",
        talkContent,
        talkContentJson: JSON.stringify(talkContent),
        wireContract: state.wireSchema,
        executionWireContract: state.executionWireSchema,
        instruction: "Render talkContentJson exactly with talk_render(styleId='hpi-project'); do not rewrite statuses.",
      };
    }
    if (op === "trace") {
      const traces = objectId
        ? projection.traces.filter(
            (trace: any) =>
              trace.linkId === objectId || trace.from.id === objectId || trace.to.id === objectId,
          )
        : projection.traces;
      return { objectId, traces, count: traces.length };
    }
    if (op === "evidence") {
      const machineResults = objectId
        ? projection.machineResults.filter(
            (result: any) => result.resultId === objectId || result.taskId === objectId,
          )
        : projection.machineResults;
      return { objectId, machineResults, count: machineResults.length };
    }
    if (op === "wire") {
      const objects = wireObjects(projection, objectId);
      return {
        schema_set: state.wireSchema?.schemaSet,
        schema_set_digest: state.wireSchema?.schemaSetDigest,
        naming: state.wireSchema?.naming,
        inbound_runtime: "NOT_IMPLEMENTED",
        objects,
        count: objects.length,
        execution_contract: {
          schema_set: state.executionWireSchema?.schemaSet,
          schema_set_digest: state.executionWireSchema?.schemaSetDigest,
          naming: state.executionWireSchema?.naming,
          dependencies: state.executionWireSchema?.dependencies,
          runtime_intake: "NOT_IMPLEMENTED",
          canonical_writer: "NOT_IMPLEMENTED",
          available_project_objects: 0,
          lifecycle_mode: "SCHEMA_AND_PURE_PREVIEW_ONLY",
        },
      };
    }
    return {
      requests: projection.escalationRequests,
      outbox: state.restoredOutbox,
      summary: summarizeOutbox(state.restoredOutbox),
    };
  }

  function persistCandidate(candidate: any, receiptId: string, ctx: ExtensionContext): { duplicate: boolean; entry: any } {
    const restored = state.restoredOutbox ?? restoreOutbox(ctx.sessionManager.getBranch(), candidate.basis.sourceDigest);
    if (outboxHasCandidate(restored, candidate.eventId) || outboxHasTalkReceipt(restored, receiptId)) {
      return { duplicate: true, entry: undefined };
    }
    const entry = createOutboxEntry(candidate, {
      talkEventId: receiptId,
      recordedAt: candidate.createdAt,
    });
    pi.appendEntry(HPI_OUTBOX_ENTRY_TYPE, entry);
    refresh(ctx);
    return { duplicate: false, entry };
  }

  pi.on("session_start", (_event, ctx) => {
    refresh(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("hpi", undefined);
  });

  pi.on("before_agent_start", (event, ctx) => {
    refresh(ctx);
    if (!state.projection) return;
    const projection = state.projection;
    const work = projection.hps.activeWork[0];
    const decision = projection.escalationRequests[0];
    const appendix = [
      "HPI READ-ONLY PROJECT CONTEXT (orientation, not a permission or transaction boundary):",
      `project=${projection.projectId}`,
      `adapter=${projection.adapter}`,
      `phase=${projection.hps.phase}`,
      `machine=${work.machineStatus}`,
      `human=${work.humanStatus}`,
      `projectionId=${projection.hps.projectionId}`,
      `sourceDigest=${projection.sourceDigest}`,
      `wireSchemaSet=${state.wireSchema?.schemaSet ?? "unavailable"}`,
      `wireSchemaSetDigest=${state.wireSchema?.schemaSetDigest ?? "unavailable"}`,
      `executionWireSchemaSet=${state.executionWireSchema?.schemaSet ?? "unavailable"}`,
      `executionWireSchemaSetDigest=${state.executionWireSchema?.schemaSetDigest ?? "unavailable"}`,
      `nextHumanDecision=${decision?.question ?? "none"}`,
      "Rules: use hpi_query for structured status; machine facts/test counts/hash/schema are never escalated for human belief; hpi_propose creates session candidates only; HPI cannot write project canonical state.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}\n\n${appendix}` };
  });

  pi.on("agent_settled", (_event, ctx) => {
    const before = state.projection?.sourceDigest;
    refresh(ctx);
    if (before && state.projection?.sourceDigest !== before) {
      ctx.ui.notify("HPI source snapshot changed; projection rebuilt and older decision candidates may now be stale.", "warning");
    }
  });

  pi.on("tool_call", (event, ctx) => {
    if (!HPI_TOOL_NAMES.has(event.toolName)) return;
    const detected = detectProjectAdapter(ctx.cwd);
    if (!detected.available) {
      return {
        block: true,
        reason: `HPI fail-closed: no supported adapter in this project (${detected.missing.join(", ")})`,
      };
    }
    if (event.toolName === "hpi_propose") {
      const op = (event.input as { op?: string }).op;
      if (!PROPOSE_OPS.includes(op as (typeof PROPOSE_OPS)[number])) {
        return { block: true, reason: "HPI fail-closed: unsupported proposal operation" };
      }
    }
  });

  pi.registerCommand("hpi", {
    description: "Open Human Project Interaction, inspect a brief/trace/decision, export frozen wire objects, or verify the read-only projection and frozen schema lineage.",
    getArgumentCompletions: (prefix) => {
      const values = ["open", "status", "brief", "trace", "wire", "decisions", "verify", "help"];
      const items = values
        .filter((value) => value.startsWith(prefix.trim().toLowerCase()))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const { sub, rest } = commandArgs(args);
      if (sub === "help") {
        ctx.ui.notify(
          [
            "/hpi — open the L0/L1 project re-entry view in /talk",
            "/hpi status — show dual-axis project status",
            "/hpi brief [id] — render the Human Brief",
            "/hpi trace <id> — inspect semantic trace",
            "/hpi wire [id] — export frozen snake_case wire objects",
            "/hpi decisions — inspect pending requests and session candidates",
            "/hpi verify — rebuild the read-only projection and verify the frozen interaction/execution schema lineage",
          ].join("\n"),
          "info",
        );
        return;
      }
      if (sub === "status") {
        try {
          const data = query("status", rest || undefined, ctx);
          ctx.ui.notify(compactJson(data), "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      if (sub === "wire") {
        try {
          const data = query("wire", rest || undefined, ctx);
          ctx.ui.notify(compactJson(data), "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      if (sub === "verify") {
        try {
          const first = requireProjection(ctx);
          const second = rebuildProjectProjection(ctx.cwd);
          const verifiedWireSchema = loadWireSchemaSet();
          const verifiedExecutionWireSchema = loadExecutionWireSchemaSet();
          const deterministic = first.hps.projectionId === second.hps.projectionId;
          const result = {
            adapter: state.detected?.adapter,
            deterministic,
            projectionId: first.hps.projectionId,
            sourceDigest: first.sourceDigest,
            wireSchemaSet: verifiedWireSchema.schemaSet,
            wireSchemaSetDigest: verifiedWireSchema.schemaSetDigest,
            executionWireSchemaSet: verifiedExecutionWireSchema.schemaSet,
            executionWireSchemaSetDigest: verifiedExecutionWireSchema.schemaSetDigest,
            executionWireDependencies: verifiedExecutionWireSchema.dependencies,
            wireNaming: verifiedWireSchema.naming,
            schemaIntegrity: true,
            machine: first.hps.activeWork[0].machineStatus,
            human: first.hps.activeWork[0].humanStatus,
            outbox: summarizeOutbox(state.restoredOutbox),
            boundary: "projection and frozen schema-lineage verification only; execution lifecycle is pure preview and the adapter does not run project tests or write canonical state",
          };
          ctx.ui.notify(compactJson(result), result.deterministic ? "info" : "error");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      if (!["open", "brief", "trace", "decisions"].includes(sub)) {
        ctx.ui.notify(`Unknown /hpi subcommand: ${sub}. Use /hpi help.`, "warning");
        return;
      }
      const detected = detectProjectAdapter(ctx.cwd);
      if (!detected.available) {
        ctx.ui.notify(`HPI adapter unavailable; missing: ${detected.missing.join(", ")}`, "error");
        return;
      }
      const skillArgs = [sub === "open" ? "open" : sub, rest].filter(Boolean).join(" ");
      pi.sendUserMessage(`/skill:human-project-interaction ${skillArgs}`, {
        expandPromptTemplates: true,
      });
    },
  });

  pi.registerTool({
    name: "hpi_query",
    label: "HPI query",
    description:
      "Read the current Human Project State, deterministic Human Brief, semantic trace, machine evidence, pending decisions, or frozen snake_case wire objects. Read-only; never changes project canonical state.",
    promptSnippet: "Read Human Project State, Human Brief, or frozen wire objects for long-running multi-agent project re-entry",
    promptGuidelines: [
      "Use hpi_query before asking a human to review a multi-stage project; machine test/hash/schema facts must stay on the machine axis.",
      "Render hpi_query brief.talkContentJson with talk_render styleId hpi-project without rewriting its statuses.",
      "Use op=wire only for read-only cross-host export; execution contract metadata never enables Bundle intake, HumanResult intake, or canonical writes.",
    ],
    parameters: Type.Object({
      op: StringEnum(QUERY_OPS, { description: "Read-only query operation" }),
      objectId: Type.Optional(Type.String({ description: "Optional task, result, trace, Pain, or Design id" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const data = query(params.op, params.objectId, ctx);
      return {
        content: [{ type: "text", text: compactJson(data) }],
        details: { ok: true, op: params.op, data },
      };
    },
  });

  pi.registerTool({
    name: "hpi_propose",
    label: "HPI propose candidate",
    description:
      "Run the deterministic Human Escalation Gate or create a session-only candidate Pain/change/decision event. Never creates HumanResult, never commits, and never writes project canonical state.",
    promptSnippet: "Propose gated human decisions or new pain/change candidates without canonical writes",
    promptGuidelines: [
      "Use hpi_propose only after hpi_query establishes the current sourceDigest; hpi_propose outputs CANDIDATE or a fail-closed rejection, never acceptance.",
      "Pass talk_poll_events output to hpi_propose op=ingest_talk_event; do not reinterpret a button event as a HumanResult.",
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      op: StringEnum(PROPOSE_OPS, { description: "Candidate operation" }),
      payloadJson: Type.Optional(
        Type.String({ description: "Escalation candidate or talk event as a JSON object" }),
      ),
      statement: Type.Optional(Type.String({ description: "New Pain or requested change statement" })),
      objectId: Type.Optional(Type.String({ description: "Affected object id for change proposals" })),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const projection = requireProjection(ctx);
      if (params.op === "ingest_talk_event") {
        const talkEvent = parseJsonObject(params.payloadJson, "payloadJson");
        const result = createCandidateFromTalkEvent(talkEvent, projection);
        if (result.kind !== "CANDIDATE_CREATED") {
          return {
            content: [{ type: "text", text: compactJson(result) }],
            details: { ok: result.kind === "READ_ONLY", result },
          };
        }
        const receiptId = String(talkEvent.id);
        const persisted = persistCandidate(result.candidate, receiptId, ctx);
        const output = {
          ...result,
          duplicate: persisted.duplicate,
          persistedTo: "Pi session outbox only",
          projectCanonicalChanged: false,
        };
        return {
          content: [{ type: "text", text: compactJson(output) }],
          details: { ok: true, result: output },
        };
      }

      if (params.op === "escalation") {
        const candidate = parseJsonObject(params.payloadJson, "payloadJson");
        const gateResult = evaluateEscalation(candidate, {
          machineStatus: projection.hps.activeWork[0].machineStatus,
          sourceDigest: projection.sourceDigest,
          trustedRequests: projection.escalationRequests,
        });
        if (gateResult.kind !== "HUMAN_DECISION_REQUIRED") {
          return {
            content: [{ type: "text", text: compactJson(gateResult) }],
            details: { ok: true, result: gateResult },
          };
        }
        const proposal = createProposalCandidate(
          {
            op: "escalation",
            projectId: projection.projectId,
            sourceDigest: projection.sourceDigest,
            statement: gateResult.request.question,
            objectId: gateResult.request.requestId,
            originId: toolCallId,
          },
          new Date(),
        );
        const persisted = persistCandidate(proposal, `tool:${toolCallId}`, ctx);
        const output = {
          gate: gateResult,
          candidate: proposal,
          duplicate: persisted.duplicate,
          persistedTo: "Pi session outbox only",
          projectCanonicalChanged: false,
        };
        return {
          content: [{ type: "text", text: compactJson(output) }],
          details: { ok: true, result: output },
        };
      }

      const proposal = createProposalCandidate(
        {
          op: params.op,
          projectId: projection.projectId,
          sourceDigest: projection.sourceDigest,
          statement: params.statement,
          objectId: params.objectId,
          originId: toolCallId,
        },
        new Date(),
      );
      const persisted = persistCandidate(proposal, `tool:${toolCallId}`, ctx);
      const output = {
        candidate: proposal,
        duplicate: persisted.duplicate,
        persistedTo: "Pi session outbox only",
        projectCanonicalChanged: false,
      };
      return {
        content: [{ type: "text", text: compactJson(output) }],
        details: { ok: true, result: output },
      };
    },
  });
}
