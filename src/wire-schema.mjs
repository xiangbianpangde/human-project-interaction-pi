import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "./contracts.mjs";

export const WIRE_SCHEMA_SET = "hpi/wire/v1";
export const WIRE_NAMING = "snake_case";
export const WIRE_SCHEMA_SET_DIGEST = "1d08d1acdda0cf05b29aae46949c900e49349eb21225d75698c6a44c34264725";
export const EXECUTION_WIRE_SCHEMA_SET_V1 = "hpi/wire/execution/v1";
export const EXECUTION_WIRE_SCHEMA_SET_DIGEST_V1 = "450698c6e3218b3419f081dc47576f94edaea36ee0da6a97b35c80ef6d9e88d1";
export const EXECUTION_WIRE_SCHEMA_SET = "hpi/wire/execution/v2";
export const EXECUTION_WIRE_SCHEMA_SET_DIGEST = "bccb373985dacfdff8eaa1c2f7001cb4644a1d4c931e5359ce4200f69836439c";
export const VALIDATION_RUNTIME_WIRE_SCHEMA_SET = "hpi/wire/validation-runtime/v1";
export const VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST = "598e1ca92f6cedeb97e2e00a4c22703ca5359977c3bd9681a015231fa692d3fa";
export const ACCEPTANCE_WIRE_SCHEMA_SET = "hpi/wire/acceptance/v1";
export const ACCEPTANCE_WIRE_SCHEMA_SET_DIGEST = "ac709a3d740f371e46126f908eb96f4f8448ad0a28ba8d2c97b2ec7155a66378";

const INTERACTION_MANIFEST_NAME = "manifest.v1.json";
const EXECUTION_V1_MANIFEST_NAME = "manifest.v1.json";
const EXECUTION_MANIFEST_NAME = "manifest.v2.json";
const VALIDATION_RUNTIME_MANIFEST_NAME = "manifest.v1.json";
const ACCEPTANCE_MANIFEST_NAME = "manifest.v1.json";
const DRAFT = "https://json-schema.org/draft/2020-12/schema";

export class WireSchemaError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WireSchemaError";
    this.details = details;
  }
}

function exactKeys(value, allowed, required, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WireSchemaError(`${path} must be an object`);
  }
  for (const key of required) {
    if (!(key in value)) throw new WireSchemaError(`${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new WireSchemaError(`${path}.${key} is not allowed`);
  }
  return value;
}

function nonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WireSchemaError(`${path} must be a non-empty string`);
  }
  return value;
}

function schemaSetDigest(manifest) {
  return sha256({
    schema_set: manifest.schema_set,
    naming: manifest.naming,
    compatibility: manifest.compatibility,
    ...(manifest.dependencies === undefined ? {} : { dependencies: manifest.dependencies }),
    schemas: manifest.schemas,
  });
}

function defaultSchemaRoot() {
  return fileURLToPath(new URL("../schemas/", import.meta.url));
}

function defaultExecutionV1SchemaRoot() {
  return fileURLToPath(new URL("../schemas/execution-v1/", import.meta.url));
}

function defaultExecutionSchemaRoot() {
  return fileURLToPath(new URL("../schemas/execution-v2/", import.meta.url));
}

function defaultValidationRuntimeSchemaRoot() {
  return fileURLToPath(new URL("../schemas/validation-runtime-v1/", import.meta.url));
}

function defaultAcceptanceSchemaRoot() {
  return fileURLToPath(new URL("../schemas/acceptance-v1/", import.meta.url));
}

function validateDependencies(value, expected) {
  const dependencies = value === undefined ? [] : value;
  if (!Array.isArray(dependencies)) {
    throw new WireSchemaError("manifest.dependencies must be an array when present");
  }
  dependencies.forEach((entry, index) => {
    const path = `manifest.dependencies[${index}]`;
    exactKeys(entry, ["schema_set", "schema_set_digest"], ["schema_set", "schema_set_digest"], path);
    nonEmptyString(entry.schema_set, `${path}.schema_set`);
    if (!/^[a-f0-9]{64}$/u.test(entry.schema_set_digest)) {
      throw new WireSchemaError(`${path}.schema_set_digest must be a lowercase SHA-256 digest`);
    }
  });
  if (dependencies.length !== expected.length) {
    throw new WireSchemaError("manifest.dependencies differs from the required frozen dependency set");
  }
  dependencies.forEach((entry, index) => {
    if (
      entry.schema_set !== expected[index].schema_set ||
      entry.schema_set_digest !== expected[index].schema_set_digest
    ) {
      throw new WireSchemaError(`manifest.dependencies[${index}] differs from the required frozen dependency`);
    }
  });
  return dependencies;
}

function loadSchemaSet({
  root,
  manifestName,
  expectedSchemaSet,
  expectedDigest,
  expectedDependencies = [],
  expectedInboundRuntime = "not_implemented",
}) {
  const rootPath = realpathSync(resolve(root));
  const manifestPath = join(rootPath, manifestName);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new WireSchemaError(`wire schema manifest is missing or invalid: ${manifestPath}`, {
      cause: error,
    });
  }
  exactKeys(
    manifest,
    ["schema_set", "naming", "compatibility", "dependencies", "schemas", "schema_set_digest"],
    ["schema_set", "naming", "compatibility", "schemas", "schema_set_digest"],
    "manifest",
  );
  if (manifest.schema_set !== expectedSchemaSet) {
    throw new WireSchemaError(`manifest.schema_set must equal ${expectedSchemaSet}`);
  }
  if (manifest.naming !== WIRE_NAMING) {
    throw new WireSchemaError(`manifest.naming must equal ${WIRE_NAMING}`);
  }
  exactKeys(
    manifest.compatibility,
    ["external_keys", "internal_keys", "mixed_keys", "inbound_runtime"],
    ["external_keys", "internal_keys", "mixed_keys", "inbound_runtime"],
    "manifest.compatibility",
  );
  if (manifest.compatibility.external_keys !== "snake_case_only") {
    throw new WireSchemaError("manifest.compatibility.external_keys must equal snake_case_only");
  }
  if (manifest.compatibility.internal_keys !== "camelCase") {
    throw new WireSchemaError("manifest.compatibility.internal_keys must equal camelCase");
  }
  if (manifest.compatibility.mixed_keys !== "rejected") {
    throw new WireSchemaError("manifest.compatibility.mixed_keys must equal rejected");
  }
  if (manifest.compatibility.inbound_runtime !== expectedInboundRuntime) {
    throw new WireSchemaError(
      `manifest.compatibility.inbound_runtime must equal ${expectedInboundRuntime}`,
    );
  }
  const dependencies = validateDependencies(manifest.dependencies, expectedDependencies);
  if (!Array.isArray(manifest.schemas) || manifest.schemas.length === 0) {
    throw new WireSchemaError("manifest.schemas must be a non-empty array");
  }
  if (manifest.schema_set_digest !== expectedDigest) {
    throw new WireSchemaError("wire schema manifest digest differs from the compiled trust anchor", {
      expected: expectedDigest,
      actual: manifest.schema_set_digest,
    });
  }
  const recomputedSetDigest = schemaSetDigest(manifest);
  if (manifest.schema_set_digest !== recomputedSetDigest) {
    throw new WireSchemaError("wire schema set digest does not match manifest entries", {
      expected: recomputedSetDigest,
      actual: manifest.schema_set_digest,
    });
  }

  const names = new Set();
  const ids = new Set();
  const paths = new Set();
  const schemas = manifest.schemas.map((entry, index) => {
    const path = `manifest.schemas[${index}]`;
    exactKeys(entry, ["name", "id", "path", "sha256"], ["name", "id", "path", "sha256"], path);
    nonEmptyString(entry.name, `${path}.name`);
    nonEmptyString(entry.id, `${path}.id`);
    nonEmptyString(entry.path, `${path}.path`);
    if (!/^[a-z0-9][a-z0-9.-]*\.json$/u.test(entry.path)) {
      throw new WireSchemaError(`${path}.path must be one schema filename inside its schema-set directory`);
    }
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      throw new WireSchemaError(`${path}.sha256 must be a lowercase SHA-256 digest`);
    }
    if (names.has(entry.name)) throw new WireSchemaError(`${path}.name is duplicated`);
    if (ids.has(entry.id)) throw new WireSchemaError(`${path}.id is duplicated`);
    if (paths.has(entry.path)) throw new WireSchemaError(`${path}.path is duplicated`);
    names.add(entry.name);
    ids.add(entry.id);
    paths.add(entry.path);

    const candidate = realpathSync(join(rootPath, entry.path));
    if (dirname(candidate) !== rootPath) {
      throw new WireSchemaError(`${path}.path escapes the wire schema root`);
    }
    const text = readFileSync(candidate, "utf8");
    const actualHash = sha256(text);
    if (actualHash !== entry.sha256) {
      throw new WireSchemaError(`${entry.path} hash differs from the frozen manifest`, {
        expected: entry.sha256,
        actual: actualHash,
      });
    }
    let schema;
    try {
      schema = JSON.parse(text);
    } catch (error) {
      throw new WireSchemaError(`${entry.path} is not valid JSON`, { cause: error });
    }
    if (schema.$schema !== DRAFT) {
      throw new WireSchemaError(`${entry.path} must use JSON Schema 2020-12`);
    }
    if (schema.$id !== entry.id) {
      throw new WireSchemaError(`${entry.path} $id differs from manifest id`);
    }
    return schema;
  });

  return {
    schemaSet: manifest.schema_set,
    naming: manifest.naming,
    compatibility: { ...manifest.compatibility },
    dependencies: dependencies.map((entry) => ({ ...entry })),
    schemaSetDigest: manifest.schema_set_digest,
    manifestPath,
    schemas,
  };
}

export function loadWireSchemaSet({ root = defaultSchemaRoot() } = {}) {
  return loadSchemaSet({
    root,
    manifestName: INTERACTION_MANIFEST_NAME,
    expectedSchemaSet: WIRE_SCHEMA_SET,
    expectedDigest: WIRE_SCHEMA_SET_DIGEST,
  });
}

export function loadExecutionWireSchemaSetV1({ root = defaultExecutionV1SchemaRoot() } = {}) {
  const interaction = loadWireSchemaSet();
  return loadSchemaSet({
    root,
    manifestName: EXECUTION_V1_MANIFEST_NAME,
    expectedSchemaSet: EXECUTION_WIRE_SCHEMA_SET_V1,
    expectedDigest: EXECUTION_WIRE_SCHEMA_SET_DIGEST_V1,
    expectedDependencies: [
      {
        schema_set: interaction.schemaSet,
        schema_set_digest: interaction.schemaSetDigest,
      },
    ],
  });
}

export function loadExecutionWireSchemaSet({
  root = defaultExecutionSchemaRoot(),
  v1Root = defaultExecutionV1SchemaRoot(),
} = {}) {
  const interaction = loadWireSchemaSet();
  const executionV1 = loadExecutionWireSchemaSetV1({ root: v1Root });
  return loadSchemaSet({
    root,
    manifestName: EXECUTION_MANIFEST_NAME,
    expectedSchemaSet: EXECUTION_WIRE_SCHEMA_SET,
    expectedDigest: EXECUTION_WIRE_SCHEMA_SET_DIGEST,
    expectedDependencies: [
      {
        schema_set: interaction.schemaSet,
        schema_set_digest: interaction.schemaSetDigest,
      },
      {
        schema_set: executionV1.schemaSet,
        schema_set_digest: executionV1.schemaSetDigest,
      },
    ],
  });
}

export function loadValidationRuntimeWireSchemaSet({
  root = defaultValidationRuntimeSchemaRoot(),
  executionRoot = defaultExecutionSchemaRoot(),
  executionV1Root = defaultExecutionV1SchemaRoot(),
} = {}) {
  const interaction = loadWireSchemaSet();
  const execution = loadExecutionWireSchemaSet({
    root: executionRoot,
    v1Root: executionV1Root,
  });
  return loadSchemaSet({
    root,
    manifestName: VALIDATION_RUNTIME_MANIFEST_NAME,
    expectedSchemaSet: VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
    expectedDigest: VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
    expectedInboundRuntime: "validation_attempt_input_only",
    expectedDependencies: [
      {
        schema_set: interaction.schemaSet,
        schema_set_digest: interaction.schemaSetDigest,
      },
      {
        schema_set: execution.schemaSet,
        schema_set_digest: execution.schemaSetDigest,
      },
    ],
  });
}

export function loadAcceptanceWireSchemaSet({
  root = defaultAcceptanceSchemaRoot(),
  executionRoot = defaultExecutionSchemaRoot(),
  executionV1Root = defaultExecutionV1SchemaRoot(),
} = {}) {
  const interaction = loadWireSchemaSet();
  const execution = loadExecutionWireSchemaSet({
    root: executionRoot,
    v1Root: executionV1Root,
  });
  return loadSchemaSet({
    root,
    manifestName: ACCEPTANCE_MANIFEST_NAME,
    expectedSchemaSet: ACCEPTANCE_WIRE_SCHEMA_SET,
    expectedDigest: ACCEPTANCE_WIRE_SCHEMA_SET_DIGEST,
    expectedInboundRuntime: "validation_acceptance_only",
    expectedDependencies: [
      {
        schema_set: interaction.schemaSet,
        schema_set_digest: interaction.schemaSetDigest,
      },
      {
        schema_set: execution.schemaSet,
        schema_set_digest: execution.schemaSetDigest,
      },
    ],
  });
}
