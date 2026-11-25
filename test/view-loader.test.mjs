import assert from "node:assert/strict";
import test from "node:test";
import { loadViewData } from "../.github/extensions/gitlab-canvas/lib/view-loader.mjs";

test("retains MR details when optional GitLab endpoints fail", async () => {
  const client = {
    getMergeRequest: async () => ({
      iid: 8,
      title: "Main MR",
      state: "opened",
      head_pipeline: { id: 21, status: "running" },
    }),
    getDiscussions: async () => { throw new Error("403 discussions"); },
    getMergeRequestChanges: async () => { throw new Error("404 changes"); },
    getMergeRequestClosingIssues: async () => { throw new Error("403 related"); },
    getApprovals: async () => { throw new Error("403 approvals"); },
    getPipelineJobs: async () => { throw new Error("403 jobs"); },
  };

  const result = await loadViewData(client, {
    view: "mr_detail",
    iid: 8,
    filters: {},
  });

  assert.equal(result.data.mergeRequest.title, "Main MR");
  assert.deepEqual(result.data.discussions, []);
  assert.deepEqual(result.data.diffs, []);
  assert.deepEqual(result.data.relatedIssues, []);
  assert.deepEqual(result.data.mergeRequest.pipeline.jobs, []);
  assert.equal(result.warnings.length, 5);
  assert.match(result.warnings.join("\n"), /403 discussions/);
});

test("does not suppress failure of the primary issue request", async () => {
  await assert.rejects(
    loadViewData(
      {
        getIssue: async () => { throw new Error("issue unavailable"); },
        getDiscussions: async () => [],
        getRelatedMergeRequests: async () => [],
        getRelatedIssues: async () => [],
      },
      { view: "issue_detail", iid: 7 },
    ),
    /issue unavailable/,
  );
});

test("normalizes merged state before loading the issue list", async () => {
  let receivedFilters;
  await loadViewData(
    {
      listIssues: async (filters) => {
        receivedFilters = filters;
        return [];
      },
    },
    { view: "issue_list", filters: { state: "merged", page: 1 } },
  );

  assert.equal(receivedFilters.state, "opened");
});

test("enriches list labels from project definitions when detailed data is missing", async () => {
  let labelRequests = 0;
  const result = await loadViewData(
    {
      listIssues: async () => [
        { iid: 7, title: "Issue", labels: ["bug", "docs"] },
      ],
      getProjectLabels: async () => {
        labelRequests += 1;
        return [
          { name: "bug", color: "#d73a4a", text_color: "#ffffff" },
          { name: "docs", color: "#0075ca", text_color: "#1f2328" },
        ];
      },
    },
    { view: "issue_list", filters: {} },
  );

  assert.equal(labelRequests, 1);
  assert.deepEqual(result.data.items[0].labels, [
    { name: "bug", color: "#d73a4a", textColor: "#ffffff" },
    { name: "docs", color: "#0075ca", textColor: "#1f2328" },
  ]);
  assert.deepEqual(result.warnings, []);
});

test("enriches single-item labels and avoids refetching supplied label details", async () => {
  let labelRequests = 0;
  const result = await loadViewData(
    {
      getIssue: async () => ({
        iid: 7,
        title: "Issue",
        labels: ["bug", "docs"],
        label_details: [
          { name: "bug", color: "#d73a4a", text_color: "#ffffff" },
        ],
      }),
      getProjectLabels: async () => {
        labelRequests += 1;
        return [{ name: "docs", color: "#0075ca", text_color: "#1f2328" }];
      },
      getDiscussions: async () => [],
      getRelatedMergeRequests: async () => [],
      getRelatedIssues: async () => [],
    },
    { view: "issue_detail", iid: 7, filters: {} },
  );

  assert.equal(labelRequests, 1);
  assert.deepEqual(result.data.issue.labels, [
    { name: "bug", color: "#d73a4a", textColor: "#ffffff" },
    { name: "docs", color: "#0075ca", textColor: "#1f2328" },
  ]);
  assert.deepEqual(result.warnings, []);
});

test("keeps list data if project label details are unavailable", async () => {
  const result = await loadViewData(
    {
      listMergeRequests: async () => [
        { iid: 8, title: "MR", labels: ["blocked"] },
      ],
      getProjectLabels: async () => {
        throw new Error("403 labels");
      },
    },
    { view: "mr_list", filters: {} },
  );

  assert.deepEqual(result.data.items[0].labels, [
    { name: "blocked", color: "", textColor: "" },
  ]);
  assert.match(result.warnings.join("\n"), /403 labels/);
});

test("enriches merge request detail labels from project definitions", async () => {
  const result = await loadViewData(
    {
      getMergeRequest: async () => ({
        iid: 8,
        title: "MR",
        state: "opened",
        labels: ["review-needed"],
      }),
      getProjectLabels: async () => [
        { name: "review-needed", color: "#8250df", text_color: "#ffffff" },
      ],
      getDiscussions: async () => [],
      getMergeRequestChanges: async () => [],
      getMergeRequestClosingIssues: async () => [],
      getApprovals: async () => null,
    },
    { view: "mr_detail", iid: 8, filters: {} },
  );

  assert.deepEqual(result.data.mergeRequest.labels, [
    { name: "review-needed", color: "#8250df", textColor: "#ffffff" },
  ]);
  assert.deepEqual(result.warnings, []);
});
