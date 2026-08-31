import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  SCHEMAS,
  deriveMachineVerdict,
  sha256,
  validateEscalationRequest,
  validateMachineResult,
} from "./contracts.mjs";
import {
  NORMALIZED_SOURCE_SCHEMA,
  computeSourceDigest,
  createSourceRef,
  validateNormalizedSourceEnvelope,
} from "./adapters/contract.mjs";

export const TS001_ADAPTER_VERSION = "ts001-pilot/0.1.0";
export const TS001_PROJECT_ID = "HPI-TS001-PILOT";

export const TS001_FILES = Object.freeze({
  contract: "09_TS001_测试与回滚验收.md",
  prd: "human-project-interaction-skills-prd.md",
  technicalDesign: "human-project-interaction-skills-technical-design.md",
});

export class AdapterError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AdapterError";
    this.details = details;
  }
}

function parseScalar(text) {
  const value = text.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return value;
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    return body.split(",").map((entry) => parseScalar(entry));
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseFrontmatter(markdown, pointer = "markdown") {
  if (typeof markdown !== "string") throw new AdapterError(`${pointer}: expected markdown text`);
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new AdapterError(`${pointer}: YAML frontmatter is required`);
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new AdapterError(`${pointer}: YAML frontmatter is not closed`);
  const frontmatter = {};
  for (const [index, line] of normalized.slice(4, end).split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const split = line.indexOf(":");
    if (split < 1) throw new AdapterError(`${pointer}: unsupported frontmatter line ${index + 1}`);
    const key = line.slice(0, split).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new AdapterError(`${pointer}: invalid frontmatter key ${key}`);
    if (Object.hasOwn(frontmatter, key)) throw new AdapterError(`${pointer}: duplicate frontmatter key ${key}`);
    frontmatter[key] = parseScalar(line.slice(split + 1));
  }
  return {
    data: frontmatter,
    body: normalized.slice(end + 5),
  };
}

function requiredFrontmatter(data, keys, pointer) {
  for (const key of keys) {
    if (data[key] === undefined || data[key] === "") {
      throw new AdapterError(`${pointer}: missing frontmatter field ${key}`);
    }
  }
}

function sourceRef({ id, revision, text, pointer }) {
  return createSourceRef({ id, revision, text, pointer });
}

function normalizedSelfReport(report, index) {
  const statement = typeof report === "string" ? report.trim() : String(report?.statement ?? "").trim();
  if (!statement) throw new AdapterError(`selfReports[${index}]: statement is required`);
  const digest = sha256(statement);
  const ref = {
    id: `SELF-REPORT-${digest.slice(0, 16).toUpperCase()}`,
    revision: "unverified",
    sha256: digest,
    pointer: "agent self-report input",
  };
  return { statement, ref };
}

function makeEscalationRequest({ contractRef, prdRef, sourceDigest }) {
  const base = {
    schema: SCHEMAS.escalationRequest,
    projectId: TS001_PROJECT_ID,
    category: "DESIGN",
    decisionUnit: "freeze-contract-baseline-before-runtime",
    question: "你是否接受先固定合同与测试基线，再进入 runtime 实现？",
    facts: [
      {
        statement: "TS-001 的权威合同状态是 NOT-RUN。",
        sourceRef: contractRef,
        evidenceStatus: "NOT_RUN",
      },
      {
        statement: "当前切片不实现 filesystem gate、完整 Run、Evidence / Claim runtime 或真实实验数据。",
        sourceRef: contractRef,
        evidenceStatus: "VERIFIED",
      },
    ],
    options: [
      {
        optionId: "accept-baseline-first",
        label: "接受该设计路线",
        consequence: "保持 TS-001 为合同与测试基线，后续另行进入 runtime。",
        risk: "这不产生 PASS-ENGINEERING，也不批准 canonical 入库。",
        reversible: true,
      },
      {
        optionId: "request-route-change",
        label: "要求调整路线",
        consequence: "保持 HUMAN_PENDING，并先修改设计或范围。",
        risk: "runtime 实现继续暂停。",
        reversible: true,
      },
    ],
    recommendation: "接受基线优先路线，但明确保留机器状态 NOT-RUN。",
    safeDefault: "NO_STATE_CHANGE",
    affectedRefs: [contractRef, prdRef],
    oneQuestion: true,
    sourceDigest,
  };
  const requestDigest = sha256(base);
  const request = {
    ...base,
    requestId: `ER-TS001-DESIGN-${requestDigest.slice(0, 12).toUpperCase()}`,
    requestDigest,
  };
  delete request.sourceDigest;
  validateEscalationRequest(request);
  return request;
}

export function normalizeTs001Pilot({
  contractText,
  prdText,
  technicalDesignText,
  pointers = TS001_FILES,
  selfReports = [],
}) {
  const contract = parseFrontmatter(contractText, pointers.contract);
  const prd = parseFrontmatter(prdText, pointers.prd);
  const technicalDesign = parseFrontmatter(technicalDesignText, pointers.technicalDesign);

  requiredFrontmatter(contract.data, ["contract_id", "revision", "status", "test_status"], pointers.contract);
  requiredFrontmatter(prd.data, ["document_id", "revision", "status"], pointers.prd);
  requiredFrontmatter(technicalDesign.data, ["document_id", "revision", "status"], pointers.technicalDesign);

  if (contract.data.contract_id !== "TS1-TEST-001") {
    throw new AdapterError(`${pointers.contract}: unsupported contract_id ${contract.data.contract_id}`);
  }
  if (contract.data.test_status !== "NOT-RUN") {
    throw new AdapterError(
      `${pointers.contract}: pilot requires authoritative test_status NOT-RUN, got ${contract.data.test_status}`,
      { expected: "NOT-RUN", actual: contract.data.test_status },
    );
  }
  if (!/所有用例当前为\s*`NOT-RUN`/.test(contract.body)) {
    throw new AdapterError(`${pointers.contract}: body/frontmatter NOT-RUN boundary is incomplete`);
  }
  if (prd.data.status !== "proposed" || technicalDesign.data.status !== "proposed") {
    throw new AdapterError("PRD and technical design must remain proposed inputs for this pilot");
  }

  const contractRef = sourceRef({
    id: contract.data.contract_id,
    revision: contract.data.revision,
    text: contractText,
    pointer: pointers.contract,
  });
  const prdRef = sourceRef({
    id: prd.data.document_id,
    revision: prd.data.revision,
    text: prdText,
    pointer: pointers.prd,
  });
  const technicalDesignRef = sourceRef({
    id: technicalDesign.data.document_id,
    revision: technicalDesign.data.revision,
    text: technicalDesignText,
    pointer: pointers.technicalDesign,
  });
  const sourceSnapshot = [contractRef, prdRef, technicalDesignRef].sort((left, right) =>
    `${left.id}@${left.revision}`.localeCompare(`${right.id}@${right.revision}`),
  );
  const sourceDigest = computeSourceDigest(TS001_ADAPTER_VERSION, sourceSnapshot);

  const reports = selfReports.map(normalizedSelfReport);
  const facts = [
    {
      id: "FACT-TS001-AUTHORITATIVE-NOT-RUN",
      kind: "TEST",
      statement: "TS-001 四组工程用例尚未运行。",
      status: "NOT_RUN",
      evidenceRefs: [contractRef],
    },
    ...reports.map((report, index) => ({
      id: `FACT-TS001-SELF-REPORT-${String(index + 1).padStart(3, "0")}`,
      kind: /hash|sha|哈希/i.test(report.statement) ? "HASH" : "TEST",
      statement: report.statement,
      status: "SELF_REPORTED",
      evidenceRefs: [report.ref],
    })),
  ];
  const machineResult = {
    schema: SCHEMAS.machineResult,
    resultId: "MR-TS001-CURRENT-MATERIAL",
    taskId: "TS001-IMPL",
    attemptId: "attempt-not-run",
    sourceRef: contractRef,
    verdict: deriveMachineVerdict({
      authoritativeVerdict: contract.data.test_status,
      claimedVerdict: reports.length > 0 ? "PASS-ENGINEERING" : "NOT-RUN",
      facts,
    }),
    facts,
    limitations: [
      "当前材料没有四组用例的实际命令、环境、输入/日志 SHA、退出码和起止时间。",
      "PRD 与技术设计仍为 proposed；它们不证明 runtime、Harness 或多 Agent 闭环已经实现。",
      "HPI 只读 adapter 不执行 TS-001，也不修改 canonical。",
    ],
    unresolved: [
      "执行并独立复核 TS-001 的 Schema、Permission / Reference、Idempotency、Rollback 四组用例。",
      "后续另行实现 filesystem gate、Run、Evidence / Claim 和 Research Event runtime。",
    ],
  };
  validateMachineResult(machineResult);

  const escalationRequest = makeEscalationRequest({ contractRef, prdRef, sourceDigest });

  const normalized = {
    schema: NORMALIZED_SOURCE_SCHEMA,
    adapter: TS001_ADAPTER_VERSION,
    projectId: TS001_PROJECT_ID,
    projectTitle: "Human Project Interaction · TS-001 试点",
    sourceSnapshot,
    sourceDigest,
    authority: {
      machineStatus: machineResult.verdict,
      humanStatus: "HUMAN_PENDING",
    },
    brief: {
      headline: "TS-001 当前是合同与测试基线；工程测试仍为 NOT-RUN。",
      next: {
        statement: "先判断是否接受合同基线优先的设计路线。",
        reason: "只有设计路线明确后，才值得进入后续 runtime；该判断不会改变机器测试状态。",
      },
    },
    intent: {
      statement: "在进入 runtime 前，先固定 Agent 协作、测试和回滚的合同基线。",
      sourceRef: prdRef,
    },
    pains: [
      {
        id: "P-HPI-001",
        statement: "人在多 Agent、跨会话项目中逐渐失去项目整体认知，只能充当信息管道。",
        status: "PARTIAL",
        remainingGap: "尚未用真实长程项目验证用户能否低成本重新进入并持续参与设计判断。",
        sourceRef: prdRef,
      },
      {
        id: "P-HPI-002",
        statement: "机器可验证的测试、hash 和证据链被错误转嫁给人签字。",
        status: "SOLVED_PENDING_CONFIRMATION",
        remainingGap: "需用 TS-001 负向测试与真实交互验证升级门。",
        sourceRef: prdRef,
      },
    ],
    designPoints: [
      {
        id: "D-HPI-DUAL-STATUS",
        statement: "Machine Result 与 Human Result 使用相互独立的状态轴。",
        sourceRef: technicalDesignRef,
      },
      {
        id: "D-HPI-PROJECTION",
        statement: "Human Project State 是可重建投影，不是第二真源。",
        sourceRef: technicalDesignRef,
      },
      {
        id: "D-HPI-ESCALATION",
        statement: "机器事实不升级；人类只判断目标、范围、设计、风险和语义结果。",
        sourceRef: technicalDesignRef,
      },
    ],
    activeWork: [
      {
        taskId: "TS001-IMPL",
        whyNow: "在 runtime 前先冻结 Schema、权限/引用、幂等和回滚语义。",
        painRefs: ["P-HPI-002"],
        designRefs: ["D-HPI-DUAL-STATUS", "D-HPI-ESCALATION"],
        machineStatus: machineResult.verdict,
        humanStatus: "HUMAN_PENDING",
        latestChange: "合同与设计材料已形成；当前材料仍明确标记测试 NOT-RUN。",
        resultRef: contractRef,
      },
    ],
    machineResults: [machineResult],
    escalationRequests: [escalationRequest],
    unresolved: [
      {
        id: "U-TS001-RUN",
        statement: "TS-001 四组工程测试仍未运行。",
        sourceRef: contractRef,
      },
      {
        id: "U-HPI-REAL-PROJECT",
        statement: "尚未完成真实项目的跨会话人类重新进入验收。",
        sourceRef: prdRef,
      },
    ],
    risks: [
      "Human Brief 可能过度压缩，必须始终显示 NOT-RUN、remaining 和风险。",
      "候选决策事件不等于 canonical HumanResult。",
    ],
    outOfScope: [
      "完整 multi-Agent dispatch / Handoff runtime",
      "filesystem permission gate 与 canonical transaction",
      "Run / Evidence / Claim / Research Event runtime",
      "真实 TS-001 测试执行及 PASS-ENGINEERING",
    ],
  };
  validateNormalizedSourceEnvelope(normalized);
  return normalized;
}

export function detectTs001Pilot(projectRoot) {
  const root = resolve(projectRoot);
  const paths = Object.fromEntries(
    Object.entries(TS001_FILES).map(([key, filename]) => [key, join(root, filename)]),
  );
  const missing = Object.entries(paths)
    .filter(([, path]) => !existsSync(path))
    .map(([key]) => TS001_FILES[key]);
  return {
    available: missing.length === 0,
    root,
    paths,
    missing,
    adapter: TS001_ADAPTER_VERSION,
  };
}

export function loadTs001Pilot(projectRoot, options = {}) {
  const detected = detectTs001Pilot(projectRoot);
  if (!detected.available) {
    throw new AdapterError("TS-001 pilot adapter is unavailable", {
      projectRoot: detected.root,
      missing: detected.missing,
    });
  }
  return normalizeTs001Pilot({
    contractText: readFileSync(detected.paths.contract, "utf8"),
    prdText: readFileSync(detected.paths.prd, "utf8"),
    technicalDesignText: readFileSync(detected.paths.technicalDesign, "utf8"),
    pointers: TS001_FILES,
    selfReports: options.selfReports ?? [],
  });
}
