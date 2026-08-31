import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  HUMAN_CATEGORIES,
  HUMAN_DECISIONS,
  HUMAN_STATUSES,
  MACHINE_VERDICTS,
  TRACE_RELATIONS,
} from "../src/contracts.mjs";
import { rebuildTs001Projection } from "../src/projector.mjs";
import {
  WIRE_OBJECT_SCHEMAS,
  toWireEscalationRequest,
  toWireHps,
  toWireHumanBrief,
  toWireHumanResult,
  toWireMachineResult,
  toWireTraceLink,
} from "../src/wire.mjs";
import {
  WIRE_NAMING,
  WIRE_SCHEMA_SET,
  WIRE_SCHEMA_SET_DIGEST,
  loadWireSchemaSet,
} from "../src/wire-schema.mjs";

const packageRoot = decodeURIComponent(new URL("..", import.meta.url).pathname);
const fixturesRoot = new URL("./fixtures/wire-contract/", import.meta.url);
const validFixtures = JSON.parse(readFileSync(new URL("valid.json", fixturesRoot), "utf8"));
const invalidFixtures = JSON.parse(readFileSync(new URL("invalid.json", fixturesRoot), "utf8"));

function createAjv(schemaSet) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const schema of schemaSet.schemas) ajv.addSchema(schema);
  return ajv;
}

function schemaEnums(schemaSet) {
  const common = schemaSet.schemas.find((schema) => schema.$id === "urn:hpi:wire:common:v1");
  assert.ok(common, "common wire schema must be registered");
  return common.$defs;
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

function validateFixture(ajv, name, instance) {
  const schemaId = WIRE_OBJECT_SCHEMAS[name];
  assert.ok(schemaId, `unknown fixture schema ${name}`);
  const validate = ajv.getSchema(schemaId);
  assert.ok(validate, `missing compiled schema ${schemaId}`);
  return { valid: validate(instance), errors: validate.errors ?? [] };
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

describe("frozen HPI external wire schema set", () => {
  it("loads the complete v1 set and verifies every schema hash", () => {
    const schemaSet = loadWireSchemaSet();
    assert.equal(schemaSet.schemaSet, WIRE_SCHEMA_SET);
    assert.equal(schemaSet.naming, WIRE_NAMING);
    assert.equal(schemaSet.schemaSetDigest, WIRE_SCHEMA_SET_DIGEST);
    assert.equal(schemaSet.schemas.length, 7);
    assert.deepEqual(
      schemaSet.schemas.map((schema) => schema.$id).sort(),
      [
        "urn:hpi:wire:common:v1",
        "urn:hpi:wire:escalation-request:v1",
        "urn:hpi:wire:hps:v1",
        "urn:hpi:wire:human-brief:v1",
        "urn:hpi:wire:human-result:v1",
        "urn:hpi:wire:machine-result:v1",
        "urn:hpi:wire:trace-link:v1",
      ],
    );
  });

  it("fails closed when a schema byte differs from the frozen manifest", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "hpi-wire-schema-"));
    const copiedSchemas = join(temporaryRoot, "schemas");
    cpSync(fileURLToPath(new URL("../schemas/", import.meta.url)), copiedSchemas, { recursive: true });
    try {
      appendFileSync(join(copiedSchemas, "hps.v1.schema.json"), "\n", "utf8");
      assert.throws(() => loadWireSchemaSet({ root: copiedSchemas }), /hash differs from the frozen manifest/);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps closed wire enums identical to the executable internal contract", () => {
    const defs = schemaEnums(loadWireSchemaSet());
    assert.deepEqual(defs.machine_verdict.enum, [...MACHINE_VERDICTS]);
    assert.deepEqual(defs.human_status.enum, [...HUMAN_STATUSES]);
    assert.deepEqual(defs.human_category.enum, [...HUMAN_CATEGORIES]);
    assert.deepEqual(defs.human_decision.enum, [...HUMAN_DECISIONS]);
    assert.deepEqual(defs.trace_relation.enum, [...TRACE_RELATIONS]);
  });

  it("compiles all schemas in strict JSON Schema 2020-12 mode", () => {
    const schemaSet = loadWireSchemaSet();
    const ajv = createAjv(schemaSet);
    for (const schema of schemaSet.schemas) {
      assert.ok(ajv.getSchema(schema.$id), `schema did not compile: ${schema.$id}`);
    }
  });

  it("accepts the static positive fixtures and rejects camelCase anywhere on wire", () => {
    const ajv = createAjv(loadWireSchemaSet());
    assert.equal(validFixtures.schema_set, WIRE_SCHEMA_SET);
    assert.equal(validFixtures.fixture_authority, "SYNTHETIC_TEST_ONLY_NOT_PROJECT_CANONICAL");
    for (const [name, instance] of Object.entries(validFixtures.instances)) {
      assertSnakeCaseKeys(instance, `fixtures.${name}`);
      const result = validateFixture(ajv, name, instance);
      assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
    }
  });

  it("rejects every static negative fixture for the declared reason", () => {
    const ajv = createAjv(loadWireSchemaSet());
    assert.equal(invalidFixtures.schema_set, WIRE_SCHEMA_SET);
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

describe("camelCase runtime → snake_case wire codecs", () => {
  it("exports all currently projected interaction objects without mutating the projection", () => {
    const projection = rebuildTs001Projection(packageRoot);
    const before = structuredClone(projection);
    const schemaSet = loadWireSchemaSet();
    const ajv = createAjv(schemaSet);

    const objects = {
      hps: toWireHps(projection.hps),
      human_brief: toWireHumanBrief(projection.briefs[0]),
      machine_result: toWireMachineResult(projection.machineResults[0]),
      escalation_request: toWireEscalationRequest(projection.escalationRequests[0]),
      trace_link: toWireTraceLink(projection.traces[0]),
    };

    for (const [name, instance] of Object.entries(objects)) {
      assertSnakeCaseKeys(instance, `codec.${name}`);
      const result = validateFixture(ajv, name, instance);
      assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.errors)}`);
    }
    assert.deepEqual(projection, before);
  });

  it("exports HumanResult only as explicit human data and never as a machine verdict", () => {
    const projection = rebuildTs001Projection(packageRoot);
    const request = projection.escalationRequests[0];
    const internal = {
      schema: "hpi/human-result/v1",
      humanResultId: "HR-TS001-DESIGN-001",
      requestId: request.requestId,
      sourceRef: request.affectedRefs[0],
      decision: "ACCEPT_WITH_CONDITIONS",
      optionId: request.options[0].optionId,
      statement: "接受 baseline-first 设计路线；不把它解释为测试通过。",
      conditions: ["TS-001 机器状态保持 NOT-RUN。"],
      affectedRefs: request.affectedRefs,
      actor: { kind: "human", id: "project-owner" },
      capturedAt: "2026-08-30T00:00:00.000Z",
    };
    const wire = toWireHumanResult(internal);
    assertSnakeCaseKeys(wire, "codec.human_result");
    assert.equal("verdict" in wire, false);
    assert.equal(wire.explicitness, "explicit");
    const result = validateFixture(createAjv(loadWireSchemaSet()), "human_result", wire);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });
});
