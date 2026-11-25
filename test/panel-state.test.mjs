import assert from "node:assert/strict";
import test from "node:test";
import { createPanelClientState } from "../.github/extensions/gitlab-canvas/lib/panel-state.mjs";
import { backendLabel } from "../.github/extensions/gitlab-canvas/ui/views/common.js";
import { renderIssueDetail } from "../.github/extensions/gitlab-canvas/ui/views/issue-detail.js";

const panelState = {
  view: "issue_detail",
  project: { projectUrl: "https://gitlab.test/team/repo" },
  data: {
    issue: {
      iid: 3,
      title: "Upload routing",
      state: "opened",
      webUrl: "https://gitlab.test/team/repo/-/issues/3",
      author: { name: "Reporter" },
      createdAt: "",
      description: "![diagram](/uploads/hash/diagram.png)",
      assignees: [],
      labels: [],
      milestone: "",
    },
    discussions: [],
    relatedMergeRequests: [],
    relatedIssues: [],
  },
};

test("exposes each backend mode to the UI and routes uploads accordingly", () => {
  const glabState = createPanelClientState(panelState, "glab", "en");
  const glabHtml = renderIssueDetail(glabState);
  assert.equal(backendLabel(glabState.mode), "glab");
  assert.match(glabHtml, /<img[^>]*data-upload-path="\/uploads\/hash\/diagram\.png"/);

  const mcpState = createPanelClientState(panelState, "mcp", "en");
  const mcpHtml = renderIssueDetail(mcpState);
  assert.equal(backendLabel(mcpState.mode), "MCP");
  assert.match(
    mcpHtml,
    /href="https:\/\/gitlab\.test\/uploads\/hash\/diagram\.png"/,
  );
  assert.doesNotMatch(mcpHtml, /<img/);
});
