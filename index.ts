// Package entry used when this repository is linked into Pi's extensions directory.
// Keeping the entry at the package root preserves the extension's ../../src imports
// without copying the deterministic core into a second canonical location.
export { default } from "./extension/hpi/index.ts";
