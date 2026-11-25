import {
  normalizeDiscussions,
  normalizeIssue,
  normalizeMergeRequest,
  normalizeMergeRequestDiffs,
  normalizeViewData,
} from "./data-normalizer.mjs";

async function optionalResult(warnings, label, request, fallback) {
  try {
    return await request();
  } catch (error) {
    warnings.push(`${label}: ${error?.message ?? String(error)}`);
    return fallback;
  }
}

export async function loadViewData(client, state) {
  if (state.view === "issue_list") {
    const items = await client.listIssues(state.filters);
    return { data: { items: items.map(normalizeIssue) }, warnings: [] };
  }
  if (state.view === "mr_list") {
    const items = await client.listMergeRequests(state.filters);
    return { data: { items: items.map(normalizeMergeRequest) }, warnings: [] };
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
    return {
      data: normalizeViewData("issue_detail", {
        issue,
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
  };
  return {
    data: normalizeViewData("mr_detail", {
      mergeRequest: mergeRequestWithDetails,
      discussions: normalizeDiscussions(discussions),
      diffs: normalizeMergeRequestDiffs(changes),
      relatedIssues,
    }),
    warnings,
  };
}
