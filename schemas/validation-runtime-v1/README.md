# HPI Validation Runtime Wire v1

`hpi/wire/validation-runtime/v1` is the frozen external contract for the first isolated machine-validation attempt runtime.

Schema-set digest:

```text
598e1ca92f6cedeb97e2e00a4c22703ca5359977c3bd9681a015231fa692d3fa
```

Dependencies:

- `hpi/wire/v1 @ 1d08d1acdda0cf05b29aae46949c900e49349eb21225d75698c6a44c34264725`
- `hpi/wire/execution/v2 @ bccb373985dacfdff8eaa1c2f7001cb4644a1d4c931e5359ce4200f69836439c`

This set adds exactly two wire objects plus common definitions:

- `hpi/wire/validation-attempt-input/v1`
- `hpi/wire/validation-attempt-record/v1`

Unlike the historical interaction/execution sets, this set permits a narrowly bounded inbound runtime for **ValidationAttemptInput only**. It does not enable ResultBundle intake, CandidateEvent intake, HumanResult intake, Agent dispatch or canonical writing.

The schema expresses closed snake_case shape. Companion validation under `src/validation-runtime/` additionally enforces:

- exact current schema-set identities;
- fixed MACHINE_VALIDATION_ONLY authority;
- complete frozen refs, canonical array ordering, and pointer/read-set equality;
- raw file SHA resolution inside the project root;
- exact isolated write root;
- immutable input/record revisions;
- contiguous lifecycle, canonical five-Gate order, phase semantics and previous-record linkage;
- terminal MachineResult scope/verdict plus exactly one Gate-bound fact per Gate, with success code/evidence and fact kind/statement/evidence/limitations exactly equal to the shared canonical derivation;
- current Gate re-evaluation before a persisted historical PASS can remain current;
- runtime `0.2.0` binding of `ROOT_DERIVED_DIRECTORY_CAPABILITY_V1` into the companion `input_digest`, without changing frozen schema bytes;
- root-derived cwd-capability publication that never follows a substituted path, atomic hard-link no-replace, temp↔target object-identity proof, and descriptor-bound private persisted-file checks outside the frozen wire shape;
- an explicit limitation: hostile same-UID relocation of an already acquired inode is external namespace mutation, not a continuous-pathname confinement guarantee, and detection must fail closed;
- exact replay versus divergent identity conflict;
- interrupted-attempt and retry-as-new-attempt behavior.

JSON Schema validity alone is not runtime acceptance.

This runtime is not formal TS-001 execution. It cannot change `TS1-TEST-001.test_status`, which remains `NOT-RUN` until a later authorized milestone with an independent Validation Agent.
