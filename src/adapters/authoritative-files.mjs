import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const DEFAULT_AUTHORITY_FILE_LIMIT = 2 * 1024 * 1024;

export class AuthoritativeFileError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AuthoritativeFileError";
    this.details = details;
  }
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function declaredPath(root, pointer) {
  if (
    typeof pointer !== "string" ||
    pointer.trim() === "" ||
    isAbsolute(pointer) ||
    pointer.split(/[\\/]/u).some((segment) => segment === "..")
  ) {
    throw new AuthoritativeFileError(`invalid declared authority pointer: ${String(pointer)}`);
  }
  const candidate = resolve(root, pointer);
  if (!inside(root, candidate)) {
    throw new AuthoritativeFileError(`declared authority pointer escapes project root: ${pointer}`);
  }
  return candidate;
}

function inspectOne(root, rootReal, pointer, maxBytes) {
  const candidate = declaredPath(root, pointer);
  if (!existsSync(candidate)) return { pointer, path: candidate, missing: true };

  const rel = relative(root, candidate);
  let current = root;
  for (const segment of rel.split(sep)) {
    current = resolve(current, segment);
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new AuthoritativeFileError(`authority path contains a symbolic link: ${pointer}`, {
        pointer,
        path: current,
      });
    }
  }
  const real = realpathSync(candidate);
  if (!inside(rootReal, real)) {
    throw new AuthoritativeFileError(`authority path resolves outside the project root: ${pointer}`);
  }
  const stats = lstatSync(candidate);
  if (!stats.isFile()) {
    throw new AuthoritativeFileError(`authority path is not a regular file: ${pointer}`);
  }
  if (stats.size > maxBytes) {
    throw new AuthoritativeFileError(`authority file exceeds ${maxBytes} bytes: ${pointer}`, {
      pointer,
      size: stats.size,
      maxBytes,
    });
  }
  return {
    pointer,
    path: candidate,
    realpath: real,
    size: stats.size,
    device: stats.dev,
    inode: stats.ino,
    missing: false,
  };
}

export function inspectAuthoritativeFiles(projectRoot, files, { maxBytes = DEFAULT_AUTHORITY_FILE_LIMIT } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new AuthoritativeFileError("maxBytes must be a positive safe integer");
  }
  const root = resolve(projectRoot);
  if (!existsSync(root)) {
    return {
      root,
      rootReal: undefined,
      paths: Object.fromEntries(Object.entries(files).map(([key, pointer]) => [key, declaredPath(root, pointer)])),
      missing: Object.values(files),
      unsafe: [],
      available: false,
      maxBytes,
    };
  }
  const rootStats = lstatSync(root);
  if (!rootStats.isDirectory() && !rootStats.isSymbolicLink()) {
    throw new AuthoritativeFileError(`project root is not a directory: ${root}`);
  }
  const rootReal = realpathSync(root);
  const paths = {};
  const missing = [];
  const unsafe = [];
  for (const [key, pointer] of Object.entries(files)) {
    try {
      const inspected = inspectOne(root, rootReal, pointer, maxBytes);
      paths[key] = inspected.path;
      if (inspected.missing) missing.push(pointer);
    } catch (error) {
      paths[key] = declaredPath(root, pointer);
      unsafe.push({
        pointer,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    root,
    rootReal,
    paths,
    missing,
    unsafe,
    available: missing.length === 0 && unsafe.length === 0,
    maxBytes,
  };
}

function readBoundedRegularFileBytes(root, rootReal, pointer, maxBytes, validateOpenedFile) {
  const inspected = inspectOne(root, rootReal, pointer, maxBytes);
  if (inspected.missing) throw new AuthoritativeFileError(`authority file is missing: ${pointer}`);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(inspected.path, constants.O_RDONLY | noFollow);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) throw new AuthoritativeFileError(`authority path is not a regular file: ${pointer}`);
    if (stats.dev !== inspected.device || stats.ino !== inspected.inode) {
      throw new AuthoritativeFileError(`authority file changed between inspection and read: ${pointer}`);
    }
    if (stats.size > maxBytes) {
      throw new AuthoritativeFileError(`authority file exceeds ${maxBytes} bytes: ${pointer}`);
    }
    if (validateOpenedFile !== undefined) {
      validateOpenedFile(stats, { pointer, path: inspected.path });
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > maxBytes) {
        throw new AuthoritativeFileError(`authority file exceeds ${maxBytes} bytes while reading: ${pointer}`);
      }
      chunks.push(buffer.subarray(0, count));
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}

function inspectReadableSet(projectRoot, files, options) {
  const inspected = inspectAuthoritativeFiles(projectRoot, files, options);
  if (!inspected.available) {
    throw new AuthoritativeFileError("declared authority file set is unavailable", {
      missing: inspected.missing,
      unsafe: inspected.unsafe,
    });
  }
  return inspected;
}

export function readAuthoritativeFileBuffers(projectRoot, files, options = {}) {
  const { validateOpenedFile } = options;
  if (validateOpenedFile !== undefined && typeof validateOpenedFile !== "function") {
    throw new AuthoritativeFileError("validateOpenedFile must be a function when provided");
  }
  const inspected = inspectReadableSet(projectRoot, files, options);
  return Object.fromEntries(
    Object.entries(files).map(([key, pointer]) => [
      key,
      readBoundedRegularFileBytes(
        inspected.root,
        inspected.rootReal,
        pointer,
        inspected.maxBytes,
        validateOpenedFile,
      ),
    ]),
  );
}

export function readAuthoritativeFiles(projectRoot, files, options = {}) {
  return Object.fromEntries(
    Object.entries(readAuthoritativeFileBuffers(projectRoot, files, options)).map(([key, bytes]) => [
      key,
      bytes.toString("utf8"),
    ]),
  );
}
