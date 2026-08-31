import { resolve } from "node:path";

import {
  TS001_ADAPTER_VERSION,
  detectTs001Pilot,
  loadTs001Pilot,
} from "../adapter.mjs";
import {
  RICL_V4_ADAPTER_VERSION,
  detectRiclV4,
  loadRiclV4,
} from "./ricl-v4.mjs";

const ADAPTERS = Object.freeze([
  Object.freeze({
    id: TS001_ADAPTER_VERSION,
    detect: detectTs001Pilot,
    load: loadTs001Pilot,
  }),
  Object.freeze({
    id: RICL_V4_ADAPTER_VERSION,
    detect: detectRiclV4,
    load: loadRiclV4,
  }),
]);

export class AdapterRegistryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AdapterRegistryError";
    this.details = details;
  }
}

export function listProjectAdapters() {
  return ADAPTERS.map((adapter) => adapter.id);
}

export function detectProjectAdapter(projectRoot) {
  const root = resolve(projectRoot);
  const detections = ADAPTERS.map((adapter) => {
    try {
      return { adapter, result: adapter.detect(root) };
    } catch (error) {
      return {
        adapter,
        result: {
          available: false,
          root,
          paths: {},
          missing: [],
          unsafe: [
            {
              pointer: root,
              error: error instanceof Error ? error.message : String(error),
            },
          ],
          reason: `adapter detection failed closed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  });
  const available = detections.filter((entry) => entry.result.available);
  if (available.length === 1) {
    return {
      ...available[0].result,
      available: true,
      adapter: available[0].adapter.id,
      supportedAdapters: listProjectAdapters(),
    };
  }
  if (available.length > 1) {
    return {
      available: false,
      root,
      adapter: undefined,
      missing: [],
      reason: `ambiguous HPI adapter match: ${available.map((entry) => entry.adapter.id).join(", ")}`,
      supportedAdapters: listProjectAdapters(),
      detections: detections.map((entry) => entry.result),
    };
  }
  return {
    available: false,
    root,
    adapter: undefined,
    missing: detections.flatMap((entry) => [
      ...entry.result.missing.map((pointer) => `${entry.adapter.id}:${pointer}`),
      ...(entry.result.unsafe ?? []).map(
        (unsafe) => `${entry.adapter.id}:unsafe:${unsafe.pointer}:${unsafe.error}`,
      ),
    ]),
    reason: "no supported HPI adapter",
    supportedAdapters: listProjectAdapters(),
    detections: detections.map((entry) => entry.result),
  };
}

export function loadProjectSource(projectRoot, options = {}) {
  const detected = detectProjectAdapter(projectRoot);
  if (!detected.available) {
    throw new AdapterRegistryError(detected.reason || "no supported HPI adapter", {
      projectRoot: detected.root,
      missing: detected.missing,
      supportedAdapters: detected.supportedAdapters,
    });
  }
  const adapter = ADAPTERS.find((entry) => entry.id === detected.adapter);
  if (!adapter) throw new AdapterRegistryError(`registered adapter disappeared: ${detected.adapter}`);
  return adapter.load(projectRoot, options);
}
