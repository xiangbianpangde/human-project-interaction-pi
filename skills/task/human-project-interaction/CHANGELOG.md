# Changelog

## 0.5.0 - 2026-08-31

- Require the preserved execution-v1 → current execution-v2 schema lineage during project re-entry.
- Require all human escalation proposals to bind a current projector-owned request id, request digest, and source digest; free-form model prose cannot mint a human question.
- Preserve machine-fact regex detection only as defence-in-depth and keep untrusted/tampered requests non-human.
- Restore only session-outbox v2 entries whose exact envelope, candidate digest, and receipt binding verify; quarantine malformed entries independently and reject same-event-id divergent candidate content deterministically.
- Require PASS verdict derivation and MachineResult validation to share a non-empty, structurally valid, uniquely identified, all-VERIFIED fact-set contract, and bind each referenced Evidence `claim_refs` to the exact fact id.
- Report execution v2 metadata without implying Bundle intake, Result commit, HumanResult, or canonical mutation.

## 0.4.0 - 2026-08-30

- Require both immutable `hpi/wire/v1` and dependent `hpi/wire/execution/v1` digests during supported project re-entry.
- Expose execution contract metadata without inferring Bundle records from source prose.
- Keep Result replay, retry, and stale outputs candidate/preview-only; they cannot dispatch, commit, invalidate canonical state, or create HumanResult.
- Preserve the R-ICL `INCOMPLETE` boundary while its authority set has no typed execution records and runtime intake is unavailable.

## 0.3.0 - 2026-08-30

- Require the frozen `hpi/wire/v1` schema set and pinned digest before rebuilding a supported projection.
- Define snake_case-only external interoperability and reject mixed external/internal keys.
- Add read-only `/hpi wire [id]` export without starting an Agent turn.
- Keep camelCase internal and HumanResult intake/canonical writing unavailable.

## 0.2.0 - 2026-08-30

- Add explicit supported-Adapter detection and fail-closed behavior for unsupported roots.
- Add the R-ICL v4 read-only Adapter while preserving TS-001 as a frozen pilot.
- Prevent source PASS prose or isolated evidence from promoting the machine axis.
- Require Adapter/source-snapshot digest integrity before rendering a Human Brief.
- Distinguish source, HPS projection, and Human Brief content ids in `/talk` provenance.

## 0.1.0 - 2026-08-30

- Add the task-layer Human Project Interaction workflow.
- Separate machine evidence from human intent, scope, design, risk, and semantic decisions.
- Integrate deterministic `hpi_query` / `hpi_propose` tools with the `hpi-project` `/talk` style.
- Define session-only CandidateEvent handling, stale detection, and TS-001 NOT-RUN protection.
