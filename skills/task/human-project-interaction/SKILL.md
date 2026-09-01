---
name: human-project-interaction
description: Re-enters supported multi-agent or long-running projects through Human Project State and Human Brief, separates machine evidence from human intent/design/risk decisions, and renders the hpi-project /talk view. Use inside a detected HPI project adapter (currently TS-001 pilot or R-ICL v4) when the user asks 项目现在到哪了、为什么做、解决了哪个痛点、还剩什么、需要我决定什么, resumes after another agent/session, receives a trust request about tests/hash/schema/evidence, or raises a new pain. On unsupported roots report adapter unavailable once and stop; do not guess by scanning the repository. Do not use for routine single-file coding, ordinary code review, or running machine tests themselves.
compatibility: Pi coding agent with hpi_query, hpi_propose, hpi_validation, and /talk tools
metadata:
  version: "0.6.0"
  status: "active"
  layer: "task"
  priority: "45"
  triggers: "project-reentry,human-brief,human-escalation,multi-agent-handoff,pain-tracking"
---

# Human Project Interaction

## Outcome

Restore the user's project mental model, then ask only the one semantic decision that genuinely belongs to a human. Keep machine evidence, human judgment, and project canonical state separate.

## Trigger boundary

Use when any of these is true:

- the user returns to a multi-stage project after another Agent or session;
- the user asks what changed, why the work exists, which pain it addresses, what remains, or what comes next;
- an Agent asks the user to believe or approve test counts, hashes, schemas, files, references, or absence of side effects;
- a TaskSlice reaches terminal, paused, failed, recovery, or human-pending state;
- the user discovers a new pain and wants it connected to the current design or scope;
- the user runs `/hpi` or `/skill:human-project-interaction`.

Do not use for:

- a routine isolated implementation whose background and acceptance are already clear;
- executing tests, checking hashes, reviewing code, or validating schemas as a substitute for their normal tools;
- granting permissions, committing canonical state, dispatching a full multi-Agent runtime, or recording a final HumanResult.

## Authority boundary

HPI is a deterministic interaction adapter, not Harness Core.

- `hpi_query` reads and rebuilds projections.
- `hpi_propose` can create a **session-only CandidateEvent**.
- `/talk` displays structured content and returns UI events.
- None of them can write project canonical state or convert a candidate into HumanResult.
- A prompt instruction is never a filesystem, permission, transaction, or identity boundary.
- Supported adapters are currently `ts001-pilot/0.1.0` and `ricl-v4-readonly/0.1.0`; neither grants write authority.
- External interoperability uses immutable interaction v1, preserved execution v1, and current `hpi/wire/execution/v2` with snake_case-only keys; camelCase remains internal.
- Generic execution codecs/lifecycle helpers can only validate or return candidate/preview data; they cannot dispatch Agents, accept Bundles, commit Results, invalidate canonical state, or create HumanResult.
- `hpi_validation` is a separate machine-only slice: preview is zero-write; run uses a cwd-anchored, atomic-no-replace worker and writes only `.pi/artifacts/hpi-validation/v1/<attempt_id>`; it has authority only over that attempt history.
- A validation-runtime-v1 local `PASS-ENGINEERING` never changes formal TS-001 `NOT-RUN`, P0, Human status, CandidateEvent, HumanResult, or project canonical state.
- If the adapter, any wire-schema lineage member/dependency, source revision, evidence, or canonical writer is unavailable or drifted, fail closed and say so; never scan drafts/raw trees to invent a replacement truth source.

## Workflow

### 1. Rebuild orientation

1. Call `hpi_query` with `op: "status"`.
2. If the tool reports no supported Adapter, state that once and stop; do not render a fabricated Brief.
3. Require `wireSchemaSet: hpi/wire/v1`, current `executionWireSchemaSet: hpi/wire/execution/v2`, and its dependency on preserved execution v1. On TS-001 also require `validationWireSchemaSet: hpi/wire/validation-runtime/v1`; missing schema/dependency integrity is a machine failure, not a human question.
4. Read the two axes independently: `machineStatus` and `humanStatus`.
5. State the detected Adapter, phase, current intent, unresolved items, and authority boundary.
6. Never infer acceptance from chat summaries, “可以”, Agent self-report, source prose containing PASS, or task completion text.

### 2. Open the Human Brief

1. Call `hpi_query` with `op: "brief"`.
2. Use the returned `talkContentJson` exactly; do not rewrite status fields or omit NOT-RUN, remaining, or risks.
3. Call `talk_set_style` with `styleId: "hpi-project"`.
4. Call `talk_render` with:
   - `styleId: "hpi-project"`;
   - `content`: the exact `talkContentJson`;
   - a short project title;
   - `verify: true` when available.
5. Call `talk_verify` after rendering and check console/page errors before presenting the view.
6. In the main transcript, summarize only the machine axis, human axis, remaining work, and the single current decision.
7. When the user explicitly needs cross-host data, use `hpi_query(op="wire")` or `/hpi wire [id]`; return interaction objects and execution-contract metadata unchanged. `available_project_objects: 0` means no typed execution record was found, not permission to infer one.

### 3. Handle machine-fact requests

Machine facts include test counts, PASS claims, hash/SHA, schema validity, file existence, reference resolution, permissions, network access, and side effects.

- Do not ask “你是否相信/接受/确认”.
- Query `evidence` when needed.
- If evidence is absent or the authority says NOT-RUN/RUNNING/INCOMPLETE, preserve that authority state; individual evidence cannot promote it to PASS.
- An Agent cannot mint a new human question from prose. For `hpi_propose(op="escalation")`, pass only a binding to the projector-owned current request: `projectId`, `category`, `requestId`, `requestDigest`, and `sourceDigest`; optional echoed question/unit must match exactly.
- A Gate result with `humanEscalation: null` ends the human question. Report the missing machine evidence or current machine status instead.

### 4. Interpret validation-runtime attempts

Do not create or discover a manifest from chat, prose, drafts, or adjacent files. When the caller already provides an explicit project-relative ValidationAttemptInput:

- `hpi_validation(op="preview")` must be used before `run`; preview writes nothing.
- `run` may append only the isolated attempt ledger and returns a scoped MachineResult.
- Use only the runtime/status top-level `machineResult` as the current result. `history.machineResult` and `historicalMachineResult` are immutable history; persisted success must match the shared canonical Gate/fact derivation, current Gates are re-evaluated, Gate/source drift lowers the top-level result to `INCOMPLETE`, and an unavailable current base makes it `null`.
- `status` reads one explicit attempt ID; non-terminal history is `INCOMPLETE_INTERRUPTED`, never successful completion.
- Exact terminal replay appends nothing. Divergent input under the same attempt ID is a conflict. Retry requires a new attempt ID and exact `retry_of` latest-record binding.
- Always say “validation-runtime-v1 局部结果”; if local PASS is shown, state in the same sentence that formal TS-001 remains NOT-RUN and no independent Validation Agent ran.
- Never ask the human to accept Gate status, hashes, recovery, or filesystem evidence.

### 5. Ask one real human decision

Allowed categories are `INTENT`, `SCOPE`, `DESIGN`, `RISK`, `IRREVERSIBLE`, and `SEMANTIC_OUTCOME`.

A request must have:

- one decision unit and exactly one question;
- current facts with source/evidence status;
- explicit options, consequences, risks, and reversibility;
- a recommendation;
- `NO_STATE_CHANGE` as the safe default;
- affected revisions and a request digest.

Never combine approval of tests, candidate baseline, canonical intake, and next-stage scope into one answer.

### 6. Receive `/talk` events

1. After the user interacts, call `talk_poll_events`.
2. For each `hpi.*` event, pass the complete event object unchanged to `hpi_propose` with:
   - `op: "ingest_talk_event"`;
   - `payloadJson`: the event JSON.
3. Read the result literally:
   - `READ_ONLY`: navigation/refresh only;
   - `STALE`: source or request changed; rebuild the Brief and ask again;
   - `CANDIDATE_CREATED`: saved only to Pi session outbox.
4. Say “候选已记录，尚未写入 canonical”; never say accepted, committed, or approved.

### 7. Capture a new pain or change

- For a new pain, call `hpi_propose` with `op: "pain"` and the user's exact statement.
- For a requested revision, use `op: "change"`, the statement, and affected object id when known.
- Preserve whether it supplements an existing Pain, reveals a Design side effect, or proposes new scope; do not decide that classification on the user's behalf.

## Presentation order

Always present in this order:

1. why the project exists;
2. current phase and latest meaningful change;
3. which pain/design the active TaskSlice serves;
4. machine verified / self-reported / NOT-RUN / incomplete;
5. remaining work and risk;
6. why the next step is next;
7. one human decision, if any;
8. provenance and raw evidence only on demand.

See [the interaction contract](references/interaction-contract.md) for tool payloads, event types, and state meanings.

## Verification

Before calling an HPI interaction complete, verify:

- Machine and Human status are both visible and neither overwrote the other.
- NOT-RUN or INCOMPLETE, remaining, and risks remain visible in L0/L1.
- A machine-fact trust request produced no human escalation.
- The interaction v1 + preserved execution v1 + current execution v2 lineage loaded with pinned digests; on TS-001 the validation-runtime-v1 lineage also loaded; mixed snake_case/camelCase input was not accepted.
- Generic execution Result/retry/stale output remained candidate/preview-only. Any validation attempt result was labeled local machine-only, wrote only its isolated ledger, and did not claim formal TS-001, dispatch, HumanResult, CandidateEvent intake, automatic invalidation, or canonical mutation.
- The rendered style is `hpi-project` and visual verification has no console/page errors.
- A decision click became at most a CandidateEvent.
- On resume, the projection rebuilds and old candidates become stale after source changes.

## Completion

Report the detected Adapter, current interaction/execution/available-validation set digests and lineage, projection id, source digest, machine/human axes, any session candidate id, and explicit non-implemented boundaries. Never describe this interaction surface as the full multi-Agent runtime; never convert formal TS-001 NOT-RUN, a local validation-runtime PASS, or R-ICL source prose into broader PASS-ENGINEERING.
