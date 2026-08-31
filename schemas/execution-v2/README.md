# HPI execution wire contract v2

`hpi/wire/execution/v2` supersedes—but does not modify—frozen `hpi/wire/execution/v1`.
The v1 directory, schema bytes, fixtures, manifest, and digest remain available for historical verification.

## Why v2 exists

An independent review of the private 0.4.0 baseline found that v1's `scoped_path` schema admitted Windows drive, UNC, and backslash traversal forms even though the runtime intended a host-independent project-relative path. Because v1 is immutable, that contract correction requires a new set id rather than an in-place schema edit.

v2 also makes these executable semantic gates normative:

- Task/Evidence references compare the full frozen identity: `id + revision + sha256`.
- Every MachineResult Evidence ref must resolve to exactly one carried Evidence revision.
- A `PASS-ENGINEERING` VERIFIED fact must directly reference `HARNESS_VERIFIED` or `INDEPENDENTLY_VALIDATED` Evidence; unrelated high-trust Evidence cannot confer PASS.
- Duplicate logical Evidence ids inside one ResultBundle are rejected as ambiguous.
- Result idempotency checks the complete existing ledger before replay classification; pre-existing same-key divergent revisions fail closed independent of input order.
- Timestamps accepted by codecs are strict RFC3339 date-times with explicit timezones.
- Scoped paths use POSIX-style project-relative syntax and reject backslashes, drive/UNC roots, control characters, empty segments, and `.` / `..` segments.

Cross-record equality cannot be fully expressed in JSON Schema; `src/execution/` is the deterministic companion validator. A v2 object is not accepted merely because Ajv validates its shape.

## Dependency and authority boundary

The v2 manifest pins both ancestors:

1. `hpi/wire/v1` interaction contract;
2. `hpi/wire/execution/v1` superseded execution contract.

Runtime intake remains `not_implemented`. ResultBundle authority remains `CANDIDATE_ONLY_NOT_PROJECT_CANONICAL`; StaleReport remains `PREVIEW_ONLY`. No schema or helper dispatches an Agent, appends an event, commits a Result, creates HumanResult, automatically invalidates a record, or writes project canonical state.

## Attempt / Result ordering

Successful submission remains acyclic:

1. freeze a `RUNNING` Attempt revision;
2. create ResultBundle referencing that snapshot;
3. create a later `SUCCEEDED` revision of the same `attempt_id` with `supersedes` and `terminal_result_ref`.

`retry_of` always targets a different, failed terminal attempt id.

## Verification

Current v2 fixtures live under `tests/fixtures/execution-wire-contract-v2/`. Historical v1 fixtures remain under `tests/fixtures/execution-wire-contract/`.

```bash
npm run test:execution-wire
npm run verify
```
