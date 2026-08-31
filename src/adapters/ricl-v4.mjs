import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { SCHEMAS, deriveMachineVerdict, validateMachineResult } from "../contracts.mjs";
import {
  NORMALIZED_SOURCE_SCHEMA,
  computeSourceDigest,
  createSourceRef,
  validateNormalizedSourceEnvelope,
} from "./contract.mjs";

export const RICL_V4_ADAPTER_VERSION = "ricl-v4-readonly/0.1.0";
export const RICL_V4_PROJECT_ID = "RICL-V4-MEDICAL-ASSISTANT";

export const RICL_V4_FILES = Object.freeze({
  rootReadme: "README.md",
  current: "04_长期运行系统/04_00_索引/04_索引_当前.md",
  authority: "04_长期运行系统/04_02_制度/04_制度_01_权威与当前/04_制度_权威与当前_正文.md",
  worklogContract: "04_长期运行系统/04_02_制度/04_制度_05_worklog/04_制度_worklog_短合同.md",
  worklogProject: "04_长期运行系统/04_02_制度/04_制度_05_worklog/04_制度_worklog_项目文档.md",
  worklogHead: "04_长期运行系统/04_03_运行/worklog/HEAD.md",
  worklogLog: "04_长期运行系统/04_03_运行/worklog/LOG.md",
});

const SOURCE_IDENTITIES = Object.freeze({
  rootReadme: ["RICL-V4-ROOT", "v4.0"],
  current: ["RICL-V4-CURRENT", "current"],
  authority: ["RICL-V4-AUTHORITY", "v1.1"],
  worklogContract: ["RICL-V4-WORKLOG-CONTRACT", "v1.0"],
  worklogProject: ["RICL-V4-WORKLOG-PROJECT", "v1.0"],
  worklogHead: ["RICL-V4-WORKLOG-HEAD", "generated"],
  worklogLog: ["RICL-V4-WORKLOG-LOG", "append-only"],
});

export class RiclAdapterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RiclAdapterError";
    this.details = details;
  }
}

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || target)
    .replace(/[*`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function section(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^##[ \\t]+${escaped}[ \\t]*$`, "mu").exec(markdown);
  if (!match) throw new RiclAdapterError(`required section is missing: ${heading}`);
  const tail = markdown.slice(match.index + match[0].length);
  const nextHeading = /^##[ \t]+/mu.exec(tail);
  return tail.slice(0, nextHeading?.index ?? tail.length).trim();
}

function firstParagraph(markdown, name) {
  const paragraph = markdown
    .split(/\n\s*\n/u)
    .map(stripMarkdown)
    .find((entry) => entry && !entry.startsWith("---"));
  if (!paragraph) throw new RiclAdapterError(`${name} has no readable paragraph`);
  return paragraph;
}

function headValue(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}：(.+)$`, "mu").exec(markdown);
  if (!match) throw new RiclAdapterError(`worklog HEAD is missing ${label}`);
  return stripMarkdown(match[1]);
}

function lastLogEvent(markdown) {
  const headings = [...markdown.matchAll(/^##[ \t]+(.+)$/gmu)];
  if (headings.length === 0) throw new RiclAdapterError("worklog LOG has no typed events");
  const last = headings.at(-1);
  const body = markdown.slice(last.index + last[0].length);
  const state = /^-[ \t]+状态变化：(.+)$/mu.exec(body)?.[1];
  const summary = /^-[ \t]+做了 \/ 停在 \/ 下一步 \/ 未决：(.+)$/mu.exec(body)?.[1];
  return {
    heading: stripMarkdown(last[1]),
    state: stripMarkdown(state || "未声明状态变化"),
    summary: stripMarkdown(summary || "未声明终态摘要"),
  };
}

function requireMaterialBoundary(texts) {
  if (!/唯一的「当前」指针|唯一「当前」指针|全树只允许一份/u.test(texts.current)) {
    throw new RiclAdapterError("current pointer does not declare its unique authority boundary");
  }
  if (!/全树恰一个活 worklog|唯一活对象/u.test(texts.worklogContract)) {
    throw new RiclAdapterError("worklog contract does not declare one live worklog boundary");
  }
  if (!/中间失忆/u.test(texts.worklogProject) || !/多份 worklog \/ 权威打架/u.test(texts.worklogProject)) {
    throw new RiclAdapterError("worklog project document does not expose the expected pains");
  }
}

function refsFor(texts) {
  return Object.fromEntries(
    Object.entries(RICL_V4_FILES).map(([key, pointer]) => {
      const [id, revision] = SOURCE_IDENTITIES[key];
      return [key, createSourceRef({ id, revision, text: texts[key], pointer })];
    }),
  );
}

export function normalizeRiclV4({ texts }) {
  if (!texts || typeof texts !== "object" || Array.isArray(texts)) {
    throw new RiclAdapterError("texts must be an object keyed by RICL_V4_FILES");
  }
  for (const key of Object.keys(RICL_V4_FILES)) {
    if (typeof texts[key] !== "string") throw new RiclAdapterError(`texts.${key} is required`);
  }
  requireMaterialBoundary(texts);

  const refs = refsFor(texts);
  const sourceSnapshot = Object.values(refs);
  const sourceDigest = computeSourceDigest(RICL_V4_ADAPTER_VERSION, sourceSnapshot);
  const currentNow = firstParagraph(section(texts.current, "现在在做什么"), "current.now");
  const currentNext = firstParagraph(section(texts.current, "下一步"), "current.next");
  const currentNonGoals = section(texts.current, "现在不做什么")
    .split("\n")
    .map((line) => stripMarkdown(line.replace(/^-[ \t]*/u, "")))
    .filter(Boolean);
  const headNow = headValue(texts.worklogHead, "现在");
  const headlineNow =
    headNow.replace(/\s*[（(][^）)]*(?:\/|\.md)[^）)]*[）)]\s*$/u, "").trim() || headNow;
  const headBlocker = headValue(texts.worklogHead, "阻塞");
  const headNext = headValue(texts.worklogHead, "下一步");
  const latestEvent = lastLogEvent(texts.worklogLog);

  const facts = [
    {
      id: "FACT-RICL-CURRENT-POINTER",
      kind: "FILE",
      statement: "已读取 R-ICL v4.0 唯一当前指针及其权威制度文件。",
      status: "VERIFIED",
      evidenceRefs: [refs.current, refs.authority],
    },
    {
      id: "FACT-RICL-WORKLOG-HEAD",
      kind: "FILE",
      statement: `worklog HEAD 快照：现在=${headNow}；阻塞=${headBlocker}；下一步=${headNext}。`,
      status: "VERIFIED",
      evidenceRefs: [refs.worklogHead, refs.worklogContract],
    },
    {
      id: "FACT-RICL-LATEST-EVENT",
      kind: "OTHER",
      statement: `最新类型化事件：${latestEvent.heading}；${latestEvent.state}。`,
      status: "VERIFIED",
      evidenceRefs: [refs.worklogLog],
    },
    {
      id: "FACT-RICL-CURRENT-COMPLETION-CLAIM",
      kind: "OTHER",
      statement: `当前指针材料声明：${currentNow}`,
      status: "SELF_REPORTED",
      evidenceRefs: [refs.current],
    },
  ];
  const machineResult = {
    schema: SCHEMAS.machineResult,
    resultId: "MR-RICL-V4-MATERIAL-SNAPSHOT",
    taskId: "RICL-V4-CURRENT",
    attemptId: "material-snapshot",
    sourceRef: refs.current,
    verdict: deriveMachineVerdict({
      authoritativeVerdict: "INCOMPLETE",
      claimedVerdict: /PASS|已完成|终态/u.test(currentNow) ? "PASS-ENGINEERING" : "INCOMPLETE",
      facts,
    }),
    facts,
    limitations: [
      "R-ICL Adapter 只读取唯一当前指针、权威制度和活 worklog；不运行项目门禁或测试。",
      "当前材料中的 PASS、已完成或学生接受是来源文本声明，不自动成为 HPI PASS-ENGINEERING 或 HumanResult。",
      "当前权威路径没有可供本 Adapter 消费的结构化 HandoffBundle、ResultBundle、MachineResult 或 HumanResult。",
    ],
    unresolved: [
      "冻结正式跨项目 JSON Schema 后，映射结构化 Handoff、Result、Evidence、revision 和 retry。",
      "用真实跨会话任务验证 why、change、remaining 和 next 的恢复体验。",
    ],
  };
  validateMachineResult(machineResult);

  const normalized = {
    schema: NORMALIZED_SOURCE_SCHEMA,
    adapter: RICL_V4_ADAPTER_VERSION,
    projectId: RICL_V4_PROJECT_ID,
    projectTitle: "R-ICL v4.0 · HPI 只读项目重入",
    sourceSnapshot,
    sourceDigest,
    authority: {
      machineStatus: machineResult.verdict,
      humanStatus: "NOT_NEEDED",
    },
    brief: {
      headline: `R-ICL v4.0 当前${headlineNow}；HPI 尚未消费结构化运行结果。`,
      next: {
        statement: `当前权威 HEAD：下一步=${headNext}。`,
        reason: "HPI 只复述当前指针与 worklog；开启新专项前应先由 R-ICL 既有治理更新权威状态。",
      },
    },
    intent: {
      statement: "保持 R-ICL v4.0 的研究连续性，并由唯一当前指针与唯一活 worklog 分离定义状态和过程事实。",
      sourceRef: refs.rootReadme,
    },
    pains: [
      {
        id: "P-RICL-CONTINUITY",
        statement: "长程研究存在中间失忆、日志无限膨胀和停机状态脱节。",
        status: "PARTIAL",
        remainingGap: "尚未用 HPI 真实跨会话体验验证人能否快速恢复 why/change/remaining/next。",
        sourceRef: refs.worklogProject,
      },
      {
        id: "P-RICL-AUTHORITY",
        statement: "多份 worklog 或多个当前入口会造成权威打架。",
        status: "SOLVED_PENDING_CONFIRMATION",
        remainingGap: "Adapter 只读映射已建立；仍需在来源 revision 变化时验证 stale 传播。",
        sourceRef: refs.authority,
      },
    ],
    designPoints: [
      {
        id: "D-RICL-SINGLE-CURRENT",
        statement: "项目状态只认唯一当前指针；正文自称不能取得当前权威。",
        sourceRef: refs.authority,
      },
      {
        id: "D-RICL-SINGLE-WORKLOG",
        statement: "过程事实只认唯一活 worklog，HEAD/LOG/COMPACT 各自承担生成、追加和折叠职责。",
        sourceRef: refs.worklogContract,
      },
      {
        id: "D-RICL-READONLY-HPI",
        statement: "HPI 是来源带 SHA 的只读投影，不调用 fs_new/fs_index/worklog append，也不写 R-ICL canonical。",
        sourceRef: refs.current,
      },
    ],
    activeWork: [
      {
        taskId: "RICL-V4-CURRENT",
        whyNow: currentNow,
        painRefs: ["P-RICL-CONTINUITY", "P-RICL-AUTHORITY"],
        designRefs: ["D-RICL-SINGLE-CURRENT", "D-RICL-SINGLE-WORKLOG", "D-RICL-READONLY-HPI"],
        machineStatus: machineResult.verdict,
        humanStatus: "NOT_NEEDED",
        latestChange: `${latestEvent.heading}：${latestEvent.state}；${latestEvent.summary}`,
        resultRef: refs.current,
      },
    ],
    machineResults: [machineResult],
    escalationRequests: [],
    unresolved: [
      {
        id: "U-RICL-TYPED-BUNDLES",
        statement: "当前权威路径尚无可直接消费的结构化 HandoffBundle / ResultBundle / MachineResult / HumanResult。",
        sourceRef: refs.worklogContract,
      },
      {
        id: "U-RICL-CURRENT-LOCKS",
        statement: currentNonGoals.join("；") || "当前指针没有列出非目标。",
        sourceRef: refs.current,
      },
    ],
    risks: [
      "当前指针中的 PASS/完成文本不得自动提升为 HPI PASS-ENGINEERING。",
      "worklog 是过程事实，不批准科学结论，也不替代正式 HumanResult。",
      "R-ICL 工作树可能存在外部并发变化；每次查询必须重新读取并绑定 sourceDigest。",
    ],
    outOfScope: [
      "修改 R-ICL 当前指针、worklog、索引、库.json 或任何 canonical 文件",
      "执行 R-ICL 生成器、门禁、测试或 Git 操作",
      "从 05_草稿箱或 90_工作底稿_raw 推断当前权威",
      "消费尚未冻结的 Handoff / Result / Evidence 正式协议",
      `来源文本的当前下一步原文：${currentNext}`,
    ],
  };
  validateNormalizedSourceEnvelope(normalized);
  return normalized;
}

export function detectRiclV4(projectRoot) {
  const root = resolve(projectRoot);
  const paths = Object.fromEntries(
    Object.entries(RICL_V4_FILES).map(([key, pointer]) => [key, join(root, pointer)]),
  );
  const missing = Object.entries(paths)
    .filter(([, path]) => !existsSync(path))
    .map(([key]) => RICL_V4_FILES[key]);
  return {
    available: missing.length === 0,
    root,
    paths,
    missing,
    adapter: RICL_V4_ADAPTER_VERSION,
  };
}

export function loadRiclV4(projectRoot) {
  const detected = detectRiclV4(projectRoot);
  if (!detected.available) {
    throw new RiclAdapterError("R-ICL v4 read-only adapter is unavailable", {
      projectRoot: detected.root,
      missing: detected.missing,
    });
  }
  const texts = Object.fromEntries(
    Object.entries(detected.paths).map(([key, path]) => [key, readFileSync(path, "utf8")]),
  );
  return normalizeRiclV4({ texts });
}
