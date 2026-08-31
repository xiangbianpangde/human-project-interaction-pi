import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { sha256 } from "../src/contracts.mjs";
import { detectProjectAdapter, loadProjectSource } from "../src/adapters/registry.mjs";
import {
  RICL_V4_ADAPTER_VERSION,
  RICL_V4_FILES,
  detectRiclV4,
  loadRiclV4,
} from "../src/adapters/ricl-v4.mjs";
import { projectSource, rebuildProjectProjection } from "../src/projector.mjs";
import { buildTalkContent } from "../src/talk-content.mjs";

const temporaryRoots = [];

const fixtureTexts = Object.freeze({
  rootReadme: `---\ntype: index\n状态: 进行中\n---\n# v4.0 入口\n本目录是 R-ICL 深入研究 v4.0 的工作根。\n`,
  current: `---\ntype: index\n状态: 进行中\n更新时间: 2026-08-27\n---\n# 当前\n\n> 本文件是 v4.0 唯一的「当前」指针。\n\n## 现在在做什么\n\n**90_ 制度约束专项已完成（审核者终态确认 PASS）**。R1/R2/Pilot/Formal 仍不解封。\n\n## 现在不做什么\n\n- 不冻结 RQ-RICL-001。\n- 不做破坏性自动修复。\n\n## 下一步\n\n下一步：无（专项完成）。\n`,
  authority: `---\ntype: 制度规范\n版本: v1.1\n---\n# 权威与当前\n\n「当前」由文件位置决定。全树只允许一份 04_索引_当前.md。\n`,
  worklogContract: `---\ntype: 制度规范\n版本: v1.0\n---\n# worklog · 短合同\n\n全树恰一个活 worklog 目录；HEAD 工具生成，LOG 只追加，COMPACT 折叠历史。\n`,
  worklogProject: `---\ntype: 制度规范\n版本: v1.0\n---\n# worklog · 项目文档\n\n## 解决的问题\n\n1. 中间失忆：只追加、不压缩、无限膨胀；\n2. 多份 worklog / 权威打架；\n3. 停机与过程记录脱节。\n`,
  worklogHead: `现在：已停机（90_工作底稿_raw/fixture.md）\n阻塞：无\n下一步：无（专项完成）\n最近冻结：无\n最近跑批：无\n开放项：BLOCKER 0 待闭合；NEGATIVE 0 条未折\n`,
  worklogLog: `## 2026-08-26 21:40 | 学生 | SESSION | 专项\n- 状态变化：会话 → 开启\n- 下一步：审核者复算\n\n## 2026-08-27 05:00 | 学生 | SESSION | 专项终态\n- 状态变化：会话 → 关闭\n- 做了 / 停在 / 下一步 / 未决：做了：门禁补丁；停在：终态接受；下一步：无（专项完成）；未决：无\n`,
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "hpi-ricl-v4-"));
  temporaryRoots.push(root);
  for (const [key, relativePath] of Object.entries(RICL_V4_FILES)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, fixtureTexts[key], "utf8");
  }
  return root;
}

async function sourceHashes(root) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(RICL_V4_FILES).map(async ([key, relativePath]) => [
        key,
        sha256(await readFile(join(root, relativePath), "utf8")),
      ]),
    ),
  );
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("R-ICL v4 read-only adapter", () => {
  it("detects the authoritative current/worklog boundary and normalizes it conservatively", async () => {
    const root = await createFixture();
    const detected = detectRiclV4(root);
    assert.equal(detected.available, true);
    assert.equal(detected.adapter, RICL_V4_ADAPTER_VERSION);

    const before = await sourceHashes(root);
    const source = loadRiclV4(root);
    const after = await sourceHashes(root);
    assert.deepEqual(after, before);

    assert.equal(source.projectId, "RICL-V4-MEDICAL-ASSISTANT");
    assert.match(source.projectTitle, /R-ICL v4\.0/);
    assert.equal(source.sourceSnapshot.length, Object.keys(RICL_V4_FILES).length);
    assert.equal(source.authority.machineStatus, "INCOMPLETE");
    assert.equal(source.authority.humanStatus, "NOT_NEEDED");
    assert.equal(source.escalationRequests.length, 0);
    assert.ok(source.machineResults[0].facts.some((fact) => fact.status === "SELF_REPORTED"));
    assert.ok(source.machineResults[0].facts.some((fact) => fact.status === "VERIFIED"));
    assert.equal(source.machineResults[0].verdict, "INCOMPLETE");
    assert.ok(source.sourceSnapshot.every((ref) => !ref.pointer.startsWith("05_") && !ref.pointer.startsWith("90_")));
  });

  it("builds a generic HPS and /talk view without TS-001 wording or a fabricated decision", async () => {
    const root = await createFixture();
    const source = loadRiclV4(root);
    const projection = projectSource(source);
    const rebuilt = rebuildProjectProjection(root);
    const content = buildTalkContent(projection);

    assert.equal(rebuilt.hps.projectionId, projection.hps.projectionId);
    assert.equal(projection.adapter, RICL_V4_ADAPTER_VERSION);
    assert.equal(projection.hps.phase, "MACHINE_VALIDATION");
    assert.equal(projection.hps.activeWork[0].machineStatus, "INCOMPLETE");
    assert.equal(projection.hps.activeWork[0].humanStatus, "NOT_NEEDED");
    assert.match(content.project.title, /R-ICL v4\.0/);
    assert.equal(content.meta.adapter, RICL_V4_ADAPTER_VERSION);
    assert.doesNotMatch(JSON.stringify(content), /TS-001/);
    assert.equal(content.decision, null);
    assert.match(content.l0.current, /已停机/);
    assert.doesNotMatch(content.l0.current, /90_工作底稿_raw|\.md/);
    assert.ok(content.l0.current.length < 80);
    assert.ok(content.l1.verified.some((line) => /90_工作底稿_raw\/fixture\.md/.test(line)));
    assert.ok(content.l1.remaining.some((line) => /HandoffBundle|ResultBundle/.test(line)));
  });

  it("is selected by the project adapter registry and fails closed outside supported roots", async () => {
    const root = await createFixture();
    const detected = detectProjectAdapter(root);
    assert.equal(detected.available, true);
    assert.equal(detected.adapter, RICL_V4_ADAPTER_VERSION);
    assert.equal(loadProjectSource(root).adapter, RICL_V4_ADAPTER_VERSION);

    const missing = detectProjectAdapter(join(root, "missing"));
    assert.equal(missing.available, false);
    assert.throws(() => loadProjectSource(join(root, "missing")), /no supported HPI adapter/);
  });

});
