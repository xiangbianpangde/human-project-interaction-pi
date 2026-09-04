export {
  VALIDATION_ADAPTER,
  VALIDATION_ATTEMPT_FAMILY,
  VALIDATION_ATTEMPT_INPUT_SCHEMA,
  VALIDATION_ATTEMPT_INPUT_WIRE_SCHEMA,
  VALIDATION_ATTEMPT_RECORD_SCHEMA,
  VALIDATION_ATTEMPT_RECORD_WIRE_SCHEMA,
  VALIDATION_AUTHORITY,
  VALIDATION_GATES,
  VALIDATION_PHASES,
  VALIDATION_PROJECT_ID,
  VALIDATION_RUNTIME_VERSION,
  VALIDATION_STORE_PREFIX,
  VALIDATION_STORE_SECURITY_MODEL,
  ValidationRuntimeContractError,
  computeValidationInputDigest,
  sha256Bytes,
  validateValidationAttemptInput,
  validateValidationAttemptRecord,
  validateValidationRecordChain,
} from "./validation-runtime/contract.mjs";

export {
  VALIDATION_RUNTIME_CODEC_VERSION,
  fromWireValidationAttemptInput,
  fromWireValidationAttemptRecord,
  toWireValidationAttemptInput,
  toWireValidationAttemptRecord,
} from "./validation-runtime/codecs.mjs";

export {
  ValidationRuntimeIntakeError,
  evaluateValidationAttemptGates,
  previewValidationAttempt,
  readValidationAttemptInput,
  reevaluateStoredValidationAttemptGates,
} from "./validation-runtime/intake.mjs";

export {
  ValidationRuntimeStoreError,
  acquireValidationAttemptLock,
  inspectValidationStoreBoundary,
  publishValidationInputSnapshot,
  publishValidationMachineResult,
  publishValidationRecord,
  readValidationAttemptHistory,
  validationAttemptStorePaths,
} from "./validation-runtime/store.mjs";

export {
  VALIDATION_RUNTIME_RESULT_SCHEMA,
  ValidationRuntimeError,
  getValidationAttemptStatus,
  runValidationAttempt,
  validationRuntimeIdentity,
} from "./validation-runtime/runtime.mjs";

export {
  VALIDATION_PROJECTION_ADAPTER,
  ValidationRuntimeProjectionError,
  buildValidationAttemptProjection,
  normalizeValidationAttemptProjection,
  resolveValidationMachineResultForCurrentBase,
} from "./validation-runtime/projection.mjs";

import { buildValidationAttemptProjection } from "./validation-runtime/projection.mjs";
import { runValidationAttempt } from "./validation-runtime/runtime.mjs";

export function runAndProjectValidationAttempt(projectRoot, manifestPointer, options = {}) {
  const runtime = runValidationAttempt(projectRoot, manifestPointer, options);
  const projectable = runtime.history && !["NOT_FOUND", "EMPTY"].includes(runtime.history.kind);
  if (!projectable) return { runtime };
  try {
    return {
      runtime,
      projectionBundle: buildValidationAttemptProjection(projectRoot, runtime.attemptId),
    };
  } catch (error) {
    return {
      runtime,
      projectionError: error instanceof Error ? error.message : String(error),
    };
  }
}
