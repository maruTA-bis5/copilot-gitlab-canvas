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
