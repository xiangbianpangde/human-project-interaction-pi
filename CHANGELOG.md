# Changelog

## 0.6.0 - 2026-08-31

- Freeze `hpi/wire/validation-runtime/v1` for closed ValidationAttemptInput/Record objects, with exact interaction-v1 and execution-v2 dependencies and schema-set digest `598e1ca92f6cedeb97e2e00a4c22703ca5359977c3bd9681a015231fa692d3fa`.
- Add one explicit-manifest intake and five local Gates: schema, closed TS-001 identity, bounded raw-byte reference hashes, isolated workspace/network denial, and fixed machine-only authority.
- Add the append-only `.pi/artifacts/hpi-validation/v1/<attempt_id>` store with exclusive attempt locks, immutable content revisions, fsync + atomic rename, strict record/result resolution, and one-Gate-one-fact PASS binding.
- Implement `DECLARED → ACCEPTED → RUNNING → TERMINAL`, exact terminal replay without append, deterministic same-ID divergent-input conflict, new-ID retry with exact prior-latest binding, and no non-terminal automatic resume.
- Add true fresh-process interruption and crash-lock recovery tests; stale locks are never reclaimed automatically and `/reload` is not used as restart proof.
- Add validation-only MachineResult → restricted HPS/Human Brief projection and the `hpi_validation` preview/run/status tool; preview is zero-write, run cannot write outside the isolated attempt store, and current-source drift projects a historical local PASS as INCOMPLETE without mutating history.
- Keep formal TS-001 `NOT-RUN`; do not add an independent Validation Agent, Agent dispatch, HumanResult/CandidateEvent intake, canonical writer, automatic invalidation, generalized Reconciler, or project transaction authority.
- Record that the 0.5.0 read-only baseline was independently reviewed as RELEASE and merged to `main`; the 0.6.0 candidate still requires its own independent review and CI.

## 0.5.0 - 2026-08-31

- Preserve every `hpi/wire/execution/v1` byte and publish `hpi/wire/execution/v2` after an independent review blocked the 0.4 baseline; pin both interaction v1 and execution v1 digests in the v2 manifest.
- Close erroneous PASS paths by matching Task/Evidence frozen identities as `id + revision + sha256`, rejecting duplicate Evidence/fact ids, requiring every Evidence `claim_refs` to name its exact fact, and making verdict derivation and MachineResult validation share one non-empty, structurally valid, uniquely identified, all-VERIFIED fact-set contract.
- Make Result replay classification ledger-wide and order-independent; pre-existing same-key or same-ID divergent revisions fail closed before candidate classification.
- Require projector-owned `requestId + requestDigest + sourceDigest` binding before any human escalation; regex inspection remains defence-in-depth only.
- Publish session outbox v2, bind each full candidate digest into its receipt, validate exact envelopes, quarantine malformed entries, and reject same-event-id divergent candidate digests deterministically instead of choosing by session order.
- Reject duplicate normalized Pain/Design/Task/Result/Request ids before Brief and Trace construction.
- Use strict RFC3339 execution timestamps and host-independent POSIX scoped paths; add Windows contract cases.
- Bound Adapter authority reads to in-root regular non-symlink files of at most 2 MiB.
- Add pinned-action GitHub CI for the Pi-compatible Node 22.19 floor/current Node 22 and Windows execution-contract tests; pin Pi 0.84.2 exactly and enforce LF checkout so frozen schema hashes are host-independent.
- Keep TS-001 `NOT-RUN`, runtime intake, Result commit, full Reconciler, HumanResult intake, and canonical writing unchanged and unimplemented.

## 0.4.0 - 2026-08-30

- Freeze independent `hpi/wire/execution/v1` schemas for TaskSlice, HandoffBundle, Attempt, Evidence, ResultBundle, and StaleReport without changing `hpi/wire/v1` bytes or digest.
- Pin the execution set's schema hashes, complete digest, and exact dependency on `hpi/wire/v1` in a separate manifest and compiled trust anchor.
- Add explicit camelCase → snake_case execution codecs plus immutable content-revision checks and cross-object task/attempt/evidence binding.
- Add side-effect-free ResultBundle replay/conflict classification, retry-as-new-attempt creation, and conservative `STALE` / `NEEDS_REVIEW` propagation preview.
- Add strict positive/negative fixtures, dependency/schema tamper tests, and Extension exposure of both schema-set digests.
- Keep execution runtime intake, Agent dispatch, event append, Result commit, full Reconciler, HumanResult intake, and canonical writing unimplemented.

## 0.3.0 - 2026-08-30

- Freeze `hpi/wire/v1` as JSON Schema 2020-12 for HPS, MachineResult, HumanResult, HumanBrief, EscalationRequest, and TraceLink.
- Make external property names snake_case-only while preserving the camelCase runtime through explicit one-way codecs; reject mixed keys.
- Pin every schema SHA and the complete schema-set digest in `schemas/manifest.v1.json` and a compiled trust anchor.
- Fail HPI projection/query startup closed when the wire schema set is missing or has drifted.
- Add synthetic positive/negative fixtures, strict Ajv compilation, enum parity, codec interop, and tamper tests.
- Add read-only `hpi_query(op="wire")` and `/hpi wire [id]` exports without starting an Agent turn.
- Keep inbound HumanResult/canonical writing explicitly unimplemented.

## 0.2.0 - 2026-08-30

- Add the Adapter contract and registry plus `ricl-v4-readonly/0.1.0`.
- Preserve non-PASS authoritative machine verdicts even when claims or isolated verified facts say PASS.
- Bind every normalized source digest to the Adapter id and canonical source snapshot.
- Make project title/brief presentation Adapter-neutral.
- Respect `PI_CODING_AGENT_DIR` and remove Homebrew-specific loader imports from tests.
- Add the FR-001～FR-024 implementation/evidence/gap matrix and explicit real R-ICL integration test.
- Keep path-heavy R-ICL HEAD provenance out of the L0 headline while retaining it in verified evidence and L3; expose the independent Human Brief content id in `/talk` metadata.
- Correct the PRD HULA citation from `[E12]` to `[E09]`.

## 0.1.0 - 2026-08-30

- Freeze the TS-001 read-only pilot slice.
- Add deterministic HPS/Human Brief projection, dual-axis statuses, escalation Gate, session CandidateEvent outbox, Pi Extension, governed Skill, and `hpi-project` `/talk` style.
- Keep TS-001 engineering status `NOT-RUN`; do not implement canonical writes or the full multi-Agent runtime.
