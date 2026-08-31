import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { rebuildTs001Projection } from "../src/projector.mjs";
import { serializeTalkContent } from "../src/talk-content.mjs";

const rootPath = decodeURIComponent(new URL("..", import.meta.url).pathname);
const manifestPath = new URL("../talk/styles/hpi-project/manifest.json", import.meta.url);
const templatePath = new URL("../talk/styles/hpi-project/index.html", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const template = readFileSync(templatePath, "utf8");

describe("hpi-project style manifest", () => {
  it("uses the evolutionary html-js pack contract", () => {
    assert.equal(manifest.id, "hpi-project");
    assert.equal(manifest.kind, "html-js");
    assert.equal(manifest.entry, "index.html");
    assert.deepEqual(manifest.dependencies, ["components"]);
    assert.match(manifest.useWhen, /重新进入/);
    assert.equal("governance" in manifest, false);
  });
});

describe("hpi-project template", () => {
  it("contains one JSON content slot and no inline event handlers", () => {
    assert.equal((template.match(/\{\{content\}\}/g) ?? []).length, 1);
    assert.doesNotMatch(template, /\son[a-z]+\s*=/iu);
    assert.doesNotMatch(template, /javascript:/iu);
    assert.match(template, /<script id="hpi-data" type="application\/json">\{\{content\}\}<\/script>/);
    assert.match(template, /button\.setAttribute\("aria-label", `选择：\$\{option\.label\}`\)/);
  });

  it("keeps L0/L1 visible and L2-L4 behind details", () => {
    assert.match(template, /L0 · Project Re-entry/);
    assert.match(template, /L1 · Human Brief/);
    assert.match(template, /<details class="section drill" id="layer-l2">/);
    assert.match(template, /<details class="section drill" id="layer-l3">/);
    assert.match(template, /<details class="section drill" id="layer-l4">/);
    assert.doesNotMatch(template, /id="layer-l2"[^>]*\sopen(?:\s|>)/);
  });

  it("routes only read-only navigation and candidate decision events", () => {
    for (const eventType of [
      "hpi.view.l2",
      "hpi.view.machine_result",
      "hpi.view.evidence",
      "hpi.refresh",
      "hpi.decision.choose",
      "hpi.decision.request_changes",
    ]) {
      assert.match(template, new RegExp(eventType.replaceAll(".", "\\.")));
    }
    assert.doesNotMatch(template, /hpi\.(?:commit|accept|write_state|record_human_result)/);
    assert.match(template, /尚未写入 canonical/);
  });

  it("derives status presentation from closed enum maps", () => {
    assert.match(template, /const machineMeta = Object\.freeze/);
    assert.match(template, /const humanMeta = Object\.freeze/);
    assert.match(template, /"NOT-RUN": \["tone-mid"/);
    assert.doesNotMatch(template, /"NOT-RUN": \["tone-ok"/);
    assert.match(template, /overallStatus is forbidden/);
  });

  it("has syntactically valid runtime JavaScript", () => {
    const scripts = [...template.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.equal(scripts.length, 2);
    assert.doesNotThrow(() => new Function(scripts[1]));
  });

  it("accepts the deterministic TS-001 JSON payload in its content slot", () => {
    const payload = serializeTalkContent(rebuildTs001Projection(rootPath));
    const rendered = template.replace("{{content}}", payload.replaceAll("</", "<\\/"));
    assert.match(rendered, /"machine":"NOT-RUN"/);
    assert.match(rendered, /"human":"HUMAN_PENDING"/);
    assert.doesNotMatch(payload, /"overallStatus"/);
    assert.equal(rendered.includes("{{content}}"), false);
  });
});
