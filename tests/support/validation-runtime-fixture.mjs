import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TS001_FILES, loadTs001Pilot } from "../../src/adapter.mjs";
import {
  VALIDATION_ADAPTER,
  VALIDATION_ATTEMPT_FAMILY,
  VALIDATION_AUTHORITY,
  VALIDATION_PROJECT_ID,
  VALIDATION_STORE_PREFIX,
  sha256Bytes,
} from "../../src/validation-runtime/contract.mjs";
import { toWireValidationAttemptInput } from "../../src/validation-runtime/codecs.mjs";
import {
  EXECUTION_WIRE_SCHEMA_SET,
  EXECUTION_WIRE_SCHEMA_SET_DIGEST,
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
  VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
} from "../../src/wire-schema.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export function populateTs001Authority(root) {
  for (const pointer of Object.values(TS001_FILES)) {
    const target = join(root, pointer);
    if (!existsSync(target)) cpSync(join(repositoryRoot, pointer), target);
  }
  return loadTs001Pilot(root);
}

function rawRef(root, ref) {
  return { ...ref, sha256: sha256Bytes(readFileSync(join(root, ref.pointer))) };
}

export function buildValidationAttemptFixture(root, {
  attemptId = "VRS1-TEST-001",
  declaredAt = "2026-08-31T12:00:00Z",
  retryOf,
  write = true,
  filename,
} = {}) {
  const base = populateTs001Authority(root);
  const byPointer = new Map(base.sourceSnapshot.map((ref) => [ref.pointer, rawRef(root, ref)]));
  const taskRef = byPointer.get(TS001_FILES.contract);
  const contractRefs = [byPointer.get(TS001_FILES.prd)];
  const inputRefs = [byPointer.get(TS001_FILES.technicalDesign)];
  const declaredReadSet = [
    taskRef.pointer,
    ...contractRefs.map((ref) => ref.pointer),
    ...inputRefs.map((ref) => ref.pointer),
  ].sort();
  const wire = toWireValidationAttemptInput({
    validationAttemptId: attemptId,
    attemptFamily: VALIDATION_ATTEMPT_FAMILY,
    projectId: VALIDATION_PROJECT_ID,
    adapter: VALIDATION_ADAPTER,
    taskRef,
    contractRefs,
    inputRefs,
    declaredReadSet,
    isolatedWriteRoot: `${VALIDATION_STORE_PREFIX}/${attemptId}`,
    executionContract: {
      schemaSet: EXECUTION_WIRE_SCHEMA_SET,
      schemaSetDigest: EXECUTION_WIRE_SCHEMA_SET_DIGEST,
    },
    validationContract: {
      schemaSet: VALIDATION_RUNTIME_WIRE_SCHEMA_SET,
      schemaSetDigest: VALIDATION_RUNTIME_WIRE_SCHEMA_SET_DIGEST,
    },
    authority: VALIDATION_AUTHORITY,
    ...(retryOf === undefined ? {} : { retryOf }),
    declaredAt,
  });
  const manifestName = filename ?? `validation-attempt-${attemptId}.json`;
  const manifestPointer = `.pi/validation-inputs/${manifestName}`;
  if (write) {
    mkdirSync(join(root, ".pi", "validation-inputs"), { recursive: true });
    writeFileSync(join(root, manifestPointer), `${JSON.stringify(wire, null, 2)}\n`, "utf8");
  }
  return {
    base,
    wire,
    manifestPointer,
    manifestPath: join(root, manifestPointer),
    taskRef,
    contractRefs,
    inputRefs,
    declaredReadSet,
  };
}

export function validationStoreRoot(root, attemptId) {
  return join(root, VALIDATION_STORE_PREFIX, attemptId);
}

export function validationStorePointer(attemptId, child) {
  return `${VALIDATION_STORE_PREFIX}/${attemptId}/${child}`;
}

export function filenameOf(pointer) {
  return basename(pointer);
}
