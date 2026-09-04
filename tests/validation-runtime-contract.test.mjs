import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { sha256 } from "../src/contracts.mjs";
import { frozenIdentityKey, sealRecord } from "../src/execution/contract.mjs";
import {
  VALIDATION_ATTEMPT_INPUT_SCHEMA,
  VALIDATION_ATTEMPT_RECORD_SCHEMA,
  VALIDATION_AUTHORITY,
  VALIDATION_GATES,
  VALIDATION_RUNTIME_VERSION,
  VALIDATION_STORE_PREFIX,
  VALIDATION_STORE_SECURITY_MODEL,
  computeValidationInputDigest,
  sha256Bytes,
  validateValidationRecordChain,
  validationScopedPath,
} from "../src/validation-runtime/contract.mjs";
import {
  fromWireValidationAttemptInput,
  fromWireValidationAttemptRecord,
  toWireValidationAttemptRecord,
} from "../src/validation-runtime/codecs.mjs";
import {
  EXECUTION_WIRE_SCHEMA_SET,
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
  loadExecutionWireSchemaSet,
  loadExecutionWireSchemaSetV1,
  loadValidationRuntimeWireSchemaSet,
  loadWireSchemaSet,
} from "../src/wire-schema.mjs";
import { buildValidationAttemptFixture } from "./support/validation-runtime-fixture.mjs";

function temporaryRoot() {
  return mkdtempSync(join(tmpdir(), "hpi-validation-contract-"));
}

function createAjv() {
  const interaction = loadWireSchemaSet();
  const executionV1 = loadExecutionWireSchemaSetV1();
  const execution = loadExecutionWireSchemaSet();
  const validation = loadValidationRuntimeWireSchemaSet();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const schema of [
    ...interaction.schemas,
    ...executionV1.schemas,
    ...execution.schemas,
    ...validation.schemas,
  ]) {
    ajv.addSchema(schema);
  }
  return ajv;
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

function runtimeIdentity() {
  return {
    runtimeId: "hpi-validation-runtime",
    runtimeVersion: VALIDATION_RUNTIME_VERSION.split("/").at(-1),
    schemaSet: VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
    schemaSetDigest: VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
  };
}

function inputSnapshotRef(root, fixture) {
  const digest = sha256Bytes(readFileSync(fixture.manifestPath));
  return {
    id: fixture.wire.validation_attempt_id,
    revision: fixture.wire.input_revision,
    sha256: digest,
    pointer: `${fixture.wire.isolated_write_root}/input/manifest-${digest}.json`,
  };
}

function gateOutcomes(phase, outcome, inputRef) {
  return VALIDATION_GATES.map((gate, index) => {
    let status = "PASSED";
    if (phase === "DECLARED" && index > 0) status = "NOT_RUN";
    if (phase === "TERMINAL" && outcome === "INPUT_REJECTED") {
      status = index === 0 ? "FAILED" : "NOT_RUN";
    }
    return {
      gate,
      status,
      code: status === "PASSED" ? "TEST_PASSED" : status === "FAILED" ? "TEST_FAILED" : "NOT_RUN",
      evidenceRefs: status === "NOT_RUN" ? [] : [inputRef],
    };
  });
}

function recordDraft({ fixture, inputRef, sequence, phase, outcome = "NONE", previousRecordRef }) {
  return {
    schema: VALIDATION_ATTEMPT_RECORD_SCHEMA,
    recordId: `VRR-${fixture.wire.validation_attempt_id}-${sequence}`,
    recordRevision: "0".repeat(64),
    validationAttemptId: fixture.wire.validation_attempt_id,
    sequence,
    phase,
    outcome,
    inputRef,
    runtime: runtimeIdentity(),
    authority: VALIDATION_AUTHORITY,
    gateOutcomes: gateOutcomes(phase, outcome, inputRef),
    ...(previousRecordRef === undefined ? {} : { previousRecordRef }),
    recordedAt: `2026-08-31T12:00:0${sequence}Z`,
  };
}

function refForRecord(record) {
  return {
    id: record.recordId,
    revision: record.recordRevision,
    sha256: record.recordRevision,
    pointer: `${VALIDATION_STORE_PREFIX}/${record.validationAttemptId}/records/${String(record.sequence).padStart(6, "0")}-${record.recordRevision}.json`,
  };
}

describe("validation-runtime-v1 frozen schema and codecs", () => {
  it("loads and strictly compiles the validation set on top of frozen interaction/execution sets", () => {
    const validation = loadValidationRuntimeWireSchemaSet();
    assert.equal(validation.schemaSet, VALIDATION_RUNTIME_WIRE_SCHEMA_SET);
    assert.equal(validation.schemaSetDigest, VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST);
    assert.equal(validation.schemas.length, 3);
    assert.deepEqual(validation.dependencies.map((entry) => entry.schema_set), [
      "hpi/wire/v1",
      EXECUTION_WIRE_SCHEMA_SET,
    ]);
    const ajv = createAjv();
    assert.ok(ajv.getSchema("urn:hpi:wire:validation-attempt-input:v1"));
    assert.ok(ajv.getSchema("urn:hpi:wire:validation-attempt-record:v1"));
  });

  it("fails closed on validation schema-byte drift", () => {
    const root = temporaryRoot();
    const schemas = join(root, "validation-runtime-v1");
    cpSync(fileURLToPath(new URL("../schemas/validation-runtime-v1/", import.meta.url)), schemas, {
      recursive: true,
    });
    try {
      appendFileSync(join(schemas, "validation-attempt-record.v1.schema.json"), "\n", "utf8");
      assert.throws(
        () => loadValidationRuntimeWireSchemaSet({ root: schemas }),
        /hash differs from the frozen manifest/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("seals a snake_case manifest and round-trips its complete immutable identity", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root);
      assertSnakeCaseKeys(fixture.wire);
      const validate = createAjv().getSchema("urn:hpi:wire:validation-attempt-input:v1");
      assert.equal(validate(fixture.wire), true, JSON.stringify(validate.errors));
      const parsed = fromWireValidationAttemptInput(fixture.wire);
      assert.equal(VALIDATION_STORE_SECURITY_MODEL, "ROOT_DERIVED_DIRECTORY_CAPABILITY_V1");
      assert.equal(parsed.internal.schema, VALIDATION_ATTEMPT_INPUT_SCHEMA);
      assert.equal(parsed.internal.inputRevision, fixture.wire.input_revision);
      assert.equal(parsed.internal.isolatedWriteRoot, ".pi/artifacts/hpi-validation/v1/VRS1-TEST-001");
      assert.deepEqual(parsed.wire, fixture.wire);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects host-dependent paths and unresolved retry identities", () => {
    for (const pointer of ["/absolute/file", "C:/drive/file", "\\\\server\\share", "a\\b", "a/../b", "./a"]) {
      assert.throws(() => validationScopedPath(pointer), /host-independent|must not contain/u, pointer);
    }
    const root = temporaryRoot();
    try {
      assert.throws(
        () => buildValidationAttemptFixture(root, {
          attemptId: "VRS1-BAD-RETRY",
          retryOf: {
            id: "VRR-OLD-2",
            revision: "a".repeat(64),
            sha256: "a".repeat(64),
          },
        }),
        /retryOf.*pointer/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("binds the directory-capability security model into input identity", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root);
      const input = fromWireValidationAttemptInput(fixture.wire).internal;
      const legacyDigest = sha256({
        schema: VALIDATION_ATTEMPT_INPUT_SCHEMA,
        validationAttemptId: input.validationAttemptId,
        attemptFamily: input.attemptFamily,
        projectId: input.projectId,
        adapter: input.adapter,
        taskRef: input.taskRef,
        contractRefs: input.contractRefs,
        inputRefs: input.inputRefs,
        declaredReadSet: input.declaredReadSet,
        isolatedWriteRoot: input.isolatedWriteRoot,
        executionContract: input.executionContract,
        validationContract: input.validationContract,
        authority: input.authority,
      });
      assert.notEqual(legacyDigest, fixture.wire.input_digest);
      const legacyWire = structuredClone(fixture.wire);
      legacyWire.input_digest = legacyDigest;
      delete legacyWire.input_revision;
      const resealed = sealRecord(legacyWire, "input_revision");
      assert.throws(
        () => fromWireValidationAttemptInput(resealed),
        /inputDigest.*does not match/u,
      );

      const legacyRecord = recordDraft({
        fixture,
        inputRef: inputSnapshotRef(root, fixture),
        sequence: 0,
        phase: "DECLARED",
      });
      legacyRecord.runtime.runtimeVersion = "0.1.0";
      assert.throws(
        () => toWireValidationAttemptRecord(legacyRecord),
        /runtimeVersion.*0\.2\.0/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects reordered and resealed manifest or Gate evidence arrays", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root);
      const parsedInput = fromWireValidationAttemptInput(fixture.wire).internal;
      const reorderedInput = {
        ...parsedInput,
        declaredReadSet: parsedInput.declaredReadSet.toReversed(),
      };
      const reorderedWire = structuredClone(fixture.wire);
      reorderedWire.declared_read_set.reverse();
      reorderedWire.input_digest = computeValidationInputDigest(reorderedInput);
      delete reorderedWire.input_revision;
      const resealedInput = sealRecord(reorderedWire, "input_revision");
      assert.throws(
        () => fromWireValidationAttemptInput(resealedInput),
        /declaredReadSet.*canonical pointer order/u,
      );

      const inputRef = inputSnapshotRef(root, fixture);
      const declared = fromWireValidationAttemptRecord(toWireValidationAttemptRecord(
        recordDraft({ fixture, inputRef, sequence: 0, phase: "DECLARED" }),
      )).internal;
      const acceptedDraft = recordDraft({
        fixture,
        inputRef,
        sequence: 1,
        phase: "ACCEPTED",
        previousRecordRef: refForRecord(declared),
      });
      acceptedDraft.gateOutcomes[1].evidenceRefs = [
        fixture.taskRef,
        ...fixture.contractRefs,
        ...fixture.inputRefs,
      ].toSorted((left, right) =>
        frozenIdentityKey(left).localeCompare(frozenIdentityKey(right)),
      );
      const acceptedWire = toWireValidationAttemptRecord(acceptedDraft);
      acceptedWire.gate_outcomes[1].evidence_refs.reverse();
      delete acceptedWire.record_revision;
      const resealedRecord = sealRecord(acceptedWire, "record_revision");
      assert.throws(
        () => fromWireValidationAttemptRecord(resealedRecord),
        /evidenceRefs.*canonical frozen-identity order/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects extra wire keys and companion-only read-set/digest drift", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root);
      const camel = { ...fixture.wire, validationAttemptId: fixture.wire.validation_attempt_id };
      const schemaValidate = createAjv().getSchema("urn:hpi:wire:validation-attempt-input:v1");
      assert.equal(schemaValidate(camel), false);
      assert.throws(() => fromWireValidationAttemptInput(camel), /validationAttemptId.*not allowed/u);

      const changed = structuredClone(fixture.wire);
      changed.declared_read_set.pop();
      delete changed.input_revision;
      const resealed = sealRecord(changed, "input_revision");
      assert.throws(() => fromWireValidationAttemptInput(resealed), /declaredReadSet.*exactly equal/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("validation attempt state-chain contract", () => {
  it("accepts only contiguous declared → accepted → running → terminal history", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root);
      const inputRef = inputSnapshotRef(root, fixture);
      const firstWire = toWireValidationAttemptRecord(
        recordDraft({ fixture, inputRef, sequence: 0, phase: "DECLARED" }),
      );
      const recordSchema = createAjv().getSchema("urn:hpi:wire:validation-attempt-record:v1");
      assert.equal(recordSchema(firstWire), true, JSON.stringify(recordSchema.errors));
      const missingGate = structuredClone(firstWire);
      missingGate.gate_outcomes.pop();
      assert.equal(recordSchema(missingGate), false);
      const first = fromWireValidationAttemptRecord(firstWire).internal;
      const second = fromWireValidationAttemptRecord(toWireValidationAttemptRecord(recordDraft({
        fixture,
        inputRef,
        sequence: 1,
        phase: "ACCEPTED",
        previousRecordRef: refForRecord(first),
      }))).internal;
      const third = fromWireValidationAttemptRecord(toWireValidationAttemptRecord(recordDraft({
        fixture,
        inputRef,
        sequence: 2,
        phase: "RUNNING",
        previousRecordRef: refForRecord(second),
      }))).internal;
      const terminal = fromWireValidationAttemptRecord(toWireValidationAttemptRecord(recordDraft({
        fixture,
        inputRef,
        sequence: 3,
        phase: "TERMINAL",
        outcome: "INCOMPLETE_INTERRUPTED",
        previousRecordRef: refForRecord(third),
      }))).internal;
      assert.deepEqual(validateValidationRecordChain([terminal, second, first, third]), [
        first,
        second,
        third,
        terminal,
      ]);
      assert.equal(terminal.authority.projectCanonicalWrite, "FORBIDDEN");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects skipped phases, pointer-independent identity drift, and records after terminal", () => {
    const root = temporaryRoot();
    try {
      const fixture = buildValidationAttemptFixture(root);
      const inputRef = inputSnapshotRef(root, fixture);
      const first = fromWireValidationAttemptRecord(
        toWireValidationAttemptRecord(recordDraft({ fixture, inputRef, sequence: 0, phase: "DECLARED" })),
      ).internal;
      const running = fromWireValidationAttemptRecord(toWireValidationAttemptRecord(recordDraft({
        fixture,
        inputRef,
        sequence: 1,
        phase: "RUNNING",
        previousRecordRef: refForRecord(first),
      }))).internal;
      assert.throws(() => validateValidationRecordChain([first, running]), /invalid transition DECLARED->RUNNING/u);

      const terminal = fromWireValidationAttemptRecord(toWireValidationAttemptRecord(recordDraft({
        fixture,
        inputRef,
        sequence: 1,
        phase: "TERMINAL",
        outcome: "INPUT_REJECTED",
        previousRecordRef: refForRecord(first),
      }))).internal;
      const after = fromWireValidationAttemptRecord(toWireValidationAttemptRecord(recordDraft({
        fixture,
        inputRef,
        sequence: 2,
        phase: "RUNNING",
        previousRecordRef: refForRecord(terminal),
      }))).internal;
      assert.throws(() => validateValidationRecordChain([first, terminal, after]), /must not follow a terminal/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
