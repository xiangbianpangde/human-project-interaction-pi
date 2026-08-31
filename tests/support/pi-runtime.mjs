import { pathToFileURL } from "node:url";

import { resolvePiExtensionLoader, resolvePiPackageRoot } from "../../src/pi-paths.mjs";

export { resolvePiPackageRoot };

export async function loadPiExtensions(paths, cwd) {
  const loader = await import(pathToFileURL(resolvePiExtensionLoader()).href);
  return loader.loadExtensions(paths, cwd);
}
