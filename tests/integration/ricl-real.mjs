import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../../src/contracts.mjs";
import { RICL_V4_FILES, loadRiclV4 } from "../../src/adapters/ricl-v4.mjs";
import { projectSource } from "../../src/projector.mjs";
import { buildTalkContent } from "../../src/talk-content.mjs";
import { loadPiExtensions } from "../support/pi-runtime.mjs";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const projectRoot = process.env.HPI_RICL_V4_ROOT;
if (!projectRoot) {
  throw new Error("HPI_RICL_V4_ROOT is required for the real R-ICL integration test");
}

async function inputHashes() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(RICL_V4_FILES).map(async ([key, relativePath]) => [
        key,
        sha256(await readFile(join(projectRoot, relativePath), "utf8")),
      ]),
    ),
  );
}

function mockContext(entries) {
  return {
    cwd: resolve(projectRoot),
    mode: "print",
    hasUI: false,
    sessionManager: { getBranch: () => entries },
    ui: { setStatus() {}, notify() {} },
  };
}

test("real R-ICL Adapter → projection → Extension query remains read-only", async () => {
  const before = await inputHashes();
  const source = loadRiclV4(projectRoot);
  const projection = projectSource(source);
  const talk = buildTalkContent(projection);

  assert.equal(source.authority.machineStatus, "INCOMPLETE");
  assert.equal(source.authority.humanStatus, "NOT_NEEDED");
  assert.equal(projection.hps.phase, "MACHINE_VALIDATION");
  assert.equal(projection.machineResults[0].verdict, "INCOMPLETE");
  assert.equal(talk.decision, null);
  assert.doesNotMatch(JSON.stringify(talk), /TS-001/);
  assert.doesNotMatch(talk.l0.current, /90_工作底稿_raw|\.md/);
  assert.ok(talk.l1.verified.some((line) => /90_工作底稿_raw/.test(line)));

  const loaded = await loadPiExtensions([join(packageRoot, "index.ts")], packageRoot);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  const entries = [];
  loaded.runtime.appendEntry = (customType, data) => entries.push({ customType, data });
  const ctx = mockContext(entries);

  const query = extension.tools.get("hpi_query").definition;
  const status = await query.execute("ricl-query-status", { op: "status" }, undefined, undefined, ctx);
  const brief = await query.execute("ricl-query-brief", { op: "brief" }, undefined, undefined, ctx);
  const wire = await query.execute("ricl-query-wire", { op: "wire" }, undefined, undefined, ctx);
  assert.equal(status.details.data.adapter, "ricl-v4-readonly/0.1.0");
  assert.equal(status.details.data.wireSchemaSet, "hpi/wire/v1");
  assert.match(status.details.data.wireSchemaSetDigest, /^[a-f0-9]{64}$/);
  assert.equal(status.details.data.executionWireSchemaSet, "hpi/wire/execution/v1");
  assert.match(status.details.data.executionWireSchemaSetDigest, /^[a-f0-9]{64}$/);
  assert.equal(status.details.data.boundaries.executionRuntimeIntake, "NOT_IMPLEMENTED");
  assert.equal(status.details.data.wireNaming, "snake_case");
  assert.equal(status.details.data.hps.activeWork[0].machineStatus, "INCOMPLETE");
  assert.equal(status.details.data.hps.activeWork[0].humanStatus, "NOT_NEEDED");
  assert.match(brief.details.data.talkContent.project.title, /R-ICL v4\.0/);
  assert.equal(brief.details.data.wireContract.schemaSet, "hpi/wire/v1");
  assert.equal(brief.details.data.executionWireContract.schemaSet, "hpi/wire/execution/v1");
  assert.equal(brief.details.data.talkContent.decision, null);
  assert.equal(wire.details.data.schema_set, "hpi/wire/v1");
  assert.equal(wire.details.data.inbound_runtime, "NOT_IMPLEMENTED");
  assert.equal(wire.details.data.execution_contract.schema_set, "hpi/wire/execution/v1");
  assert.equal(wire.details.data.execution_contract.runtime_intake, "NOT_IMPLEMENTED");
  assert.equal(wire.details.data.execution_contract.available_project_objects, 0);
  assert.ok(wire.details.data.objects.some((object) => object.schema === "hpi/wire/hps/v1"));
  assert.ok(
    wire.details.data.objects.some(
      (object) =>
        object.schema === "hpi/wire/hps/v1" &&
        object.active_work[0].machine_status === "INCOMPLETE" &&
        object.active_work[0].human_status === "NOT_NEEDED",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(wire.details.data),
    /"(?:projectId|machineStatus|humanStatus|briefId|resultId)"/u,
  );
  assert.equal(entries.length, 0);

  const propose = extension.tools.get("hpi_propose").definition;
  const rejected = await propose.execute(
    "ricl-machine-fact",
    {
      op: "escalation",
      payloadJson: JSON.stringify({
        projectId: source.projectId,
        category: "DESIGN",
        decisionUnit: "approve-material-pass",
        question: "你是否接受当前材料里的 PASS 和 hash 已经验证？",
      }),
    },
    undefined,
    undefined,
    ctx,
  );
  assert.match(rejected.content[0].text, /"kind": "MACHINE_FACT_REJECTED"/);
  assert.equal(entries.length, 0);
  assert.deepEqual(await inputHashes(), before);
});
