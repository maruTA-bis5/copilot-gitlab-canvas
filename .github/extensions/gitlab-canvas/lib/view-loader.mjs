import {
  normalizeDiscussions,
  normalizeIssue,
  normalizeMergeRequest,
  normalizeMergeRequestDiffs,
  normalizeViewData,
} from "./data-normalizer.mjs";
import { normalizeFilters } from "./panel-navigation.mjs";

async function optionalResult(warnings, label, request, fallback) {
  try {
    return await request();
  } catch (error) {
    warnings.push(`${label}: ${error?.message ?? String(error)}`);
    return fallback;
  }
}

function labelDetailsFor(item) {
  const details = item?.label_details ?? item?.labelDetails;
  if (Array.isArray(details)) {
    return details;
  }
  if (details && typeof details === "object") {
    return Object.entries(details).map(([name, value]) => ({
      ...(value && typeof value === "object" ? value : { color: value }),
      name,
    }));
  }
  return [];
}

function needsProjectLabelDetails(item) {
  const labels = Array.isArray(item?.labels) ? item.labels : [];
  const detailsByName = new Map(
    labelDetailsFor(item)
      .filter((entry) => entry && typeof entry === "object" && entry.name != null)
      .map((entry) => [String(entry.name), entry]),
  );
  return labels.some((label) => {
    const name = typeof label === "string" ? label : String(label?.name ?? "");
    const color = label && typeof label === "object" ? label.color : "";
    return Boolean(name && !color && !detailsByName.get(name)?.color);
  });
}

async function addProjectLabelDetails(client, items, warnings) {
  if (
    typeof client.getProjectLabels !== "function" ||
    !items.some(needsProjectLabelDetails)
  ) {
    return items;
  }

  const definitions = await optionalResult(
    warnings,
    "Project label definitions",
    () => client.getProjectLabels(),
    [],
  );
  if (!Array.isArray(definitions) || !definitions.length) {
    return items;
  }

  return items.map((item) =>
    needsProjectLabelDetails(item)
      ? {
          ...item,
          label_details: [...definitions, ...labelDetailsFor(item)],
        }
      : item,
  );
}

export async function loadViewData(client, state) {
  if (state.view === "issue_list") {
    const filters = normalizeFilters(state.filters, {}, state.view);
    const items = await client.listIssues(filters);
    const warnings = [];
    const itemsWithLabels = await addProjectLabelDetails(client, items, warnings);
    return {
      data: { items: itemsWithLabels.map(normalizeIssue) },
      warnings,
    };
  }
  if (state.view === "mr_list") {
    const items = await client.listMergeRequests(state.filters);
    const warnings = [];
    const itemsWithLabels = await addProjectLabelDetails(client, items, warnings);
    return {
      data: { items: itemsWithLabels.map(normalizeMergeRequest) },
      warnings,
    };
  }
  if (!Number.isInteger(Number(state.iid)) || Number(state.iid) < 1) {
    throw Object.assign(
      new Error("A positive issue or merge request IID is required."),
      { code: "gitlab_item_unresolved" },
    );
  }

  const warnings = [];
  if (state.view === "issue_detail") {
    const [issue, discussions, relatedMergeRequests, relatedIssues] =
      await Promise.all([
        client.getIssue(state.iid),
        optionalResult(
          warnings,
          "Issue discussions",
          () => client.getDiscussions("issues", state.iid),
          [],
        ),
        optionalResult(
          warnings,
          "Related merge requests",
          () => client.getRelatedMergeRequests(state.iid),
          [],
        ),
        optionalResult(
          warnings,
          "Related issues",
          () => client.getRelatedIssues(state.iid),
          [],
        ),
      ]);
    const [issueWithLabels] = await addProjectLabelDetails(
      client,
      [issue],
      warnings,
    );
    return {
      data: normalizeViewData("issue_detail", {
        issue: issueWithLabels,
        discussions,
        relatedMergeRequests,
        relatedIssues,
      }),
      warnings,
    };
  }

  const [mergeRequest, discussions, changes, relatedIssues, approvals] =
    await Promise.all([
      client.getMergeRequest(state.iid),
      optionalResult(
        warnings,
        "Merge request discussions",
        () => client.getDiscussions("merge_requests", state.iid),
        [],
      ),
      optionalResult(
        warnings,
        "Merge request changes",
        () => client.getMergeRequestChanges(state.iid),
        [],
      ),
      optionalResult(
        warnings,
        "Closing issues",
        () => client.getMergeRequestClosingIssues(state.iid),
        [],
      ),
      optionalResult(
        warnings,
        "Approval details",
        () => client.getApprovals(state.iid),
        null,
      ),
    ]);
  const pipelineJobs = mergeRequest.head_pipeline?.id
    ? await optionalResult(
        warnings,
        "Pipeline jobs",
        () => client.getPipelineJobs(mergeRequest.head_pipeline.id),
        [],
      )
    : [];
  const mergeRequestWithDetails = {
    ...mergeRequest,
    head_pipeline: mergeRequest.head_pipeline
      ? { ...mergeRequest.head_pipeline, jobs: pipelineJobs }
      : null,
    approved_by: approvals?.approved_by ?? mergeRequest.approved_by,
    approvals_before_merge:
      approvals?.approvals_before_merge ?? mergeRequest.approvals_before_merge,
    user_has_approved:
      approvals?.user_has_approved ?? mergeRequest.user_has_approved,
    user_can_approve:
      approvals?.user_can_approve ?? mergeRequest.user_can_approve,
  };
  const [mergeRequestWithLabels] = await addProjectLabelDetails(
    client,
    [mergeRequestWithDetails],
    warnings,
  );
  return {
    data: normalizeViewData("mr_detail", {
      mergeRequest: mergeRequestWithLabels,
      discussions: normalizeDiscussions(discussions),
      diffs: normalizeMergeRequestDiffs(changes),
      relatedIssues,
    }),
    warnings,
  };
}
