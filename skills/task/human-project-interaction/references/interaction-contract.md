# HPI Interaction Contract

## Supported read-only Adapters

| Adapter | Authority inputs | Conservative boundary |
|---|---|---|
| `ts001-pilot/0.1.0` | PRD, technical design, TS-001 contract | Contract remains `NOT-RUN`; self-reports cannot promote it |
| `ricl-v4-readonly/0.1.0` | unique current pointer, authority/worklog contracts, live HEAD/LOG | Source PASS/完成/学生接受 prose is not MachineResult or HumanResult; typed bundles are still missing |

Adapter selection must produce exactly one match. Zero or multiple matches fail closed. Every normalized source digest equals the digest of the Adapter id plus its canonical source snapshot.

## External wire contracts

The immutable JSON Schema 2020-12 lineage uses snake_case-only external keys:

1. `hpi/wire/v1` covers HPS, MachineResult, HumanResult, HumanBrief, EscalationRequest, and TraceLink.
2. `hpi/wire/execution/v1` is the preserved 0.4 execution contract.
3. `hpi/wire/execution/v2` is the current generic execution contract; its manifest pins the exact interaction-v1 and execution-v1 set digests.
4. `hpi/wire/validation-runtime/v1` covers ValidationAttemptInput/Record; its manifest pins interaction-v1 and execution-v2.

v2 supersedes rather than edits v1. It defines host-independent POSIX scoped paths; verdict derivation and its deterministic companion validator share a non-empty, structurally valid, uniquely identified, all-VERIFIED PASS fact-set contract. The execution companion additionally requires full `id + revision + sha256` Task/Evidence identity, `claim_refs` binding to the exact fact, direct high-trust Evidence, duplicate Evidence-id rejection, and complete-ledger conflict checks before replay classification.

The camelCase objects inside the Pi runtime are an internal profile; interaction/generic execution use `src/wire.mjs` / `src/execution.mjs`, while validation input/record crosses only through `src/validation-runtime/codecs.mjs`. Each manifest pins every schema SHA and complete set digest. Missing files, byte drift, dependency drift, mixed casing, or a digest mismatch fail closed before projection/query/intake.

Interaction and generic execution inbound runtime remain `not_implemented`. Validation alone declares `validation_attempt_input_only`: it can append only one isolated attempt ledger and has no Bundle, Agent dispatch, HumanResult/CandidateEvent, automatic invalidation, project commit, or canonical authority.

## Public commands

| Command | Behavior |
|---|---|
| `/hpi` | Route to this skill and open the current L0/L1 view in `/talk` |
| `/hpi status` | Show the dual-axis projection status without rendering a browser view |
| `/hpi brief [id]` | Build and render the deterministic Human Brief |
| `/hpi trace <id>` | Read matching TraceLinks |
| `/hpi wire [id]` | Export schema-bound snake_case objects without starting an Agent turn |
| `/hpi decisions` | Read current requests and the session candidate outbox |
| `/hpi verify` | Rebuild the projection and verify interaction/execution/validation lineage; does not run formal TS-001 |

## `hpi_query`

All operations are read-only.

```json
{
  "op": "status | brief | trace | evidence | decisions | wire",
  "objectId": "optional logical id"
}
```

`brief` returns:

- `brief`: deterministic `hpi/human-brief/v1` object;
- `talkStyleId`: always `hpi-project` for this renderer;
- `talkContent`: parsed `hpi/talk/v1` object;
- `talkContentJson`: exact JSON string for `talk_render`;
- `wireContract`: interaction schema-set id, naming rule, and pinned digest;
- `executionWireContract`: current execution-v2 set id, naming rule, pinned digest, and immutable ancestor dependencies;
- status/wire metadata also exposes validation-runtime-v1 set id/digest and fixed machine-only boundary when available.

Do not regenerate `talkContentJson` from prose.

Identity boundaries are explicit: `sourceDigest` identifies the Adapter plus canonical source snapshot, `meta.projectionId` identifies HPS, and `meta.briefId` identifies the content-addressed Human Brief. A presentation-only brief change may keep the same source/HPS ids while changing `briefId`.

`wire` returns current interaction objects plus `execution_contract` and validation-runtime contract metadata. `available_project_objects: 0` is an explicit absence result: do not infer TaskSlice/Handoff/Result/Evidence from source prose. ResultBundle uses `CANDIDATE_ONLY_NOT_PROJECT_CANONICAL`; StaleReport uses `PREVIEW_ONLY` and `project_canonical_changed: false`.

## `hpi_validation`

```json
{
  "op": "preview | run | status",
  "manifestPath": "required project-relative path for preview/run",
  "attemptId": "required for status"
}
```

- The runtime accepts one explicit manifest; it never scans or infers input.
- `preview` is zero-write. `run` may write only `.pi/artifacts/hpi-validation/v1/<attempt_id>`.
- The chain is `DECLARED → ACCEPTED → RUNNING → TERMINAL`; every record binds all five V1 Gates and immutable predecessor/input refs.
- Exact terminal replay appends nothing. Same-ID divergent input returns conflict. Non-terminal history is interrupted, never resumed. Retry uses a new ID and exact prior latest-record ref.
- A produced PASS is local to validation-runtime-v1. The restricted projection keeps formal TS-001 `NOT-RUN`, Human status separate, and no escalation request.
- Stale locks, unexpected/temp files, missing sequence, revision mismatch, ref drift, result/Gate mismatch, or scope expansion fail closed.

## `hpi_propose`

```json
{
  "op": "escalation | pain | change | ingest_talk_event",
  "payloadJson": "JSON object for escalation/talk events",
  "statement": "required for pain/change",
  "objectId": "optional affected id"
}
```

`op: "escalation"` accepts only a binding to a request already emitted by the current projector: `projectId`, `category`, `requestId`, `requestDigest`, and `sourceDigest`. Optional echoed `question` or `decisionUnit` must exactly equal the projector-owned request. Free-form model prose cannot create a new request or change its category.

Possible terminal shapes:

| Kind | Meaning | State effect |
|---|---|---|
| `NOT_RUN` | The bound/current request still tries to turn an unrun machine fact into a human belief question | none |
| `EVIDENCE_GAP` | Required machine evidence is missing | none |
| `MACHINE_FACT_REJECTED` | The question belongs to deterministic verification | none |
| `UNTRUSTED_ESCALATION_REJECTED` | The payload is unbound, forged, mismatched, or not projector-owned | none |
| `HUMAN_DECISION_REQUIRED` | One current projector-owned semantic decision passed the Gate | may create an escalation candidate |
| `READ_ONLY` | A `/talk` navigation or refresh event | none |
| `STALE` | Request/source digest no longer matches | none; rebuild |
| `CANDIDATE_CREATED` | A candidate was written to Pi session outbox | session only |

There is intentionally no `hpi_accept`, `hpi_commit`, `hpi_write_state`, or `hpi_record_human_result` tool.

## `/talk` events

Read-only:

- `hpi.view.l2`
- `hpi.view.machine_result`
- `hpi.view.evidence`
- `hpi.refresh`

Candidate-producing:

- `hpi.decision.choose`
- `hpi.decision.reject`
- `hpi.decision.request_changes`

A decision event must bind all of:

```json
{
  "requestId": "...",
  "requestDigest": "sha256",
  "sourceDigest": "sha256",
  "optionId": "required for choose"
}
```

Never reconstruct these fields from visible labels.

## State meanings

### Machine axis

- `NOT-RUN`: no qualifying run evidence exists.
- `RUNNING`: machine work is active.
- `PASS-ENGINEERING`: engineering contract passed within its declared scope.
- `INCOMPLETE`: run/evidence is insufficient.
- `DEVIATIONS_FOUND`: observed result differs from contract.
- `OUT_OF_SCOPE`: intentionally not covered by this slice.
- `BLOCKED`: a required gate or source is unavailable.

### Human axis

- `NOT_NEEDED`
- `HUMAN_PENDING`
- `HUMAN_ACCEPTED`
- `HUMAN_ACCEPTED_WITH_CONDITIONS`
- `HUMAN_REJECTED`
- `CHANGES_REQUESTED`

No value on one axis implies a value on the other.

## Session outbox boundary

The extension appends custom entries with:

- custom type `hpi-candidate-outbox`;
- schema `hpi/session-outbox/v2`; integrity binds the complete candidate digest to its receipt;
- authority `SESSION_ONLY_NOT_PROJECT_CANONICAL`;
- transport status `PENDING_CANONICAL_WRITER`.

The outbox preserves valid candidate receipts across resume. Recovery validates the complete envelope, canonical UTC timestamps, adapter version, candidate id, full candidate digest, allowed fields, and the receipt-plus-candidate hash. Same event id with divergent candidate digests yields deterministic `CANDIDATE_IDENTITY_CONFLICT` and restores neither candidate; one malformed entry is quarantined without discarding unrelated valid entries. It does not participate in HPS projection and cannot establish HumanResult. Source digest drift marks previous candidates `STALE`.

## R-ICL v4 invariant

The Adapter reads only the declared current/worklog boundary. Each declared authority input must resolve inside the project root, be a regular non-symlink file, and stay within the per-file size limit. It must not invoke R-ICL generators, gates, tests, Git writes, or append commands; it must not use drafts, raw work products, or Wiki as current authority. Until typed Handoff/Result/Evidence records exist in the declared authority set and a validation-only intake is connected, the machine axis remains `INCOMPLETE` and no human decision is fabricated.

## TS-001 pilot invariant

The current authoritative contract says `test_status: NOT-RUN`. Therefore:

- `117/117 tests passed`, `hash verified`, or equivalent Agent prose is at most `SELF_REPORTED`;
- the Machine Result remains `NOT-RUN`;
- the valid human question is whether to accept the baseline-first design route;
- a local validation-runtime-v1 PASS may prove only its declared five-Gate attempt and must be displayed beside formal `NOT-RUN`;
- no HPI output may imply formal TS-001, independent Validation Agent, P0 MVP acceptance, canonical intake, scientific support, or clinical conclusion.
