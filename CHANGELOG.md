# Changelog

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
