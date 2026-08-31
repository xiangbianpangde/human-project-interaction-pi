---
title: 多 Agent / 长程项目人类交互 Skill 技术设计
document_id: HPI-TD-001
revision: 0.1
status: proposed
created: 2026-08-30
language: zh-CN
scope: 设计阶段，不代表已经实现或部署
---

# 多 Agent / 长程项目人类交互 Skill

## 技术设计文档

## 0. 设计状态与证据边界

本文件把 PRD 转化为可实现的 Skill / Harness 设计，但仍是 proposed，不是实现授权。

证据标签与 PRD 相同：

- **[M] 材料事实**：用户描述和用户上传的 TS-001 文件中的事实；
- **[E] 外部调研结论**：公开标准、论文、政府指南和官方工程资料；
- **[D] 设计推导**：本文件提出的协议、结构、状态和实现方案。

设计时必须保持以下事实边界：

1. TS-001 文件当前的 test_status 是 NOT-RUN。[M]
2. TS-001 的范围是合同、纯数据 fixture、提交流程和回滚验收，不是完整实验 Agent runtime。[M]
3. TS-001 明确要求 PASS-ENGINEERING 不能替代用户另行完成人类验收，也不能产生科学或临床主张。[M]
4. 本设计中的 Human Project State、Human Brief、Human Escalation Gate 和双层结果是待实现的设计对象。[D]

## 1. 设计结论

### 1.1 核心分工

HPI Skill 与 Harness 组成一个薄的、可插拔的人类交互层：

- **人类**维护目的、问题、优先级、设计语义、风险取舍和“是否解决痛点”的判断；
- **Agent**在冻结边界内计划、实现、验证和报告；
- **Harness**以确定性方式维护身份、版本、权限、事务、证据、状态和恢复；
- **HPI Skill**读取结构化状态，生成适合人的 progressive disclosure 视图，并阻止无意义的人工升级；
- **Note / Memory / Retrieval**分别承担内容捕获、关联召回和查询辅助，不拥有项目的定义性状态。[D]

### 1.2 最重要的禁止事项

系统不得：

1. 把 Agent 之间的聊天摘要当作任务身份、版本或授权；
2. 把自报测试结果当作 Harness 权威结果；
3. 把机器可验证事实变成“请用户相信”的问题；
4. 把 Human Brief 作为可直接编辑的状态真源；
5. 从“好的”“可以”“看起来没问题”等模糊自然语言自动推断人类接受；
6. 让 Skill 直接写入 canonical state；
7. 让实现 Agent 自己批准自己的结果；
8. 让恢复、重试或回滚覆盖原始记录；
9. 因为结果是 OUT_OF_SCOPE 或 NOT-RUN 就报告问题已经解决；
10. 把测试 workspace、日志、索引或合成 fixture 当作科学状态。

### 1.3 设计原则

确定性规则负责定义性问题，模型负责解释和提出候选：

    Harness Core:
    identity + schema + permission + revision + transaction
    + evidence status + idempotency + reconciliation

    HPI Skill:
    semantic classification + brief rendering
    + progressive disclosure + human question drafting

    Human:
    intent + scope + design + risk + semantic outcome

如果模型的判断与结构化事实冲突，结构化事实和 Gate 优先，系统停止或标记不完整。[D]

## 2. 范围和系统上下文

### 2.1 系统边界

    ┌──────────────────────────────────────────────────────────┐
    │ 人类项目负责人                                          │
    │ 目标、Pain、Design、风险、语义结果、明确人类决定         │
    └──────────────────────────┬───────────────────────────────┘
                               │ brief / one decision
    ┌──────────────────────────▼───────────────────────────────┐
    │ HPI Skill                                                │
    │ project-open / brief / explain / escalate / new-pain     │
    │ 语义分类、摘要、按需展开；不拥有 canonical 写权限       │
    └──────────────────────────┬───────────────────────────────┘
                               │ typed protocol
    ┌──────────────────────────▼───────────────────────────────┐
    │ Project Coordinator / Steward Agent                      │
    │ 任务分解、角色编排、结果汇总、生成候选状态更新             │
    │ 不把自报内容写成权威状态                                │
    └───────────────┬──────────────────────┬────────────────────┘
                    │                      │
          ┌─────────▼─────────┐  ┌─────────▼─────────┐
          │ Implementation    │  │ Validation        │
          │ Agent             │  │ Agent             │
          │ TaskSlice         │  │ 独立验证与偏差     │
          └─────────┬─────────┘  └─────────┬─────────┘
                    │ ResultBundle         │ ValidationResult
                    └──────────────┬───────┘
                                   │
    ┌──────────────────────────────▼────────────────────────────┐
    │ Harness Core                                               │
    │ Hook → Gate → append-only event → Reconciler → projection  │
    │ 身份、版本、权限、幂等、证据、事务、恢复、provenance      │
    └──────────────┬──────────────────────────────┬─────────────┘
                   │                              │
         ┌─────────▼─────────┐          ┌─────────▼─────────┐
         │ canonical / events │          │ artifacts /       │
         │ immutable records  │          │ workspace         │
         └─────────┬─────────┘          └─────────┬─────────┘
                   │                              │
                   └──────────────┬───────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │ HPS / Human Brief / index │
                    │ 可追溯的派生投影           │
                    └───────────────────────────┘

这不是要求所有项目采用同一个目录或数据库。它是逻辑分层；具体 adapter 必须映射到宿主项目已有的真源。[D]

### 2.2 现有项目适配约束

如果宿主项目已经存在 canonical state、current pointer、Worklog、Registry 或 Wiki：

- HPI Skill 读取并引用宿主项目的既有真源；
- Human Project State 是带 source revision 的 materialized view，不是第二个 current view；
- Human Brief 是更上层的展示投影；
- 新事件通过宿主项目定义的 Harness / Gate 进入；
- 不因为引入 HPI Skill 而新建平行 worklog、registry、Wiki 或研究树；
- 如果没有可用的结构化真源，先标记 proposed / unverified，不用摘要代替真源。[D]

## 3. 组件与权威矩阵

| 组件 | 主要责任 | 可写对象 | 权威级别 |
|---|---|---|---|
| HPI Skill | 读取、分类、呈现、提出窄问题 | 只提交候选事件或 Human Decision 请求 | 非权威 |
| Harness Core | schema、身份、权限、revision、事务、幂等、事件、provenance | 受 Gate 保护的 canonical / event store | 权威执行层 |
| Reconciler | 检测状态、hash、引用、索引和事件之间的漂移 | 产生 reconciliation report；不得静默修复语义冲突 | 权威检查层 |
| Coordinator | 分解任务、选择角色、汇总结果、草拟 brief | 提交候选状态变更 | 受限代理 |
| Implementation Agent | 完成实现 | 受限 workspace / branch / artifact | 只对自报结果负责 |
| Validation Agent | 独立验证 | Validation Result、证据指针 | 只对验证结果负责 |
| Human Project State | 由事件和状态生成的项目视图 | 由 projector 重建 | 派生投影 |
| Human Brief | 语义化摘要 | 由结构化状态生成 | 派生投影 |
| Note Skill | 内容捕获和组织 | Note 内容 | 非项目权威 |
| Memory Skill | 关联、回忆、未来提醒 | Memory 条目 | 非项目权威 |
| Retrieval Skill | 检索候选上下文 | 检索结果 | 非证据真源 |
| Agent chat | 临时交流 | 不直接产生状态 | 非权威 |

## 4. 核心数据层

### 4.1 五类逻辑数据

1. **Canonical state / events**：定义性状态和经过 Gate 的状态转换；
2. **Immutable records**：TaskSlice、Handoff、Result、Human Decision、Validation 和回滚记录；
3. **Artifacts**：代码、文档、fixture、测试日志、报告和外部资料快照；
4. **Workspace**：Agent 执行目录和临时状态；
5. **Derived views**：Human Project State、Human Brief、索引、追踪图。

Derived view 可以删除后重建。Immutable record 不应被覆盖。Canonical state 的语义修改使用新 revision。[D]

### 4.2 对象关系

    Pain
      └── Requirement
            └── DesignDecision
                  └── Capability
                        └── TaskSlice
                              ├── HandoffBundle
                              ├── MachineResult
                              │     ├── TestRun
                              │     └── Evidence
                              └── HumanBrief
                                      └── HumanResult（仅必要时）

所有对象带稳定 ID；展示名称、slug 或文件路径不能替代逻辑 ID。

## 5. 输入输出协议

以下是 v0.1 的最小协议形状，不是最终 JSON Schema。正式实现前应先固化 schema、枚举、必填字段、负向测试和兼容策略。

### 5.1 ProjectIntent

    project_id:
    intent_id:
    revision:
    statement:
    success_meaning:
    non_goals:
    scope:
    owner:
    source:
      type: user_statement
      pointer:
      captured_at:
    status: proposed | accepted | superseded

只有明确的人类事件才能把 intent 从 proposed 变成 accepted。模型可提出改写，但不能自行接受。[D]

### 5.2 Pain

    pain_id:
    revision:
    statement:
    observable_trigger:
    affected_role:
    severity:
    current_status: open | partial | solved | needs_review | out_of_scope
    evidence_refs:
    related_requirements:
    human_decision_refs:
    last_changed_by:
    supersedes:

“solved”需要语义验收证据，不能因为某个 TaskSlice PASS-ENGINEERING 就自动设置。[D]

### 5.3 TaskSlice

    task_id:
    revision:
    title:
    objective:
    pain_refs:
    requirement_refs:
    design_refs:
    non_goals:
    allowed_paths:
    forbidden_paths:
    input_refs:
    input_sha:
    shared_contract_ref:
    acceptance:
    failure_semantics:
    rollback:
    assigned_roles:
      implementation:
      validation:
    machine_status: proposed
    human_status: not_needed | human_pending
    status_source:

TaskSlice 是执行边界，不是项目意义的唯一表达。

### 5.4 HandoffBundle

    handoff_id:
    revision:
    task_id:
    sender:
      agent_id:
      role:
    receiver:
      agent_id:
      role:
    input_revisions:
    input_shas:
    objective:
    non_goals:
    allowed_paths:
    expected_output:
    acceptance_ref:
    failure_semantics:
    context_summary:
      authoritative: false
      purpose: orientation_only
    provenance_refs:
    created_at:

聊天摘要可以放在 context_summary，但不能替代 input_revisions、acceptance_ref、权限和 provenance。

### 5.5 MachineResult

    result_id:
    task_id:
    attempt_id:
    result_revision:
    verdict: NOT-RUN | RUNNING | PASS-ENGINEERING | INCOMPLETE
      | DEVIATIONS_FOUND | OUT_OF_SCOPE | BLOCKED
    claims:
      - claim_id:
        statement:
        claim_kind: observation | test_result | self_report | inference
        status: supported | unsupported | needs_review
        evidence_refs:
    execution:
      commands:
      runtime:
      environment:
      started_at:
      ended_at:
      exit_codes:
    changes:
      paths:
      diff_refs:
      artifact_shas:
    side_effects:
    evidence:
      - evidence_id:
        pointer:
        sha:
        evidence_status: self_reported | pre_harness_checked
          | harness_verified | independently_validated
        verified_by:
    limitations:
    unresolved:
    next_attempt:
    generated_by:
      agent_id:
      harness_revision:

规则：

- claim_kind 为 self_report 或 inference 的内容不能单独产生 PASS-ENGINEERING；
- 退出码为 0 不能替代语义结果、拒绝行为、留痕和越界扫描；
- 每个 evidence 必须说明来源和验证层级；
- MachineResult 不包含 HumanResult 的接受字段；
- 没有运行证据时 verdict 必须保持 NOT-RUN 或 INCOMPLETE。

### 5.6 HumanProjectState

    schema: hps/v0.1
    project_id:
    projection_revision:
    source_revisions:
    generated_at:
    intent:
      statement:
      current_phase:
    pains:
      - pain_id:
        statement:
        status:
        solved_by:
        remaining_gap:
    active_design_decisions:
      - decision_id:
        statement:
        status:
        affected_scope:
    capabilities:
      - capability_id:
        statement:
        task_refs:
        machine_summary:
        human_summary:
    active_work:
      - task_id:
        why_now:
        machine_status:
        human_status:
        latest_change:
    changes_since_last_seen:
    unresolved:
    risks:
    human_decisions_needed:
    evidence_summary:
      verified:
      self_reported:
      not_run:
      stale:
    recovery_state:
    provenance_refs:

HPS 是可重建投影。它必须保留 source_revisions，以便用户知道“这一页是从哪个状态生成的”。

### 5.7 HumanBrief

    brief_id:
    project_id:
    task_id:
    generated_from:
      hps_revision:
      machine_result_refs:
      human_result_refs:
    headline:
    why_now:
    pain_solved_or_affected:
    design_point:
    changed:
    machine_verified:
    not_verified:
    remaining:
    next_and_reason:
    human_decision:
      required: true | false
      request_ref:
    risk_and_consequence:
    drill_down:
      state_ref:
      trace_refs:
      evidence_refs:
    generated_at:
    renderer_revision:

生成器不得通过润色把 not_verified、remaining 或 risk_and_consequence 删除。

### 5.8 HumanEscalationRequest

    request_id:
    project_id:
    source_task_or_decision:
    gate_revision:
    category: INTENT | SCOPE | DESIGN | RISK
      | IRREVERSIBLE | SEMANTIC_OUTCOME
    question:
    decision_unit:
    current_facts:
      - statement:
        source_ref:
        evidence_status:
    options:
      - option_id:
        label:
        consequences:
        risks:
        reversibility:
    recommendation:
    safe_default_if_no_answer:
    affected_revisions:
    expires_at:
    one_question: true

若 category 是 MACHINE_FACT 或 EVIDENCE_GAP，不能创建面向用户的普通升级请求，应返回机器不完整结果或自动验证结果。

### 5.9 HumanResult

    human_result_id:
    request_id:
    decision_revision:
    decision_kind: accept_design | accept_scope | accept_risk
      | accept_semantic_outcome | reject | request_changes
    selected_option:
    statement:
    rationale:
    accepted_conditions:
    affected_revisions:
    invalidated_assumptions:
    supersedes:
    actor:
    captured_at:
    explicitness: explicit

HumanResult 只记录用户明确作出的决定。它不能改变已经存在的机器事实，只能改变允许继续的范围、设计或风险状态。

### 5.10 TraceLink

    link_id:
    from_id:
    to_id:
    relation: motivates | refines | implements | tests
      | derives | uses | generated_by | reviewed_by
      | accepted_by | supersedes | invalidates | needs_review
    source_revision:
    created_by:
    created_at:

## 6. 状态与修订

### 6.1 机器状态轴

    NOT-RUN
      ↓
    RUNNING
      ├── PASS-ENGINEERING
      ├── INCOMPLETE
      ├── DEVIATIONS_FOUND
      ├── OUT_OF_SCOPE
      ├── BLOCKED
      └── NOT-RUN（中断后没有可用运行证据）

状态转换由事件和 Gate 驱动，不由 brief 文本驱动。

### 6.2 人类状态轴

    NOT_NEEDED
      └── HUMAN_PENDING
            ├── HUMAN_ACCEPTED
            ├── HUMAN_ACCEPTED_WITH_CONDITIONS
            ├── HUMAN_REJECTED
            └── CHANGES_REQUESTED

人类状态不能覆盖机器状态：

- machine PASS + human pending = 工程结果已有证据，但项目决策尚未完成；
- machine NOT-RUN + human accepted = 用户接受设计路线，但测试仍未运行；
- machine PASS + human accepted = 两个不同维度都完成，仍要检查 scope；
- machine OUT_OF_SCOPE + human accepted = 用户接受不在本切片内处理，不等于问题解决。

### 6.3 项目语义状态

Human Project State 可使用以下高层阶段：

    ORIENTING
    INTENT_PENDING
    DESIGN_PENDING
    READY_FOR_IMPLEMENTATION
    EXECUTING
    MACHINE_VALIDATION
    HUMAN_DECISION_PENDING
    PARTIALLY_SOLVED
    SOLVED_PENDING_CONFIRMATION
    CLOSED
    BLOCKED
    RECOVERY

高层阶段由底层状态计算得到，不能由 Agent 的“项目完成”文字直接设置。

### 6.4 Revision 规则

1. 任何定义性修改都产生新 revision；
2. 新 revision 记录 supersedes 和变更字段；
3. 旧 revision 可读、可追溯、不可原地覆盖；
4. 上游变化使下游进入 stale 或 needs_review，不自动判定为 false；
5. terminal Run、Result 或 HumanResult 不因重试而改变；
6. retry 使用新 attempt_id；
7. projection 可重建，但不得丢失 source_revisions；
8. 同一逻辑 ID 的 reservation 必须在并发进程间受保护；
9. 任何跨 revision 的更新都要通过 expected_version 检查；
10. 结构化状态缺失时 fail closed。

## 7. 事件、Hook 与自动维护

### 7.1 事件模型

建议的最小事件：

    IntentProposed
    IntentAccepted
    PainCaptured
    RequirementProposed
    DesignProposed
    DesignAccepted
    TaskFrozen
    HandoffIssued
    RunStarted
    ToolObserved
    ArtifactProduced
    TestRecorded
    MachineResultSubmitted
    ValidationRecorded
    EvidenceLinked
    EscalationRequested
    HumanDecisionRecorded
    RevisionCreated
    RetryStarted
    RecoveryStarted
    ReconciliationFoundDrift
    ProjectionRebuilt
    AgentSettled

每个事件包含 event_id、event_type、entity_id、revision、actor、timestamp、payload_sha 和 provenance_refs。

### 7.2 Hook 表

| Hook | 触发条件 | 确定性动作 | 模型可做的事 | 失败行为 |
|---|---|---|---|---|
| on_project_open | 打开或恢复项目 | 读取 source、校验 revision、运行 Reconciler、生成 HPS | 解释当前状态 | 状态不一致则 BLOCKED / RECOVERY |
| before_agent_start | 新 Agent 或新会话开始 | 注入最小 HPS、任务边界、当前 revision 和待决事项 | 形成工作计划草案 | 缺少任务边界则拒绝启动 |
| before_task_dispatch | 任务将交给 Agent | 校验 freeze、路径、合同、输入 SHA、角色分离 | 建议执行顺序 | 不满足前置条件则不派发 |
| before_tool_call | Agent 请求工具 | 校验权限、路径、数据类别、网络和人工 Gate | 无权扩大权限 | 拒绝并留痕 |
| after_tool_call | 工具返回 | 记录必要 telemetry、退出码、artifact 指针 | 解释输出 | 记录失败，不伪造成功 |
| after_task_run | Agent 提交结果 | 校验 MachineResult schema、hash、引用、side effect | 草拟 brief | 无法核验则 INCOMPLETE |
| before_validation | 验证开始 | 校验候选 SHA 冻结、验证角色、合同版本 | 选择检查顺序 | 输入漂移则退回新 attempt |
| before_human_escalation | Agent 请求用户判断 | 执行 Human Escalation Gate，分类机器事实与人类判断 | 改写为一个清晰问题 | 机器事实升级请求被拒 |
| on_human_decision | 用户明确回答 | 校验 request_id、scope、条件和版本，追加 HumanResult | 解释后续影响 | 模糊回答保持 HUMAN_PENDING |
| on_agent_settled | Agent 完整结束一次执行 | 固化未提交事件、生成 projection、清理本轮临时状态 | 生成下一步建议 | 保留未完成记录 |
| on_resume | 中断后继续 | 读取最后一致事件、恢复 pending、重新跑 Gate | 说明恢复点 | 不能从摘要推断已完成 |
| on_reconciliation | 发现漂移或重复 | 生成 drift report、标记 stale、阻止错误投影 | 提供修复候选 | 默认不静默修复 |

模型提示不能替代 Hook。尤其是定义、权限、版本、事务和“是否已经接受”等问题必须由核心逻辑控制。[D]

### 7.3 防止重复副作用

Pi 或其他运行时可能重复触发低层生命周期事件。实现应：

1. 以真实 tool_call_id / event_id 识别一次事件；
2. 保存“本次运行已经成功记录”的 receipt；
3. 在完整 Agent settled 后清理本轮状态；
4. 重复 Hook 返回已有 receipt，不创建第二个 Human Brief、commit 或 Human Escalation；
5. 测试真实的多次 continuation / retry，而不只测试函数是否注册。

## 8. Gate 设计

### 8.1 Gate 分类

| Gate | 检查对象 | 允许通过的条件 | 缺失时 |
|---|---|---|---|
| G-INTENT | 目标与痛点 | 意图来源明确，范围可描述 | INTENT_PENDING |
| G-SCOPE | TaskSlice | 目标、非目标、路径、输入和输出冻结 | 不派发 |
| G-SCHEMA | Bundle / Result | schema、枚举、必填字段完整 | 拒绝 |
| G-IDENTITY | Agent / entity | ID、角色和 receiver 一致 | 拒绝 |
| G-REFERENCE | ref / SHA | 对象存在、版本可解析、hash 匹配 | 拒绝 |
| G-PERMISSION | 路径 / 数据 / 网络 | 在 allowlist，数据类别已登记 | 拒绝并留痕 |
| G-EVIDENCE | MachineResult | 命令、环境、结果、证据和限制齐全 | INCOMPLETE |
| G-INDEPENDENCE | Validation | 实现与验证责任分离，候选 SHA 冻结 | 新 attempt |
| G-IDEMPOTENCY | commit / retry | 已有提交可重放，retry 不覆盖旧记录 | 返回既有结果或拒绝 |
| G-HUMAN | 人类升级 | 问题确需人类判断，问题窄且影响明确 | 不产生升级 |
| G-CANONICAL | 受保护写入 | explicit human approval、版本匹配、备份和回读 | 阻断 |
| G-REVISION | 定义性修改 | 产生新 revision 和 supersedes | 阻断 |
| G-RECOVERY | 恢复 / 回滚 | 原因、人工 Gate、目标 revision 和复跑计划齐全 | RECOVERY / BLOCKED |
| G-PROJECTION | HPS / brief | source revisions 可读、没有未标记冲突 | 不更新投影 |

### 8.2 Human Escalation Gate 算法

输入是 Agent 提交的 escalation candidate，执行顺序：

1. 解析问题的 decision_unit；
2. 检查问题是否属于 MACHINE_FACT；
3. 如果是 MACHINE_FACT，尝试 deterministic check；
4. 若能确定，返回机器结果，不问用户；
5. 若不能确定，输出 EVIDENCE_GAP 和缺失证据，不问用户相信；
6. 若问题属于 INTENT、SCOPE、DESIGN、RISK、IRREVERSIBLE 或 SEMANTIC_OUTCOME，检查是否有当前事实、影响和安全默认值；
7. 将复合问题拆成一个核心 decision_unit；
8. 生成 HumanEscalationRequest；
9. 等待明确 HumanResult；
10. 在用户回答后重新运行相关 Gate。

伪代码：

    function evaluate_escalation(candidate):
        unit = normalize_decision_unit(candidate)
        if unit.category == MACHINE_FACT:
            check = deterministic_check(unit)
            if check.status == VERIFIED:
                return MachineResult(VERIFIED, check.evidence)
            return MachineResult(INCOMPLETE, missing=check.missing)

        if unit.category == EVIDENCE_GAP:
            return MachineResult(INCOMPLETE, missing=unit.missing_evidence)

        if not has_single_question(unit):
            return reject("split into one decision unit")
        if not has_current_facts(unit):
            return reject("insufficient context")
        if not has_safe_default(unit):
            return reject("no safe pause policy")
        return create_human_escalation(unit)

    用户拒绝或未回答不会被转换成接受；默认动作是暂停或执行明确声明的低风险默认路径。

### 8.3 HITL / HOTL / 自动模式

本设计使用风险和时间关系区分模式：

| 模式 | 人的动作 | 适合场景 | 技术要求 |
|---|---|---|---|
| 自动 | 事前不逐项批准，机器事实持续记录 | 低风险、可逆、范围内工具操作 | allowlist、日志、停止能力 |
| HOTL | 人监控状态，可在异常时介入 | 中风险、长程任务、异步运行 | 实时或定期告警、暂停、恢复、审计 |
| HITL | 动作或语义决定前必须明确批准 | 高风险、不可逆、改变范围或 canonical | request、阻断、明确结果、版本绑定 |
| BLOCKED | 不继续执行 | 证据不足、越权、冲突、状态漂移 | fail closed、恢复指针 |

英国 NCSC 对 HITL、HOTL 和无人工审查的区分，以及高后果场景的技术控制要求，为这种风险分级提供了外部参考。[E04]

## 9. Progressive Disclosure 交互层

### 9.1 五层视图

    L0 项目入口
       目标 / 当前阶段 / 最近变化 / 下一次人类决定
    L1 Human Brief
       为什么做 / 解决什么 / 做了什么 / 还剩什么
    L2 语义地图
       Pain / Requirement / Design / Capability / TaskSlice
    L3 Machine Result
       测试、命令、环境、hash、权限、失败、限制
    L4 Provenance / raw evidence
       事件、artifact、原始日志、外部来源、逐条交叉核对

规则：

1. L0 和 L1 对所有重新进入项目的用户默认可见；
2. L2 在用户需要理解项目结构时展开；
3. L3 在用户需要审查工程证据或遇到异常时展开；
4. L4 永远可定位，但不默认占据首屏；
5. 每一层都显示当前对象、revision 和证据状态；
6. “展开”链接要说明将看到什么，不能用“更多详情”隐藏信息；
7. 不能为保持首屏简洁而隐藏风险、未解决项或证据不足；
8. 初始层与次级层的划分必须通过真实任务测试调整。

Progressive disclosure 的经典设计建议先显示最重要选项、按需提供专门细节，并提醒设计者通过任务分析验证层级划分。[E11]

### 9.2 用户常用交互

逻辑操作名如下，具体宿主可映射为命令、按钮或自然语言入口：

    project.open(project_id)
    project.status(project_id)
    project.brief(task_id | capability_id | project_id)
    project.explain(object_id)
    project.trace(object_id)
    project.show_evidence(evidence_id)
    project.list_decisions(project_id)
    project.capture_pain(statement)
    project.request_change(object_id, statement)
    project.respond(request_id, explicit_decision)
    project.resume(project_id)

任何查询操作只读。任何状态变化都转化为 typed event，并通过 Gate。

### 9.3 信息排序

默认排序：

1. 需要人决定且会阻塞项目的事项；
2. 最近改变且影响多个下游对象的事项；
3. 与当前用户关注 Pain 相关的事项；
4. 证据不完整、状态漂移或安全风险；
5. 普通进度；
6. 已稳定且没有新变化的历史。

这不是用模型的主观重要性替代状态；排序只改变呈现顺序，不改变事实。

## 10. 多 Agent 协作协议

### 10.1 角色分离

建议最小角色：

- **Coordinator**：将项目语义映射到任务，整合结果；
- **Implementation**：在边界内修改 workspace；
- **Validation**：独立检查合同和证据；
- **Research**：获取和整理外部资料；
- **Reconciler**：比较状态、事件和 artifact；
- **Human**：做语义、设计和风险决定。

Implementation 与 Validation 可以共享需求、边界和测试合同，但责任视图和输出必须分开。验证 Agent 的 CONFORMANT 只说明合同范围内的验证结果，不能代替人类设计接受。[D]

### 10.2 Dispatch 流程

    1. HPI 读取当前 HPS
    2. Coordinator 提出 TaskSlice
    3. G-INTENT / G-SCOPE / G-SCHEMA
    4. 用户在必要时接受设计或范围
    5. Harness 冻结 TaskSlice、输入 revision 和 SHA
    6. Implementation Agent 执行
    7. MachineResult 提交
    8. Validation Agent 读取冻结候选并验证
    9. Reconciler 比较实现、验证和宿主状态
    10. Projector 更新 HPS 和 Human Brief
    11. HIG 判断是否需要用户
    12. 用户只回答一个明确问题，或项目继续自动 / HOTL

### 10.3 Handoff 的上下文策略

交接包必须传递：

- 任务身份；
- 目标和非目标；
- 输入 revision 和 SHA；
- 允许 / 禁止路径；
- 合同和验收；
- 当前失败和未完成项；
- 结构化 provenance；
- 安全默认动作。

交接包可以附上面向人的摘要，但接收方必须先读取结构化字段。OpenAI Agents SDK 的公开文档也把 handoff、input filter、sessions 和 trace 分成不同责任；这一设计借鉴的是“传递结构化状态而不是无界转发历史”的模式，而不是要求采用该 SDK。[E08]

### 10.4 并行任务

只有满足以下条件才并行：

- TaskSlice 之间依赖已明确；
- 写入范围不重叠，或有明确 merge / lock；
- 各自结果有独立 attempt 和 provenance；
- 汇总 Agent 能发现冲突；
- 高风险操作不会因为并行而绕过 Gate。

并行不是默认；研究类宽度搜索可能适合并行，但高度共享上下文的编码任务可能不适合。公开的多 Agent 工程资料也强调了协调复杂度、重复工作和成本问题。[E08]

## 11. 自动生成与更新机制

### 11.1 生成流水线

    raw event / result
        ↓
    schema + identity + permission validation
        ↓
    evidence normalization
        ↓
    revision / idempotency check
        ↓
    Reconciler
        ↓
    append accepted event
        ↓
    materialize Human Project State
        ↓
    render Human Brief
        ↓
    run Human Escalation Gate

### 11.2 自动更新的边界

可自动更新：

- 机器测试状态；
- 任务执行状态；
- 证据计数和指针；
- artifact hash；
- changed paths；
- HPS 的活动任务和机器摘要；
- brief 的事实性部分；
- stale / needs_review 标记；
- next machine action。

必须明确人类决定：

- 原始目标是否变化；
- 新 Pain 是否纳入当前范围；
- 设计权衡选哪一种；
- 是否接受风险；
- 是否允许不可逆 canonical 操作；
- 功能是否真正解决用户痛点；
- 是否将一个候选作为下一阶段基线。

模型可以起草，但不能直接把后者写成 accepted。

### 11.3 变化摘要

每次 projection 至少计算：

    changed:
    why:
    impact:
    remaining:
    next:
    evidence_delta:
    human_decision_delta:

如果无法计算 why 或 impact，brief 标记 change_context_incomplete，而不是编造解释。

## 12. Provenance 与可追溯性

### 12.1 外部模型

W3C PROV-DM 将 provenance 组织为实体、活动、派生、Agent、责任、委托和时间等关系；它还允许把 provenance 本身作为可追踪对象。[E05]

HPI v0.1 的映射：

| PROV 概念 | HPI 对象 |
|---|---|
| Entity | Pain、Requirement、Design、TaskSlice、Artifact、Evidence、MachineResult、HumanBrief、HumanResult |
| Activity | 计划、实现、测试、验证、交接、投影、恢复 |
| Agent | 用户、Coordinator、Implementation、Validation、Research、Harness |
| used | 活动读取的输入 revision、fixture、工具输出 |
| wasGeneratedBy | Artifact、Result、Brief 由哪个活动产生 |
| wasDerivedFrom | Requirement 来自 Pain；MachineResult 来自 TestRun；Brief 来自 HPS |
| wasAssociatedWith | Agent 与任务或活动的角色 |
| actedOnBehalfOf | Worker 代表项目协调者在受限任务内执行 |
| wasInformedBy | Handoff、Validation feedback、Human decision |
| Revision | 需求、设计、状态或结果的 supersedes 链 |

### 12.2 来源类别

每条重要陈述必须有 source_type：

    user_intent
    user_decision
    local_canonical_state
    local_artifact
    machine_observation
    test_run
    external_source
    agent_self_report
    model_inference
    derived_projection

展示时至少区分：

- 人类明确说过；
- 机器观察到；
- Agent 自报；
- 外部资料支持；
- 模型推导；
- 由结构化状态派生。

### 12.3 证据与语义的双重检查

hash 能证明内容是否和被引用的内容一致，不能单独证明内容的语义正确性。故 MachineResult 要同时记录：

- 内容完整性：SHA、版本、引用；
- 执行语义：命令、退出码、预期拒绝或通过；
- 责任来源：谁运行、谁复核；
- 范围边界：测试覆盖什么、不覆盖什么；
- 语义限制：不能推断什么；
- 可能的下游影响：哪些状态变 stale。

## 13. 与 Note / Memory / Retrieval Skill 的边界

| 能力 | 允许做什么 | 禁止做什么 | 交互方式 |
|---|---|---|---|
| Note Skill | 捕获用户的 Pain、想法、会议内容、草稿 | 自己决定 canonical、批准设计、改变任务状态 | 把候选 Note 交给 HPI / Harness |
| Memory Skill | 关联历史偏好、项目背景、未来提醒 | 作为当前 revision、权限或事实证据 | 只做召回辅助，并标 stale 风险 |
| Retrieval Skill | 根据 ID、词法或语义找到上下文 | 代替 source-of-truth、排序即证明、隐藏冲突 | 返回候选及来源，不返回无出处结论 |
| HPI Skill | 生成 HPS / Brief、分类升级、呈现追踪 | 直接写 canonical、代用户批准 | 通过 typed protocol 访问 Harness |
| Harness | 身份、schema、事务、permission、provenance、reconcile | 用自然语言记忆不变量 | 确定性 Hook / Gate |

检索顺序建议：

    exact ID / revision
      → structured query
      → provenance
      → lexical search
      → semantic retrieval

RAG 或语义召回不能决定身份、版本、顺序、权限和 provenance。[D]

## 14. 失败、恢复与安全

### 14.1 失败矩阵

| 失败 | 识别 | 处置 | 人类是否默认介入 |
|---|---|---|---|
| schema 缺失或枚举非法 | G-SCHEMA | 拒绝并保留输入 | 否 |
| ID 冲突 | G-IDENTITY | 拒绝，要求新 ID / revision | 否 |
| 引用不存在或 SHA 不匹配 | G-REFERENCE | 拒绝，回到新 attempt | 否 |
| 越权路径 / 未登记数据 | G-PERMISSION | fail closed，保留执行证据 | 高风险时通知 |
| 测试没有运行 | G-EVIDENCE | NOT-RUN / INCOMPLETE | 否，除非决定是否改变范围 |
| Agent 自报与验证冲突 | Reconciler | 保留双方记录，DEVIATIONS_FOUND | 仅在需要风险或范围选择时 |
| 重复提交 | G-IDEMPOTENCY | 返回既有结果，不二次 commit | 否 |
| 中途崩溃 | on_resume | 从最后一致事件恢复，新 attempt 必要时重跑 | 否 |
| 用户决定过期 | request version check | HUMAN_PENDING，重新生成问题 | 是 |
| canonical 写入请求 | G-CANONICAL | 无明确批准则阻断 | 是 |
| 旧定义被新定义替代 | G-REVISION | 新 revision + supersedes + 下游 stale | 视语义影响 |
| projection 被删除 | G-PROJECTION | 从事件和记录重建 | 否 |
| 证据或日志含敏感数据 | privacy gate | 脱敏、限制查看或阻断分享 | 视风险 |

### 14.2 恢复原则

1. 先读取现存事件、record、artifact 和 revision；
2. 检查是否有半提交、重复提交或越界写入；
3. 计算最后一个一致点；
4. 用新 revision 或新 attempt 恢复，不覆盖旧记录；
5. 重新运行相关 Gate、引用检查和 Reconciler；
6. 重新生成 MachineResult 和 HPS；
7. 如果需要用户决定，创建新的 request_id；
8. 在 Human Brief 中说明恢复原因和影响；
9. 未验证的恢复保持 RECOVERY / INCOMPLETE；
10. 只有通过明确 Gate 才能恢复受保护状态。

### 14.3 长时间等待

Human pending 的持久化记录至少包含：

- request_id；
- request revision；
- agent / harness / schema revision；
- 已冻结的工具和输入；
- 当前安全默认动作；
- 失效时间；
- 恢复时重新验证的 Gate。

OpenAI Agents SDK 的公开实现展示了将 approval interruption、RunState、session 和 tracing 一起序列化，以便跨长等待和进程重启恢复；本设计吸收的是“pending 状态必须持久化并版本化”的工程原则。[E08]

### 14.4 安全边界

至少需要：

- Agent 独立身份；
- 最小权限和路径 allowlist；
- 默认限制网络；
- 受控数据类别；
- workspace 与 canonical 分离；
- 不把 credential 放入可被生成代码读取的 workspace；
- 不可删除或修改的审计记录；
- 停止、暂停和恢复能力；
- 公开前检查 provenance 是否泄露敏感内容。

NCSC 建议将 prompt、技术和运营控制叠加，并限制 Agent 的网络、计算、凭据和数据 blast radius；这与“Skill 不等于安全边界”的设计一致。[E04]

## 15. 交互示例

### 15.1 正常完成一个 TaskSlice

系统内部：

    TaskSlice TS-002
      → implementation attempt-001
      → MachineResult MR-002: PASS-ENGINEERING
      → validation VR-002: CONFORMANT
      → HPS projection r8

用户看到：

    这次完成了什么：
    建立 runtime 状态写入的第一版接口。

    为什么现在做：
    TS-001 已固定合同；下一步需要让运行时遵守这些合同。

    解决哪个痛点：
    关键状态不能依赖 Agent 自觉维护。

    机器已验证：
    合同测试、权限检查和验证结果见 Machine Result；候选 SHA 已冻结。

    仍未解决：
    崩溃恢复的完整事务语义尚未完成。

    现在需要你决定：
    是否接受 runtime 写入采用 revision-only，而不是 inplace mutation？

用户不需要在首屏读取每条命令，但可以展开到 MachineResult 和 raw evidence。

### 15.2 机器事实不完整

Agent 请求：

    请确认测试 117/117 已通过。

HPI / Harness 正确处理：

    该问题属于 MACHINE_FACT。
    当前可读材料中的 test_status 是 NOT-RUN，未发现相应运行日志和 ResultBundle。
    机器状态保持 NOT-RUN。
    缺失证据：四组用例命令、输入 SHA、输出日志 SHA、运行时版本、起止时间、语义拒绝检查。
    不生成“请用户相信”的升级请求。

### 15.3 新 Pain 影响范围

用户：

    我发现即使有交接文件，三天后我仍然不知道为什么要做这个任务。

系统：

    识别为新 Pain 或 P-001 的新表现。
    已关联：HandoffBundle、TS-002、Human Brief。
    可能原因：
    A. Handoff 只有工程上下文，没有 why；
    B. HPS 没有记录 Pain → Design；
    C. Brief 没有在会话结束时生成。
    当前唯一需要你决定的问题：
    这是否应作为 P-001 的验收条件加入当前项目？

用户选择后，才创建 Requirement 或更新既有 Requirement revision。

### 15.4 TS-001 当前材料的正确投影

    Human Project State
    当前阶段：DESIGN_PENDING / MACHINE_VALIDATION

    Intent：
    在进入 runtime 前固定 Agent 协作和回滚的工程合同。

    Pain：
    Agent 交接、越权写入、重复提交和历史覆盖不能依赖自觉。

    已定义：
    Schema、权限与引用、Handoff / Result 幂等、回滚与恢复程序。

    明确不在本切片：
    filesystem gate、完整 Run、Evidence / Claim runtime、Research Event 闭环、真实实验数据。

    机器状态：
    NOT-RUN。四组用例的实际执行证据尚未在当前材料中提供。

    人类状态：
    HUMAN_PENDING，仅等待用户判断“先固定合同与测试基线，再进入 runtime”是否是合适的路线。

    后置边界：
    不因本切片的设计或未来工程通过而自动批准 TaskSlice、ExperimentSpec、Claim、canonical 入库或科学结论。

这比把 RB、hash 和测试数字直接列成一组签字题更符合材料的边界。TS-001 的原文同时要求机器证据和用户另行人类验收，所以两者应分别建模。[M][D]

## 16. 与 TS-001 的映射

| TS-001 材料要求 | HPI / Harness 设计映射 |
|---|---|
| 四组用例 | MachineResult.test_runs 按 Schema、Permission / Reference、Idempotency、Rollback 分组 |
| test_status NOT-RUN | MachineResult.verdict 保持 NOT-RUN，不向用户升级为信任问题 |
| 每条用例记录输入、SHA、命令、环境、日志和退出码 | G-EVIDENCE + Evidence schema |
| 工具退出 0 不能单独证明通过 | 语义结果、拒绝留痕和越界扫描字段 |
| 正向和负向都要执行 | TestRun.expected_behavior + observed_behavior |
| 直接覆盖不变量 | TraceLink.tested_by + ValidationResult |
| 后置不变量不能被本切片覆盖 | scope_outcome = OUT_OF_SCOPE，保留后续归属 |
| 重发幂等、retry 新 attempt | G-IDEMPOTENCY + attempt_id |
| 回滚创建新 revision，保留 supersedes | G-REVISION + Recovery event |
| G-011 / G-014 人工批准 | G-CANONICAL / G-RECOVERY 的 request_id 绑定 |
| 通过不能批准 TaskSlice、ExperimentSpec、Claim | scope-separated HumanResult |
| 不产生科学或临床主张 | claim_kind 和 claim boundary |
| 用户另行完成人类验收 | HumanEscalationRequest + HumanResult |

TS-001 也说明了为什么需要双层结果：

- MachineResult 可以说合同测试有没有运行、哪些用例通过、哪些拒绝、有哪些证据；
- HumanResult 可以说用户是否接受先做合同基线、是否接受某个设计路线或风险；
- 二者不能互相伪造。

## 17. Requirements-first 与测试设计

实现前先冻结需求、非目标、边界、协议和失败语义，再实现测试。P0 最小测试集建议如下：

| 测试 ID | 场景 | 预期 |
|---|---|---|
| HPI-001 | Agent 以“请相信 hash”请求升级 | HIG 拒绝，返回 MACHINE_FACT 或 EVIDENCE_GAP |
| HPI-002 | 用户重新进入项目 | HPS 给出目标、阶段、最近变化、未解决项和下一决策 |
| HPI-003 | 机器 PASS 但用户尚未决定 | machine PASS、human HUMAN_PENDING，不能合并为 accepted |
| HPI-004 | 用户接受设计但测试未运行 | human accepted、machine NOT-RUN，不能改变测试状态 |
| HPI-005 | TaskSlice 没有 Pain / Design 关联 | 标记 orphaned，不能报告语义闭环完成 |
| HPI-006 | Human Brief 生成 | 不能删除 not_verified、remaining 和风险 |
| HPI-007 | 新 Pain 出现 | 创建候选 Pain，关联来源，等待范围决策 |
| HPI-008 | 同一 Result 重复提交 | 返回既有结果，不产生第二次 commit |
| HPI-009 | 失败 attempt retry | 新 attempt，旧记录和 workspace 指针保留 |
| HPI-010 | 上游 Design 新 revision | 下游标记 stale / needs_review，不自动判 false |
| HPI-011 | 非法路径、未知 data_class、缺 schema | fail closed 并留痕 |
| HPI-012 | Agent 终止后重复 Hook | 只产生一次 receipt、一次 projection、一次必要升级 |
| HPI-013 | 删除 HPS 派生文件 | 从事件和 immutable records 重建，source revision 不变 |
| HPI-014 | 用户模糊回答“可以” | 若 request 不支持无歧义解析，保持 HUMAN_PENDING |
| HPI-015 | TS-001 当前 NOT-RUN | 不生成工程 PASS，不把用户回答当作测试证据 |
| HPI-016 | TS-001 请求 canonical 恢复 | 无对应人工 Gate 时阻断 |

这些测试是 Harness 和 Skill 的共同合同，但实现测试与验证测试应从不同责任视角执行。

## 18. 落地路线

### Phase 0：合同与样例

- 固化 HPS、MachineResult、HumanResult、HumanBrief、EscalationRequest 和 TraceLink 的 schema；
- 固化状态枚举和版本规则；
- 准备 TS-001 风格的纯数据 fixture；
- 建立“机器事实不升级”的负向测试；
- 不连接真实 canonical 写入。

### Phase 1：本地只读投影

- 从一个宿主项目的既有记录生成 HPS；
- 生成 Human Brief；
- 支持 L0–L4 的只读 drill-down；
- 支持 Pain → TaskSlice → Evidence 的查询；
- 记录 projection revision。

### Phase 2：Harness Hook / Gate

- 加入 schema、identity、reference、permission、revision、idempotency 和 evidence Gate；
- 接入 on_project_open、before_agent_start、after_task_run、before_human_escalation、on_human_decision、on_resume；
- 建立 append-only 事件和 Reconciler；
- 验证重复生命周期事件和崩溃恢复。

### Phase 3：Agent adapter

- 接入一个 Coordinator；
- 接入独立 Implementation / Validation 两类 Agent；
- 以结构化 Handoff / Result 替代用户复制消息；
- 保留宿主平台的模型、工具和工作区差异。

### Phase 4：人类体验评估

- 用真实项目任务测试重新进入、设计决策、失败恢复和新 Pain；
- 测量机器事实误升级率、brief 覆盖率、变化可解释率和用户恢复时间；
- 评估用户是否能说出 why / change / solved / remaining / next decision；
- 再决定是否需要 P1 的可视化、通知和多项目能力。

### 暂不实施

- RAG 或知识图谱作为真源；
- 自动推断人类接受；
- 自动改变 canonical 定义；
- 全自动科学结论；
- 无边界的多 Agent 对话；
- 未经过风险评估的云端调度和网络访问。

## 19. 运行时观测与验收

### 19.1 运行时必须可观测

至少观测：

- event_id、trace_id、task_id、attempt_id；
- agent_id、role、harness revision；
- handoff、tool call、guardrail、validation 和 human request；
- input / output revision；
- artifact 和日志指针；
- Gate 结果、失败原因和恢复路径；
- HPS projection revision；
- HumanResult 的影响范围。

公开的 OpenAI Agents SDK tracing 文档把 workflow、agent、tool、handoff、guardrail 和 custom event 作为可追踪跨度；这是可借鉴的观测粒度，不是对本项目平台的技术绑定。[E08]

### 19.2 P0 关闭条件

P0 只有在以下条件同时满足时，才能称为“已实现并验证”：

1. schema 和负向测试已通过；
2. HPS 可以从记录重建；
3. MachineResult / HumanResult 状态不串写；
4. 机器事实不再产生信任型升级；
5. Human Brief 能解释 why、change、solved、remaining、next；
6. 至少一个真实长程项目完成一次跨会话恢复；
7. 至少一次实现 / 验证 Agent 分离交接；
8. 至少一次失败 attempt 和新 attempt 恢复；
9. 至少一次上游 revision 传播 stale；
10. TS-001 NOT-RUN 边界回归通过；
11. 没有把 proposal、synthetic、dry-run 或自报状态报告为真实完成；
12. 用户完成独立的人类体验验收。

“文档完成”“单元测试通过”“print-mode 载入成功”都不能单独证明完整的交互闭环已完成。[D]

## 20. 设计风险与待决问题

### 20.1 技术风险

- 现有项目没有结构化真源，导致 HPS 只能是猜测；
- 事件与既有 Worklog 的映射不完整；
- 多 Agent 并发写入产生逻辑 ID 或 revision 竞争；
- Agent 输出缺少可复核的工具证据；
- 低层 hook 重复触发，造成重复 brief 或重复升级；
- 敏感 raw log 通过 provenance 泄露；
- 模型变化使摘要重点或升级频率漂移；
- 过度自动化导致用户失去对设计变化的感知。

### 20.2 待用户决定

1. P0 是否把“痛点是否解决”要求为明确的 HumanResult？
2. Human Project State 是否需要一个固定的项目入口文件，还是始终只做投影？
3. 用户是否愿意接受“自动 / HOTL / HITL / BLOCKED”四种风险模式？
4. 对设计路线、范围和风险，是否坚持每个 Gate 一题一答？
5. 哪些现有项目状态和路径可以作为第一版 adapter 的真源？
6. 用户希望默认看到单个 TaskSlice 的 brief，还是按 Capability / Pain 聚合？
7. 对长时间无人回答的任务，默认动作是暂停、继续低风险步骤，还是生成提醒？
8. 什么条件下可以把某个设计作为下一阶段工程基线，但不视为科学或临床结论？

## 21. 参考资料

本轮资料截至 2026-08-30；外部资料只提供设计参考，不表示本项目采用对应产品或技术栈。

1. [E01] [Microsoft Research — Guidelines for Human-AI Interaction（CHI 2019）](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
2. [E02] [Microsoft Research — Challenges in Human-Agent Communication](https://www.microsoft.com/en-us/research/publication/human-agent-interaction-challenges/)
3. [E03] [NIST AI RMF 1.0](https://nvlpubs.nist.gov/nistpubs/ai/nist.ai.100-1.pdf)
4. [E04] [UK NCSC — Managing the cyber risk of agentic AI](https://www.ncsc.gov.uk/blogs/managing-the-cyber-risk-of-agentic-ai)
5. [E05] [W3C — PROV-DM: The PROV Data Model](https://www.w3.org/TR/prov-dm/)
6. [E06] [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
7. [E07] [Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
8. [E08] [OpenAI Agents SDK — Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/)
9. [E08] [OpenAI Agents SDK — Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
10. [E08] [OpenAI Agents SDK — Tracing](https://openai.github.io/openai-agents-python/tracing/)
11. [E08] [OpenAI Agents SDK — Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
12. [E09] [HULA — Human-In-The-Loop Software Development Agents](https://arxiv.org/abs/2411.12924)
13. [E10] [SWE-agent — Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793)
14. [E11] [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
15. [E12] [UK Government — Principles of AI use in marking](https://www.gov.uk/government/publications/principles-of-ai-use-in-marking/principles-of-ai-use-in-marking)

## 22. 覆盖检查

| 用户要求 | 本文位置 | 状态 |
|---|---|---|
| Skills / Harness 架构 | §2–§3 | 已覆盖 |
| 触发条件 | §7.2 | 已覆盖 |
| 输入输出协议 | §5 | 已覆盖 |
| Human Project State | §5.6、§6 | 已覆盖 |
| Machine Result / Human Result 双层结果 | §5.5、§5.9、§6 | 已覆盖 |
| 项目状态维护 | §6–§7 | 已覆盖 |
| 自动生成 / 更新机制 | §11 | 已覆盖 |
| Hook / Gate | §7–§8 | 已覆盖 |
| Note / Memory / Retrieval 边界 | §13 | 已覆盖 |
| Provenance / traceability | §12 | 已覆盖 |
| 失败与恢复 | §14 | 已覆盖 |
| 示例交互 | §15 | 已覆盖 |
| 落地路线 | §18 | 已覆盖 |
| TS-001 反例 / 案例分析 | §15.4、§16 | 已覆盖 |
| 公开资料调研边界 | §0、§21 | 已覆盖 |

