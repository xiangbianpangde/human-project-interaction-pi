import { TRACE_RELATIONS, sha256 } from "../contracts.mjs";
import {
  MECHANICAL_STALE_RELATIONS,
  RETRYABLE_ATTEMPT_STATUSES,
  arrayAt,
  assertWireRecordRevision,
  enumValue,
  exactKeys,
  fail,
  frozenRef,
  frozenRefs,
  idempotencyKey,
  nonEmpty,
  sealRecord,
  timestamp,
  wireRecordRef,
} from "./contract.mjs";
import { toWireAttempt } from "./codecs.mjs";

export function createRetryAttempt(previousAttempt, value) {
  assertWireRecordRevision(previousAttempt, "attempt_revision", "previousAttempt");
  if (previousAttempt.schema !== "hpi/wire/attempt/v2") fail("previousAttempt.schema", "must be an Attempt v2 record");
  if (!RETRYABLE_ATTEMPT_STATUSES.includes(previousAttempt.status)) {
    fail("previousAttempt.status", "retry requires FAILED, BLOCKED, INTERRUPTED, or CANCELLED");
  }
  const object = exactKeys(
    value,
    ["attemptId", "workspaceRef", "provenanceRefs", "createdAt"],
    ["attemptId", "workspaceRef", "provenanceRefs", "createdAt"],
    "retry",
  );
  if (object.attemptId === previousAttempt.attempt_id) fail("retry.attemptId", "must create a new attempt id");
  const retry = toWireAttempt({
    attemptId: object.attemptId,
    taskRef: previousAttempt.task_ref,
    handoffRef: previousAttempt.handoff_ref,
    ordinal: previousAttempt.ordinal + 1,
    status: "NOT_STARTED",
    workspaceRef: object.workspaceRef,
    retryOf: wireRecordRef(previousAttempt, { idKey: "attempt_id", revisionKey: "attempt_revision" }),
    failure: { kind: "NONE", summary: "", retryable: false },
    changedFields: ["attempt_id", "ordinal", "retry_of", "status", "workspace_ref"],
    provenanceRefs: object.provenanceRefs,
    createdAt: object.createdAt,
  });
  return {
    kind: "RETRY_CANDIDATE_CREATED",
    previous_attempt_unchanged: true,
    project_canonical_changed: false,
    attempt: retry,
  };
}


function assertResultIdempotency(bundle, path) {
  const expected = idempotencyKey("result-bundle", {
    task_ref: bundle.task_ref,
    handoff_ref: bundle.handoff_ref,
    attempt_ref: bundle.attempt_ref,
  });
  if (bundle.idempotency_key !== expected) {
    fail(`${path}.idempotency_key`, "must bind the frozen task, handoff, and attempt refs", {
      expected,
      actual: bundle.idempotency_key,
    });
  }
}

function groupDistinctRevisions(bundles, keyOf) {
  const groups = new Map();
  for (const bundle of bundles) {
    const key = keyOf(bundle);
    const revisions = groups.get(key) ?? new Map();
    revisions.set(bundle.bundle_revision, bundle);
    groups.set(key, revisions);
  }
  return groups;
}

function firstLedgerConflict(existing) {
  const checks = [
    {
      kind: "LEDGER_IDEMPOTENCY_CONFLICT",
      groups: groupDistinctRevisions(existing, (bundle) => bundle.idempotency_key),
    },
    {
      kind: "LEDGER_IDENTITY_CONFLICT",
      groups: groupDistinctRevisions(existing, (bundle) => bundle.result_bundle_id),
    },
  ];
  for (const check of checks) {
    const conflictKeys = [...check.groups.entries()]
      .filter(([, revisions]) => revisions.size > 1)
      .map(([key]) => key)
      .sort();
    if (conflictKeys.length === 0) continue;
    const key = conflictKeys[0];
    return {
      kind: check.kind,
      conflict_key: key,
      existing: [...check.groups.get(key).values()].toSorted((left, right) =>
        left.bundle_revision.localeCompare(right.bundle_revision),
      ),
      second_commit_created: false,
      project_canonical_changed: false,
    };
  }
  return null;
}

export function classifyResultSubmission(existingBundles, candidate) {
  const existing = arrayAt(existingBundles, "existingBundles");
  if (candidate?.schema !== "hpi/wire/result-bundle/v2") {
    fail("candidate.schema", "must be a ResultBundle v2 record");
  }
  assertWireRecordRevision(candidate, "bundle_revision", "candidate");
  assertResultIdempotency(candidate, "candidate");
  for (const [index, bundle] of existing.entries()) {
    if (bundle?.schema !== "hpi/wire/result-bundle/v2") {
      fail(`existingBundles[${index}].schema`, "must be a ResultBundle v2 record");
    }
    assertWireRecordRevision(bundle, "bundle_revision", `existingBundles[${index}]`);
    assertResultIdempotency(bundle, `existingBundles[${index}]`);
  }
  const ledgerConflict = firstLedgerConflict(existing);
  if (ledgerConflict) return ledgerConflict;

  const byKey = existing
    .filter((bundle) => bundle.idempotency_key === candidate.idempotency_key)
    .toSorted((left, right) => left.bundle_revision.localeCompare(right.bundle_revision))[0];
  if (byKey) {
    if (byKey.bundle_revision === candidate.bundle_revision) {
      return {
        kind: "REPLAY_EXISTING",
        existing: byKey,
        second_commit_created: false,
        project_canonical_changed: false,
      };
    }
    return {
      kind: "IDEMPOTENCY_CONFLICT",
      existing: byKey,
      candidate,
      second_commit_created: false,
      project_canonical_changed: false,
    };
  }
  const byId = existing
    .filter((bundle) => bundle.result_bundle_id === candidate.result_bundle_id)
    .toSorted((left, right) => left.bundle_revision.localeCompare(right.bundle_revision))[0];
  if (byId) {
    return {
      kind: "IDENTITY_CONFLICT",
      existing: byId,
      candidate,
      second_commit_created: false,
      project_canonical_changed: false,
    };
  }
  return {
    kind: "NEW_CANDIDATE",
    candidate,
    second_commit_created: false,
    project_canonical_changed: false,
  };
}

export function computeStaleReport(value) {
  const object = exactKeys(
    value,
    ["upstreamBefore", "upstreamAfter", "dependents", "detectedAt", "provenanceRefs"],
    ["upstreamBefore", "upstreamAfter", "dependents", "detectedAt", "provenanceRefs"],
    "staleReport",
  );
  const before = frozenRef(object.upstreamBefore, "staleReport.upstreamBefore");
  const after = frozenRef(object.upstreamAfter, "staleReport.upstreamAfter");
  if (before.id !== after.id) fail("staleReport", "before and after must share one logical upstream id");
  if (before.revision === after.revision && before.sha256 !== after.sha256) {
    fail("staleReport.upstreamAfter", "same revision with a different SHA is integrity drift, not a new revision");
  }
  if (before.revision === after.revision && before.sha256 === after.sha256) {
    return {
      kind: "NO_REVISION_CHANGE",
      report: null,
      project_canonical_changed: false,
    };
  }
  if (before.sha256 === after.sha256) {
    fail("staleReport.upstreamAfter", "a new revision must not reuse the previous content SHA");
  }
  const effects = arrayAt(object.dependents, "staleReport.dependents").map((entry, index) => {
    const path = `staleReport.dependents[${index}]`;
    const dependent = exactKeys(entry, ["targetRef", "relation", "reason"], ["targetRef", "relation", "reason"], path);
    const relation = enumValue(dependent.relation, TRACE_RELATIONS, `${path}.relation`);
    return {
      target_ref: frozenRef(dependent.targetRef, `${path}.targetRef`),
      relation,
      disposition: MECHANICAL_STALE_RELATIONS.includes(relation) ? "STALE" : "NEEDS_REVIEW",
      reason: nonEmpty(dependent.reason, `${path}.reason`),
      automatic_invalidation: false,
    };
  });
  if (effects.length === 0) fail("staleReport.dependents", "must not be empty when an upstream revision changed");
  effects.sort((left, right) =>
    `${left.target_ref.id}\u0000${left.target_ref.revision}\u0000${left.relation}`.localeCompare(
      `${right.target_ref.id}\u0000${right.target_ref.revision}\u0000${right.relation}`,
    ),
  );
  const effectKeys = effects.map(
    (entry) => `${entry.target_ref.id}\u0000${entry.target_ref.revision}\u0000${entry.relation}`,
  );
  if (new Set(effectKeys).size !== effectKeys.length) fail("staleReport.dependents", "contains duplicate effects");
  const reportIdentity = { upstream_before: before, upstream_after: after, effects };
  const report = sealRecord(
    {
      schema: "hpi/wire/stale-report/v2",
      stale_report_id: `STALE-${sha256(reportIdentity)}`,
      ...reportIdentity,
      detected_at: timestamp(object.detectedAt, "staleReport.detectedAt"),
      reconciler_mode: "PREVIEW_ONLY",
      report_authority: "DERIVED_PREVIEW_NOT_PROJECT_CANONICAL",
      project_canonical_changed: false,
      provenance_refs: frozenRefs(object.provenanceRefs, "staleReport.provenanceRefs", { min: 1 }),
    },
    "report_revision",
  );
  return {
    kind: "STALE_REPORT_CREATED",
    report,
    project_canonical_changed: false,
  };
}
