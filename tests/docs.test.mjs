import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const matrix = read("HPI_FR_coverage_matrix.md");
const prd = read("human-project-interaction-skills-prd.md");
const readme = read("README.md");
const changelog = read("CHANGELOG.md");
const skill = read("skills/task/human-project-interaction/SKILL.md");
const manifest = JSON.parse(read("talk/styles/hpi-project/manifest.json"));
const executionV1Manifest = JSON.parse(read("schemas/execution-v1/manifest.v1.json"));
const executionV2Manifest = JSON.parse(read("schemas/execution-v2/manifest.v2.json"));
const packageJson = JSON.parse(read("package.json"));

describe("implementation documentation", () => {
  it("maps every FR-001 through FR-024 exactly once with bounded statuses", () => {
    const rows = [...matrix.matchAll(/^\| FR-(\d{3}) \|[^\n]+\| \*\*(试点已实现|部分实现|未实现)\*\* \|/gmu)];
    assert.deepEqual(
      rows.map((match) => match[1]),
      Array.from({ length: 24 }, (_value, index) => String(index + 1).padStart(3, "0")),
    );
    const counts = rows.reduce((result, match) => {
      result[match[2]] = (result[match[2]] ?? 0) + 1;
      return result;
    }, {});
    assert.deepEqual(counts, { 部分实现: 15, 试点已实现: 5, 未实现: 4 });
  });

  it("corrects the HULA citation without changing the E12 oversight source", () => {
    const hulaSentence = prd.split("\n").find((line) => line.includes("HULA 的公开研究"));
    assert.match(hulaSentence, /\[E09\]$/u);
    assert.doesNotMatch(hulaSentence, /\[E12\]/u);
    assert.match(prd, /\| E12 \| 英国政府/u);
  });

  it("tracks package, Skill, independently versioned style, and execution lineage releases", () => {
    assert.equal(packageJson.version, "0.5.0");
    assert.equal(manifest.version, "0.2.0");
    assert.equal(executionV1Manifest.schema_set, "hpi/wire/execution/v1");
    assert.equal(executionV1Manifest.schema_set_digest, "450698c6e3218b3419f081dc47576f94edaea36ee0da6a97b35c80ef6d9e88d1");
    assert.equal(executionV1Manifest.dependencies[0].schema_set, "hpi/wire/v1");
    assert.equal(executionV2Manifest.schema_set, "hpi/wire/execution/v2");
    assert.deepEqual(
      executionV2Manifest.dependencies.map((dependency) => dependency.schema_set),
      ["hpi/wire/v1", "hpi/wire/execution/v1"],
    );
    assert.match(skill, /version: "0\.5\.0"/u);
    assert.match(changelog, /^## 0\.5\.0 - 2026-08-31$/mu);
  });

  it("freezes the pilot boundary and contains no machine-specific install path", () => {
    assert.match(readme, /TS-001 Adapter `ts001-pilot\/0\.1\.0`/u);
    assert.match(readme, /完整 P0：未关闭/u);
    assert.match(readme, /PI_CODING_AGENT_DIR/u);
    assert.match(readme, /hpi\/wire\/v1/u);
    assert.match(readme, /hpi\/wire\/execution\/v1/u);
    assert.match(readme, /hpi\/wire\/execution\/v2/u);
    assert.match(readme, /snake_case-only/u);
    assert.match(readme, /Inbound runtime.*`not_implemented`/u);
    assert.match(readme, /execution lifecycle 只做无副作用/u);
    assert.match(readme, /projector-owned/u);
    assert.doesNotMatch(readme, /\/Users\/xbpd\/Projects\/交互skills|\/opt\/homebrew/u);
  });
});
