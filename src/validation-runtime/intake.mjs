import { TextDecoder } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { TS001_FILES, loadTs001Pilot } from "../adapter.mjs";
import { readAuthoritativeFileBuffers } from "../adapters/authoritative-files.mjs";
import { frozenIdentityKey } from "../execution/contract.mjs";
import {
  loadExecutionWireSchemaSet,
  loadExecutionWireSchemaSetV1,
  loadValidationRuntimeWireSchemaSet,
  loadWireSchemaSet,
} from "../wire-schema.mjs";
import {
  VALIDATION_GATES,
  VALIDATION_STORE_PREFIX,
  VALIDATION_STORE_SECURITY_MODEL,
  sha256Bytes,
  validationRetryAttemptId,
  validationScopedPath,
} from "./contract.mjs";
import { fromWireValidationAttemptInput } from "./codecs.mjs";
import {
  inspectValidationStoreBoundary,
  readValidationAttemptHistory,
} from "./store.mjs";

const INPUT_SCHEMA_ID = "urn:hpi:wire:validation-attempt-input:v1";
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

let compiledInputValidator;

export class ValidationRuntimeIntakeError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ValidationRuntimeIntakeError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ValidationRuntimeIntakeError(code, message, details);
}

function inputValidator() {
  const validation = loadValidationRuntimeWireSchemaSet();
  if (compiledInputValidator) return compiledInputValidator;
  const interaction = loadWireSchemaSet();
  const executionV1 = loadExecutionWireSchemaSetV1();
  const execution = loadExecutionWireSchemaSet();
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
  const validate = ajv.getSchema(INPUT_SCHEMA_ID);
  if (!validate) fail("VALIDATION_SCHEMA_UNAVAILABLE", `compiled schema is missing: ${INPUT_SCHEMA_ID}`);
  compiledInputValidator = validate;
  return compiledInputValidator;
}

function decodeJson(bytes, pointer) {
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch (error) {
    fail("MANIFEST_UTF8", `${pointer} is not valid UTF-8`, { cause: error });
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch (error) {
    fail("MANIFEST_JSON", `${pointer} is not valid JSON`, { cause: error });
  }
}

function allInputRefs(input) {
  return [input.taskRef, ...input.contractRefs, ...input.inputRefs];
}

function manifestRef(input, rawDigest, pointer) {
  return {
    id: input.validationAttemptId,
    revision: input.inputRevision,
    sha256: rawDigest,
    pointer,
  };
}

export function readValidationAttemptInput(projectRoot, manifestPointer) {
  validationScopedPath(manifestPointer, "manifestPointer");
  if (manifestPointer === VALIDATION_STORE_PREFIX || manifestPointer.startsWith(`${VALIDATION_STORE_PREFIX}/`)) {
    fail("MANIFEST_INSIDE_STORE", "the invocation manifest must be outside the isolated attempt store");
  }
  let bytes;
  try {
    bytes = readAuthoritativeFileBuffers(projectRoot, { manifest: manifestPointer }, {
      maxBytes: MAX_MANIFEST_BYTES,
    }).manifest;
  } catch (error) {
    fail("MANIFEST_READ", `cannot read the declared manifest ${manifestPointer}`, { cause: error });
  }
  const decoded = decodeJson(bytes, manifestPointer);
  const validate = inputValidator();
  if (!validate(decoded.value)) {
    fail("MANIFEST_SCHEMA", "validation-attempt input does not match the frozen wire schema", {
      errors: structuredClone(validate.errors ?? []),
    });
  }
  let parsed;
  try {
    parsed = fromWireValidationAttemptInput(decoded.value, "validationAttemptInput");
  } catch (error) {
    fail("MANIFEST_CONTRACT", "validation-attempt input violates its companion contract", {
      cause: error,
    });
  }
  const rawDigest = sha256Bytes(bytes);
  return {
    schema: "hpi/validation-attempt-intake/v1",
    manifestPointer,
    rawBytes: Buffer.from(bytes),
    rawDigest,
    wire: parsed.wire,
    input: parsed.internal,
    manifestRef: manifestRef(parsed.internal, rawDigest, manifestPointer),
    projectCanonicalChanged: false,
  };
}

function gate(gateName, status, code, evidenceRefs = []) {
  return { gate: gateName, status, code, evidenceRefs };
}

function errorCode(error, fallback) {
  if (typeof error?.code === "string" && error.code) return error.code;
  return fallback;
}

function expectedTs001Pointers() {
  return Object.values(TS001_FILES).toSorted();
}

function validateIdentity(projectRoot, intake) {
  const input = intake.input;
  const refs = allInputRefs(input);
  const actualPointers = refs.map((ref) => ref.pointer).toSorted();
  const expectedPointers = expectedTs001Pointers();
  if (JSON.stringify(actualPointers) !== JSON.stringify(expectedPointers)) {
    fail("IDENTITY_AUTHORITY_SET", "declared refs must equal the closed TS-001 authority file set", {
      expected: expectedPointers,
      actual: actualPointers,
    });
  }
  if (input.taskRef.pointer !== TS001_FILES.contract) {
    fail("IDENTITY_TASK_REF", `task_ref must point to ${TS001_FILES.contract}`);
  }
  const contractPointers = input.contractRefs.map((ref) => ref.pointer);
  if (JSON.stringify(contractPointers) !== JSON.stringify([TS001_FILES.prd])) {
    fail("IDENTITY_CONTRACT_REFS", `contract_refs must contain only ${TS001_FILES.prd}`);
  }
  const inputPointers = input.inputRefs.map((ref) => ref.pointer);
  if (JSON.stringify(inputPointers) !== JSON.stringify([TS001_FILES.technicalDesign])) {
    fail("IDENTITY_INPUT_REFS", `input_refs must contain only ${TS001_FILES.technicalDesign}`);
  }
  const base = loadTs001Pilot(projectRoot);
  const expectedByPointer = new Map(base.sourceSnapshot.map((ref) => [ref.pointer, ref]));
  for (const ref of refs) {
    const expected = expectedByPointer.get(ref.pointer);
    if (!expected || ref.id !== expected.id || String(ref.revision) !== String(expected.revision)) {
      fail("IDENTITY_BASE_REF", `declared identity differs from current TS-001 authority at ${ref.pointer}`);
    }
  }
  if (input.retryOf !== undefined) {
    const priorAttemptId = validationRetryAttemptId(input.retryOf, input.validationAttemptId);
    const history = readValidationAttemptHistory(projectRoot, priorAttemptId);
    if (history.locked) fail("RETRY_PRIOR_LOCKED", "retry source still has an active or stale lock");
    const latestRef = history.recordRefs.at(-1);
    if (!latestRef) fail("RETRY_PRIOR_RECORD_MISSING", "retry_of does not resolve to a prior latest record");
    if (
      frozenIdentityKey(latestRef) !== frozenIdentityKey(input.retryOf) ||
      latestRef.pointer !== input.retryOf.pointer
    ) {
      fail("RETRY_PRIOR_NOT_LATEST", "retry_of must exactly reference the prior attempt latest record");
    }
    if (history.terminal?.outcome === "MACHINE_RESULT_PRODUCED") {
      fail("RETRY_PRIOR_SUCCEEDED", "a completed successful validation attempt is not retryable");
    }
  }
  return base;
}

function validateReferences(projectRoot, intake) {
  const refs = allInputRefs(intake.input);
  const declared = Object.fromEntries(refs.map((ref, index) => [`ref${index}`, ref.pointer]));
  let buffers;
  try {
    buffers = readAuthoritativeFileBuffers(projectRoot, declared, { maxBytes: MAX_MANIFEST_BYTES });
  } catch (error) {
    fail("REFERENCE_READ", "a declared frozen reference is missing, unsafe, or unreadable", {
      cause: error,
    });
  }
  const snapshot = [];
  refs.forEach((ref, index) => {
    const actual = sha256Bytes(buffers[`ref${index}`]);
    if (actual !== ref.sha256) {
      fail("REFERENCE_DIGEST_MISMATCH", `raw-byte digest differs at ${ref.pointer}`, {
        expected: ref.sha256,
        actual,
      });
    }
    snapshot.push({ ref, rawDigest: actual });
  });
  return snapshot;
}

function validateWorkspace(projectRoot, intake, options = {}) {
  const { input, manifestPointer } = intake;
  inspectValidationStoreBoundary(projectRoot, input.validationAttemptId);
  if (
    !options.persistedSnapshot &&
    (manifestPointer === input.isolatedWriteRoot ||
      manifestPointer.startsWith(`${input.isolatedWriteRoot}/`))
  ) {
    fail("WORKSPACE_MANIFEST_OVERLAP", "manifest must be outside the isolated write root");
  }
  for (const pointer of input.declaredReadSet) {
    if (pointer === VALIDATION_STORE_PREFIX || pointer.startsWith(`${VALIDATION_STORE_PREFIX}/`)) {
      fail("WORKSPACE_READ_WRITE_OVERLAP", "declared authority refs must not read validation history");
    }
  }
  if (input.authority.network !== "DENY") {
    fail("WORKSPACE_NETWORK", "network must remain DENY");
  }
  return { isolatedWriteRoot: input.isolatedWriteRoot, network: "DENY" };
}

function validateAuthority(intake) {
  const forbidden = [
    "projectCanonicalWrite",
    "projectSemanticStateWrite",
    "humanResultIntake",
    "candidateEventIntake",
    "agentDispatch",
    "automaticCanonicalInvalidation",
  ];
  for (const key of forbidden) {
    if (intake.input.authority[key] !== "FORBIDDEN") {
      fail("AUTHORITY_EXPANSION", `${key} must remain FORBIDDEN`);
    }
  }
  return intake.input.authority;
}

export function evaluateValidationAttemptGates(projectRoot, intake, options = {}) {
  const refs = allInputRefs(intake.input);
  const outcomes = [];
  const errors = [];
  let failedGate;
  let baseSource = null;
  let referenceSnapshot = [];

  const definitions = [
    {
      name: "V1_SCHEMA",
      evidence: [intake.manifestRef],
      run: () => true,
      passed: "SCHEMA_VALIDATED",
      failed: "SCHEMA_REJECTED",
    },
    {
      name: "V1_IDENTITY",
      evidence: refs,
      run: () => {
        baseSource = validateIdentity(projectRoot, intake);
      },
      passed: "IDENTITY_VALIDATED",
      failed: "IDENTITY_REJECTED",
    },
    {
      name: "V1_REFERENCE",
      evidence: refs,
      run: () => {
        referenceSnapshot = validateReferences(projectRoot, intake);
      },
      passed: "REFERENCES_VERIFIED",
      failed: "REFERENCES_REJECTED",
    },
    {
      name: "V1_WORKSPACE",
      evidence: [intake.manifestRef],
      run: () => validateWorkspace(projectRoot, intake, options),
      passed: "WORKSPACE_VERIFIED",
      failed: "WORKSPACE_REJECTED",
    },
    {
      name: "V1_AUTHORITY",
      evidence: [intake.manifestRef],
      run: () => validateAuthority(intake),
      passed: "AUTHORITY_VERIFIED",
      failed: "AUTHORITY_REJECTED",
    },
  ];

  for (const definition of definitions) {
    if (failedGate) {
      outcomes.push(gate(definition.name, "NOT_RUN", `NOT_RUN_AFTER_${failedGate}`, []));
      continue;
    }
    try {
      definition.run();
      outcomes.push(gate(definition.name, "PASSED", definition.passed, definition.evidence));
    } catch (error) {
      failedGate = definition.name;
      const code = errorCode(error, definition.failed);
      outcomes.push(gate(definition.name, "FAILED", code, definition.evidence));
      errors.push({
        gate: definition.name,
        code,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (outcomes.length !== VALIDATION_GATES.length) {
    fail("GATE_INTERNAL", "runtime did not evaluate the complete V1 Gate sequence");
  }
  return {
    schema: "hpi/validation-gate-preview/v1",
    accepted: failedGate === undefined,
    gateOutcomes: outcomes,
    errors,
    baseSource,
    referenceSnapshot,
    projectCanonicalChanged: false,
  };
}

export function reevaluateStoredValidationAttemptGates(projectRoot, history) {
  if (!history?.inputManifest || !history?.inputRef) {
    fail("STORED_INPUT_MISSING", "persisted Gate re-evaluation requires one immutable input snapshot");
  }
  return evaluateValidationAttemptGates(projectRoot, {
    schema: "hpi/validation-attempt-intake/v1",
    manifestPointer: history.inputRef.pointer,
    rawBytes: Buffer.alloc(0),
    rawDigest: history.inputRef.sha256,
    wire: undefined,
    input: history.inputManifest,
    manifestRef: history.inputRef,
    projectCanonicalChanged: false,
  }, { persistedSnapshot: true });
}

export function previewValidationAttempt(projectRoot, manifestPointer) {
  const intake = readValidationAttemptInput(projectRoot, manifestPointer);
  return {
    kind: "VALIDATION_ATTEMPT_PREVIEW",
    attemptId: intake.input.validationAttemptId,
    inputRevision: intake.input.inputRevision,
    inputDigest: intake.input.inputDigest,
    storeSecurityModel: VALIDATION_STORE_SECURITY_MODEL,
    ...evaluateValidationAttemptGates(projectRoot, intake),
    wroteStore: false,
    projectCanonicalChanged: false,
  };
}
