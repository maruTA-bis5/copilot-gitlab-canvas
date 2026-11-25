function text(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUser(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    id: value.id == null ? null : number(value.id),
    username: text(value.username),
    name: text(value.name, text(value.username, "Unknown user")),
  };
}

function normalizeUsers(values, fallback) {
  const list = Array.isArray(values) ? values : fallback ? [fallback] : [];
  return list.map(normalizeUser).filter(Boolean);
}

function labelDetailsEntries(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([name, details]) => ({
      ...(details && typeof details === "object" ? details : { color: details }),
      name,
    }));
  }
  return [];
}

function normalizeLabels(values, details) {
  const detailsByName = new Map();
  for (const entry of labelDetailsEntries(details)) {
    if (!entry || typeof entry !== "object" || entry.name == null) {
      continue;
    }
    const name = text(entry.name);
    const existing = detailsByName.get(name) ?? {};
    detailsByName.set(name, {
      ...existing,
      ...entry,
      name,
      color: text(entry.color) || text(existing.color),
      text_color:
        text(entry.text_color ?? entry.textColor) ||
        text(existing.text_color ?? existing.textColor),
    });
  }
  return (Array.isArray(values) ? values : [])
    .map((label) => {
      const labelObject =
        label && typeof label === "object" && !Array.isArray(label) ? label : null;
      const name = typeof label === "string" ? label : text(labelObject?.name);
      if (!name) {
        return null;
      }
      const detailsForLabel = detailsByName.get(name) ?? {};
      return {
        name,
        color: text(labelObject?.color) || text(detailsForLabel.color),
        textColor:
          text(labelObject?.text_color ?? labelObject?.textColor) ||
          text(detailsForLabel.text_color ?? detailsForLabel.textColor),
      };
    })
    .filter(Boolean);
}

function normalizePipeline(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const pipeline = {
    id: value.id == null ? null : number(value.id),
    status: text(value.status, "unknown"),
    webUrl: text(value.web_url ?? value.webUrl),
  };
  if (Array.isArray(value.jobs)) {
    pipeline.jobs = value.jobs.map((job) => ({
      id: job.id == null ? null : number(job.id),
      name: text(job.name),
      stage: text(job.stage),
      status: text(job.status, "unknown"),
      webUrl: text(job.web_url ?? job.webUrl),
    }));
  }
  return pipeline;
}

function normalizePosition(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    newPath: text(value.new_path ?? value.newPath),
    newLine:
      value.new_line == null && value.newLine == null
        ? null
        : number(value.new_line ?? value.newLine),
    oldPath: text(value.old_path ?? value.oldPath),
    oldLine:
      value.old_line == null && value.oldLine == null
        ? null
        : number(value.old_line ?? value.oldLine),
  };
}

export function normalizeIssue(value = {}) {
  return {
    kind: "issue",
    iid: number(value.iid),
    title: text(value.title, "(untitled issue)"),
    state: text(value.state, "unknown"),
    description: text(value.description),
    webUrl: text(value.web_url ?? value.webUrl),
    author: normalizeUser(value.author),
    assignees: normalizeUsers(value.assignees, value.assignee),
    labels: normalizeLabels(
      value.labels,
      value.label_details ?? value.labelDetails,
    ),
    comments: number(value.user_notes_count ?? value.comments),
    milestone:
      typeof value.milestone === "string"
        ? value.milestone
        : text(value.milestone?.title, ""),
    createdAt: text(value.created_at ?? value.createdAt),
    updatedAt: text(value.updated_at ?? value.updatedAt),
  };
}

export function normalizeMergeRequest(value = {}) {
  const state = text(value.state, "unknown");
  const draft = Boolean(value.draft ?? value.work_in_progress ?? value.wip);
  const status =
    state === "merged" ? "merged" : state === "closed" ? "closed" : draft ? "draft" : state;
  const approvedBy = Array.isArray(value.approved_by)
    ? value.approved_by.map((entry) => normalizeUser(entry.user ?? entry)).filter(Boolean)
    : [];
  const approvals = value.approvals ?? {};
  const userCanApprove =
    value.user_can_approve ??
    value.userCanApprove ??
    approvals.user_can_approve ??
    approvals.userCanApprove;
  const approvalsRequired = number(
    value.approvals_before_merge ??
      approvals.approvals_required ??
      approvals.approvalsRequired,
  );
  const approvalsApproved = Array.isArray(value.approved_by)
    ? approvedBy.length
    : approvals.approvals_left == null
      ? number(approvals.approved)
      : Math.max(0, approvalsRequired - number(approvals.approvals_left));
  const diffRefs = value.diff_refs ?? value.diffRefs;

  return {
    kind: "merge_request",
    iid: number(value.iid),
    title: text(value.title, "(untitled merge request)"),
    state,
    status,
    description: text(value.description),
    webUrl: text(value.web_url ?? value.webUrl),
    author: normalizeUser(value.author),
    assignees: normalizeUsers(value.assignees, value.assignee),
    labels: normalizeLabels(
      value.labels,
      value.label_details ?? value.labelDetails,
    ),
    comments: number(value.user_notes_count ?? value.comments),
    createdAt: text(value.created_at ?? value.createdAt),
    updatedAt: text(value.updated_at ?? value.updatedAt),
    sourceBranch: text(value.source_branch ?? value.sourceBranch),
    targetBranch: text(value.target_branch ?? value.targetBranch),
    diffRefs: diffRefs
      ? {
          baseSha: text(diffRefs.base_sha ?? diffRefs.baseSha),
          headSha: text(diffRefs.head_sha ?? diffRefs.headSha),
          startSha: text(diffRefs.start_sha ?? diffRefs.startSha),
        }
      : null,
    pipeline: normalizePipeline(value.head_pipeline ?? value.pipeline),
    approvals: {
      required: approvalsRequired,
      approved: approvalsApproved,
      approvedBy,
      userApproved: Boolean(
        value.user_has_approved ??
          value.userApproved ??
          approvals.user_has_approved ??
          approvals.userApproved ??
          false,
      ),
      userCanApprove:
        userCanApprove == null ? undefined : Boolean(userCanApprove),
    },
  };
}

export function normalizeDiscussions(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((discussion) => {
    const sourceNotes = Array.isArray(discussion.notes) ? discussion.notes : [];
    const resolvable =
      discussion.resolvable ?? sourceNotes.some((note) => note.resolvable);
    const resolved =
      discussion.resolved ??
      (resolvable &&
        sourceNotes
          .filter((note) => note.resolvable)
          .every((note) => note.resolved));
    const system =
      sourceNotes.length > 0 && sourceNotes.every((note) => Boolean(note.system));
    return {
      id: text(discussion.id),
      resolvable: Boolean(resolvable),
      resolved: Boolean(resolved),
      individualNote: Boolean(discussion.individual_note ?? discussion.individualNote),
      system,
      notes: sourceNotes.map((note) => ({
        id: note.id == null ? null : number(note.id),
        body: text(note.body),
        system: Boolean(note.system),
        author: normalizeUser(note.author),
        createdAt: text(note.created_at ?? note.createdAt),
        position: normalizePosition(note.position),
      })),
    };
  });
}

export function normalizeMergeRequestDiffs(values) {
  const diffs = Array.isArray(values) ? values : values?.changes ?? [];
  return diffs.map((diff) => ({
    oldPath: text(diff.old_path ?? diff.oldPath),
    newPath: text(diff.new_path ?? diff.newPath),
    newFile: Boolean(diff.new_file ?? diff.newFile),
    deletedFile: Boolean(diff.deleted_file ?? diff.deletedFile),
    renamedFile: Boolean(diff.renamed_file ?? diff.renamedFile),
    diff: text(diff.diff),
  }));
}

export function normalizeViewData(view, data = {}) {
  if (view === "issue_list") {
    return {
      items: (Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : []).map(
        normalizeIssue,
      ),
    };
  }
  if (view === "mr_list") {
    return {
      items: (Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : []).map(
        normalizeMergeRequest,
      ),
    };
  }
  if (view === "issue_detail") {
    return {
      issue: normalizeIssue(data.issue ?? data),
      discussions: normalizeDiscussions(data.discussions),
      relatedMergeRequests: (data.relatedMergeRequests ?? []).map(normalizeMergeRequest),
      relatedIssues: (data.relatedIssues ?? []).map(normalizeIssue),
    };
  }
  if (view === "mr_detail") {
    return {
      mergeRequest: normalizeMergeRequest(data.mergeRequest ?? data.merge_request ?? data),
      discussions: normalizeDiscussions(data.discussions),
      diffs: normalizeMergeRequestDiffs(data.diffs ?? data.changes),
      relatedIssues: (data.relatedIssues ?? []).map(normalizeIssue),
    };
  }
  return data;
}
