import { fileURLToPath, pathToFileURL } from "node:url";

import { resolvePiExtensionLoader, resolvePiPackageRoot } from "../../src/pi-paths.mjs";

export { resolvePiPackageRoot };

export async function loadPiExtensions(paths, cwd) {
  const pinnedPackageRoot = fileURLToPath(
    new URL("../../node_modules/@earendil-works/pi-coding-agent/", import.meta.url),
  );
  const loader = await import(
    pathToFileURL(resolvePiExtensionLoader({ packageRoot: pinnedPackageRoot })).href
  );
  return loader.loadExtensions(paths, cwd);
}
