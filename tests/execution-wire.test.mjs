import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { sha256 } from "../src/contracts.mjs";
import {
  ATTEMPT_STATUSES,
  EVIDENCE_STATUSES,
  EXECUTION_AGENT_ROLES,
  EXECUTION_WIRE_OBJECT_SCHEMAS,
  assertWireRecordRevision,
  classifyResultSubmission,
  computeStaleReport,
  createRetryAttempt,
  toWireAttempt,
  toWireEvidence,
  toWireHandoffBundle,
  toWireResultBundle,
  toWireTaskSlice,
  wireRecordRef,
} from "../src/execution.mjs";
import {
  EXECUTION_WIRE_SCHEMA_SET,
  EXECUTION_WIRE_SCHEMA_SET_DIGEST,
  WIRE_SCHEMA_SET,
  WIRE_SCHEMA_SET_DIGEST,
  loadExecutionWireSchemaSet,
  loadWireSchemaSet,
} from "../src/wire-schema.mjs";
import { buildExecutionFixture } from "./support/execution-fixture.mjs";

const fixtureRoot = new URL("./fixtures/execution-wire-contract/", import.meta.url);
const validFixtures = JSON.parse(readFileSync(new URL("valid.json", fixtureRoot), "utf8"));
const invalidFixtures = JSON.parse(readFileSync(new URL("invalid.json", fixtureRoot), "utf8"));
const revisionKeys = Object.freeze({
  task_slice: "task_revision",
  handoff_bundle: "handoff_revision",
  attempt: "attempt_revision",
  evidence: "evidence_revision",
  result_bundle: "bundle_revision",
  stale_report: "report_revision",
});

function createAjv() {
  const interaction = loadWireSchemaSet();
  const execution = loadExecutionWireSchemaSet();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const schema of [...interaction.schemas, ...execution.schemas]) ajv.addSchema(schema);
  return ajv;
}

function validateFixture(ajv, name, instance) {
  const schemaId = EXECUTION_WIRE_OBJECT_SCHEMAS[name];
  assert.ok(schemaId, `unknown execution fixture schema ${name}`);
  const validate = ajv.getSchema(schemaId);
  assert.ok(validate, `missing compiled schema ${schemaId}`);
  return { valid: validate(instance), errors: validate.errors ?? [] };
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

function applyFixtureOperations(testCase) {
  const instance = structuredClone(validFixtures.instances[testCase.base]);
  for (const operation of testCase.operations) {
    const path = [...operation.path];
    const key = path.pop();
    let parent = instance;
    for (const segment of path) parent = parent[segment];
    if (operation.op === "delete") delete parent[key];
    else if (operation.op === "set") parent[key] = operation.value;
    else assert.fail(`unknown fixture operation ${operation.op}`);
  }
  return instance;
}

function reseal(record, revisionKey) {
  const copy = structuredClone(record);
  delete copy[revisionKey];
  copy[revisionKey] = sha256(copy);
  return copy;
}

describe("frozen HPI execution wire schema set", () => {
  it("loads independently without changing the frozen interaction v1 set", () => {
    const interaction = loadWireSchemaSet();
    const execution = loadExecutionWireSchemaSet();
    assert.equal(interaction.schemaSet, WIRE_SCHEMA_SET);
    assert.equal(interaction.schemaSetDigest, WIRE_SCHEMA_SET_DIGEST);
    assert.equal(interaction.schemas.length, 7);
    assert.equal(execution.schemaSet, EXECUTION_WIRE_SCHEMA_SET);
    assert.equal(execution.schemaSetDigest, EXECUTION_WIRE_SCHEMA_SET_DIGEST);
    assert.deepEqual(execution.dependencies, [
      { schema_set: WIRE_SCHEMA_SET, schema_set_digest: WIRE_SCHEMA_SET_DIGEST },
    ]);
    assert.deepEqual(
      execution.schemas.map((schema) => schema.$id).sort(),
      [
        "urn:hpi:wire:attempt:v1",
        "urn:hpi:wire:evidence:v1",
        "urn:hpi:wire:execution-common:v1",
        "urn:hpi:wire:handoff-bundle:v1",
        "urn:hpi:wire:result-bundle:v1",
        "urn:hpi:wire:stale-report:v1",
        "urn:hpi:wire:task-slice:v1",
      ],
    );
  });

  it("fails closed on schema-byte or dependency-digest drift", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "hpi-execution-wire-"));
    const copiedSchemas = join(temporaryRoot, "execution-v1");
    cpSync(fileURLToPath(new URL("../schemas/execution-v1/", import.meta.url)), copiedSchemas, {
      recursive: true,
    });
    try {
      appendFileSync(join(copiedSchemas, "evidence.v1.schema.json"), "\n", "utf8");
      assert.throws(
        () => loadExecutionWireSchemaSet({ root: copiedSchemas }),
        /hash differs from the frozen manifest/,
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }

    const dependencyRoot = mkdtempSync(join(tmpdir(), "hpi-execution-dependency-"));
    const copiedDependencySchemas = join(dependencyRoot, "execution-v1");
    cpSync(fileURLToPath(new URL("../schemas/execution-v1/", import.meta.url)), copiedDependencySchemas, {
      recursive: true,
    });
    try {
      const manifestPath = join(copiedDependencySchemas, "manifest.v1.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.dependencies[0].schema_set_digest = "0".repeat(64);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      assert.throws(
        () => loadExecutionWireSchemaSet({ root: copiedDependencySchemas }),
        /differs from the required frozen dependency/,
      );
    } finally {
      rmSync(dependencyRoot, { recursive: true, force: true });
    }
  });

  it("keeps executable enum constants equal to the execution common schema", () => {
    const execution = loadExecutionWireSchemaSet();
    const common = execution.schemas.find((schema) => schema.$id === "urn:hpi:wire:execution-common:v1");
    assert.ok(common);
    assert.deepEqual(common.$defs.agent.properties.role.enum, [...EXECUTION_AGENT_ROLES]);
    assert.deepEqual(common.$defs.attempt_status.enum, [...ATTEMPT_STATUSES]);
    assert.deepEqual(common.$defs.evidence_status.enum, [...EVIDENCE_STATUSES]);
  });

  it("strictly compiles all interaction and execution schemas together", () => {
    const ajv = createAjv();
    for (const schemaId of Object.values(EXECUTION_WIRE_OBJECT_SCHEMAS)) {
      assert.ok(ajv.getSchema(schemaId), `schema did not compile: ${schemaId}`);
    }
  });

  it("accepts static synthetic fixtures with valid immutable content revisions", () => {
    const ajv = createAjv();
    assert.equal(validFixtures.schema_set, EXECUTION_WIRE_SCHEMA_SET);
    assert.equal(validFixtures.fixture_authority, "SYNTHETIC_TEST_ONLY_NOT_PROJECT_CANONICAL");
    for (const [name, instance] of Object.entries(validFixtures.instances)) {
      assertSnakeCaseKeys(instance, `fixtures.${name}`);
      const result = validateFixture(ajv, name, instance);
      assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
      assertWireRecordRevision(instance, revisionKeys[name], `fixtures.${name}`);
    }
    assert.equal(validFixtures.instances.result_bundle.submission_authority, "CANDIDATE_ONLY_NOT_PROJECT_CANONICAL");
    assert.equal(validFixtures.instances.stale_report.reconciler_mode, "PREVIEW_ONLY");
    assert.equal(validFixtures.instances.stale_report.project_canonical_changed, false);
  });

  it("rejects every static negative fixture for its declared reason", () => {
    const ajv = createAjv();
    assert.equal(invalidFixtures.schema_set, EXECUTION_WIRE_SCHEMA_SET);
    assert.equal(invalidFixtures.fixture_authority, "SYNTHETIC_TEST_ONLY_NOT_PROJECT_CANONICAL");
    for (const testCase of invalidFixtures.cases) {
      const result = validateFixture(ajv, testCase.schema, applyFixtureOperations(testCase));
      assert.equal(result.valid, false, `${testCase.name} unexpectedly passed`);
      assert.ok(
        result.errors.some(
          (error) =>
            error.keyword === testCase.expected_keyword &&
            (!testCase.expected_path || error.instancePath === testCase.expected_path),
        ),
        `${testCase.name}: expected ${testCase.expected_keyword} at ${testCase.expected_path || "any path"}; got ${JSON.stringify(result.errors)}`,
      );
    }
  });
});

describe("execution wire codecs and cross-field gates", () => {
  it("rebuilds byte-equivalent static fixtures without mutating internal inputs", () => {
    const fixture = buildExecutionFixture();
    const before = structuredClone(fixture.inputs);
    assert.deepEqual(fixture.instances, validFixtures.instances);
    assert.deepEqual(fixture.inputs, before);
  });

  it("rejects identity, semantic-link, and permission overlap that JSON Schema cannot compare", () => {
    const { inputs } = buildExecutionFixture();
    assert.throws(
      () =>
        toWireTaskSlice({
          ...structuredClone(inputs.taskInput),
          assignedRoles: {
            implementation: inputs.taskInput.assignedRoles.implementation,
            validation: {
              ...inputs.taskInput.assignedRoles.validation,
              agentId: inputs.taskInput.assignedRoles.implementation.agentId,
            },
          },
        }),
      /different agent identities/,
    );
    assert.throws(
      () =>
        toWireTaskSlice({
          ...structuredClone(inputs.taskInput),
          painRefs: [],
          requirementRefs: [],
          designRefs: [],
        }),
      /at least one Pain, Requirement, or Design/,
    );
    assert.throws(
      () =>
        toWireHandoffBundle({
          ...structuredClone(inputs.handoffInput),
          permissionScope: {
            ...inputs.handoffInput.permissionScope,
            forbiddenPaths: [inputs.handoffInput.permissionScope.allowedPaths[0]],
          },
        }),
      /overlap/,
    );
    assert.throws(
      () =>
        toWireHandoffBundle({
          ...structuredClone(inputs.handoffInput),
          receiver: {
            ...inputs.handoffInput.receiver,
            agentId: inputs.handoffInput.sender.agentId,
          },
        }),
      /sender and receiver must use different agent identities/,
    );
  });

  it("requires independent Evidence to use a distinct Validation identity", () => {
    const { inputs } = buildExecutionFixture();
    const independent = {
      ...structuredClone(inputs.evidenceInput),
      status: "INDEPENDENTLY_VALIDATED",
      verifiedBy: [
        {
          agentId: inputs.evidenceInput.collectedBy.agentId,
          role: "VALIDATION",
          harnessRevision: "harness/fixture",
        },
      ],
    };
    assert.throws(() => toWireEvidence(independent), /must differ from the collecting agent/);
  });

  it("binds ResultBundle task, attempt, facts, and Evidence before allowing PASS", () => {
    const { inputs, refs } = buildExecutionFixture();
    const verifiedEvidence = toWireEvidence({
      ...structuredClone(inputs.evidenceInput),
      status: "HARNESS_VERIFIED",
      verifiedBy: [
        {
          agentId: "agent-validation",
          role: "VALIDATION",
          harnessRevision: "harness/fixture",
        },
      ],
    });
    const verifiedEvidenceRef = wireRecordRef(verifiedEvidence, {
      idKey: "evidence_id",
      revisionKey: "evidence_revision",
      pointer: "fixtures/evidence-verified.json",
    });
    const runningAttempt = toWireAttempt({
      ...structuredClone(inputs.attemptInput),
      status: "RUNNING",
      endedAt: undefined,
      failure: { kind: "NONE", summary: "", retryable: false },
    });
    const passMachineResult = {
      ...structuredClone(inputs.resultInput.machineResult),
      verdict: "PASS-ENGINEERING",
      facts: [
        {
          ...inputs.resultInput.machineResult.facts[0],
          status: "VERIFIED",
          evidenceRefs: [verifiedEvidenceRef],
        },
      ],
      limitations: [],
      unresolved: [],
    };
    const pass = toWireResultBundle({
      ...structuredClone(inputs.resultInput),
      attemptRecord: runningAttempt,
      machineResult: passMachineResult,
      evidenceRecords: [verifiedEvidence],
      failure: { kind: "NONE", summary: "", retryable: false },
      unresolved: [],
      nextAttempt: null,
    });
    const validation = validateFixture(createAjv(), "result_bundle", pass);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
    assert.equal(pass.attempt_ref.revision, runningAttempt.attempt_revision);

    const terminalAttempt = toWireAttempt({
      ...structuredClone(inputs.attemptInput),
      status: "SUCCEEDED",
      failure: { kind: "NONE", summary: "", retryable: false },
      terminalResultRef: wireRecordRef(pass, {
        idKey: "result_bundle_id",
        revisionKey: "bundle_revision",
      }),
      supersedes: wireRecordRef(runningAttempt, {
        idKey: "attempt_id",
        revisionKey: "attempt_revision",
      }),
      changedFields: ["status", "ended_at", "terminal_result_ref"],
    });
    assert.equal(terminalAttempt.supersedes.revision, runningAttempt.attempt_revision);
    assert.equal(terminalAttempt.terminal_result_ref.revision, pass.bundle_revision);
    assert.equal(validateFixture(createAjv(), "attempt", terminalAttempt).valid, true);

    assert.throws(
      () =>
        toWireResultBundle({
          ...structuredClone(inputs.resultInput),
          attemptRecord: runningAttempt,
          machineResult: passMachineResult,
          evidenceRecords: [inputs.resultInput.evidenceRecords[0]],
          failure: { kind: "NONE", summary: "", retryable: false },
          unresolved: [],
          nextAttempt: null,
        }),
      /must resolve to an Evidence record carried by the bundle|requires harness-verified/,
    );

    assert.throws(
      () =>
        toWireResultBundle({
          ...structuredClone(inputs.resultInput),
          machineResult: passMachineResult,
          evidenceRecords: [verifiedEvidence],
          failure: { kind: "NONE", summary: "", retryable: false },
          unresolved: [],
          nextAttempt: null,
        }),
      /must reference the frozen RUNNING snapshot/,
    );

    const wrongAttemptEvidence = toWireEvidence({
      ...structuredClone(inputs.evidenceInput),
      attemptId: "ATTEMPT-OTHER",
    });
    assert.throws(
      () =>
        toWireResultBundle({
          ...structuredClone(inputs.resultInput),
          evidenceRecords: [wrongAttemptEvidence],
        }),
      /must match attempt_ref.id/,
    );
    assert.equal(pass.task_ref.id, refs.taskRef.id);
  });
});

describe("revision, idempotency, retry, and stale propagation preview", () => {
  it("returns an existing ResultBundle replay and never creates a second commit", () => {
    const { records } = buildExecutionFixture();
    const fresh = classifyResultSubmission([], records.result);
    assert.equal(fresh.kind, "NEW_CANDIDATE");
    assert.equal(fresh.project_canonical_changed, false);

    const replay = classifyResultSubmission([records.result], structuredClone(records.result));
    assert.equal(replay.kind, "REPLAY_EXISTING");
    assert.equal(replay.second_commit_created, false);
    assert.equal(replay.project_canonical_changed, false);

    const changedReplay = structuredClone(records.result);
    changedReplay.submitted_at = "2026-08-30T01:13:01.000Z";
    const conflict = classifyResultSubmission(
      [records.result],
      reseal(changedReplay, "bundle_revision"),
    );
    assert.equal(conflict.kind, "IDEMPOTENCY_CONFLICT");
    assert.equal(conflict.second_commit_created, false);
    assert.equal(conflict.project_canonical_changed, false);
  });

  it("rejects forged content revisions and idempotency bindings", () => {
    const { records } = buildExecutionFixture();
    const forgedRevision = structuredClone(records.result);
    forgedRevision.bundle_revision = "0".repeat(64);
    assert.throws(
      () => classifyResultSubmission([], forgedRevision),
      /does not match the immutable record content/,
    );

    const forgedIdempotency = structuredClone(records.result);
    forgedIdempotency.idempotency_key = "0".repeat(64);
    assert.throws(
      () => classifyResultSubmission([], reseal(forgedIdempotency, "bundle_revision")),
      /must bind the frozen task, handoff, and attempt refs/,
    );
  });

  it("creates retry as a new attempt and leaves the failed attempt unchanged", () => {
    const fixture = buildExecutionFixture();
    const before = structuredClone(fixture.records.attempt);
    const result = createRetryAttempt(fixture.records.attempt, {
      attemptId: "ATTEMPT-FIXTURE-002",
      workspaceRef: fixture.refs.retryWorkspace,
      provenanceRefs: [fixture.refs.provenance],
      createdAt: "2026-08-30T02:00:00.000Z",
    });
    assert.equal(result.kind, "RETRY_CANDIDATE_CREATED");
    assert.equal(result.previous_attempt_unchanged, true);
    assert.equal(result.project_canonical_changed, false);
    assert.equal(result.attempt.attempt_id, "ATTEMPT-FIXTURE-002");
    assert.equal(result.attempt.ordinal, 2);
    assert.equal(result.attempt.status, "NOT_STARTED");
    assert.equal(result.attempt.retry_of.id, fixture.records.attempt.attempt_id);
    assert.equal(result.attempt.retry_of.revision, fixture.records.attempt.attempt_revision);
    assert.deepEqual(fixture.records.attempt, before);
    assertWireRecordRevision(result.attempt, "attempt_revision");
    const validation = validateFixture(createAjv(), "attempt", result.attempt);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));

    const running = toWireAttempt({
      ...structuredClone(fixture.inputs.attemptInput),
      status: "RUNNING",
      endedAt: undefined,
      failure: { kind: "NONE", summary: "", retryable: false },
    });
    assert.throws(
      () =>
        createRetryAttempt(running, {
          attemptId: "ATTEMPT-FIXTURE-003",
          workspaceRef: fixture.refs.retryWorkspace,
          provenanceRefs: [fixture.refs.provenance],
          createdAt: "2026-08-30T02:01:00.000Z",
        }),
      /retry requires FAILED, BLOCKED, INTERRUPTED, or CANCELLED/,
    );
  });

  it("propagates mechanical drift to STALE and semantic impact to NEEDS_REVIEW only", () => {
    const fixture = buildExecutionFixture();
    const forward = computeStaleReport(fixture.inputs.staleInput);
    const reverse = computeStaleReport({
      ...fixture.inputs.staleInput,
      dependents: [...fixture.inputs.staleInput.dependents].reverse(),
    });
    assert.equal(forward.kind, "STALE_REPORT_CREATED");
    assert.deepEqual(forward.report, reverse.report);
    assert.deepEqual(forward.report.effects.map((effect) => effect.disposition), ["STALE", "NEEDS_REVIEW"]);
    assert.ok(forward.report.effects.every((effect) => effect.automatic_invalidation === false));
    assert.equal(forward.report.reconciler_mode, "PREVIEW_ONLY");
    assert.equal(forward.report.project_canonical_changed, false);
    assertWireRecordRevision(forward.report, "report_revision");

    const noChange = computeStaleReport({
      ...fixture.inputs.staleInput,
      upstreamAfter: fixture.inputs.staleInput.upstreamBefore,
    });
    assert.deepEqual(noChange, {
      kind: "NO_REVISION_CHANGE",
      report: null,
      project_canonical_changed: false,
    });

    assert.throws(
      () =>
        computeStaleReport({
          ...fixture.inputs.staleInput,
          upstreamAfter: {
            ...fixture.inputs.staleInput.upstreamBefore,
            sha256: "9".repeat(64),
          },
        }),
      /integrity drift/,
    );
    assert.throws(
      () =>
        computeStaleReport({
          ...fixture.inputs.staleInput,
          upstreamAfter: {
            ...fixture.inputs.staleInput.upstreamAfter,
            id: "OTHER-UPSTREAM",
          },
        }),
      /share one logical upstream id/,
    );
  });
});
