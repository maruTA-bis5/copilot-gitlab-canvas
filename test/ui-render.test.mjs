import assert from "node:assert/strict";
import test from "node:test";
import { renderDiffFiles } from "../.github/extensions/gitlab-canvas/ui/diff-viewer.js";
import { renderIssueDetail } from "../.github/extensions/gitlab-canvas/ui/views/issue-detail.js";
import { renderListView } from "../.github/extensions/gitlab-canvas/ui/views/list-view.js";
import { renderMergeRequestDetail } from "../.github/extensions/gitlab-canvas/ui/views/mr-detail.js";

const messages = {
  openInGitLab: "Open in GitLab",
  noDescription: "No description",
  noDiscussions: "No discussions",
  noResults: "No results",
  comments: "Comments",
  close: "Close",
  reopen: "Reopen",
  opened: "Opened",
  closed: "Closed",
};

test("escapes untrusted issue titles and labels in the list view", () => {
  const html = renderListView({
    view: "issue_list",
    filters: { state: "opened", labels: [], page: 1 },
    messages,
    data: {
      items: [
        {
          iid: 10,
          title: '<img src=x onerror="alert(1)">',
          state: "opened",
          labels: ["<script>"],
          author: { name: "Reporter" },
          assignees: [],
          comments: 0,
          updatedAt: "",
        },
      ],
    },
  });

  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.match(html, /&lt;script&gt;/);
});

test("restricts item links to HTTP(S) and escapes detail content", () => {
  const html = renderIssueDetail({
    view: "issue_detail",
    mode: "mcp",
    project: { projectUrl: "https://gitlab.test/team/repo" },
    messages,
    data: {
      issue: {
        iid: 3,
        title: "<b>unsafe title</b>",
        state: "opened",
        webUrl: "javascript:alert(1)",
        author: { name: "User" },
        createdAt: "",
        description: "<script>alert(1)</script>",
        assignees: [],
        labels: [],
        milestone: "",
      },
      discussions: [],
      relatedMergeRequests: [],
      relatedIssues: [],
    },
  });

  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;/i);
});

test("uses Close and Reopen action labels for issues and merge requests", () => {
  const issue = {
    iid: 3,
    title: "Issue",
    state: "opened",
    webUrl: "https://gitlab.test/team/repo/-/issues/3",
    author: { name: "Reporter" },
    createdAt: "",
    description: "",
    assignees: [],
    labels: [],
    milestone: "",
  };
  const issueView = (state) =>
    renderIssueDetail({
      view: "issue_detail",
      mode: "mcp",
      project: { projectUrl: "https://gitlab.test/team/repo" },
      messages,
      data: {
        issue: { ...issue, state },
        discussions: [],
        relatedMergeRequests: [],
        relatedIssues: [],
      },
    });
  assert.match(issueView("opened"), /data-state="closed">Close<\/button>/);
  assert.match(issueView("closed"), /data-state="opened">Reopen<\/button>/);

  const mergeRequest = {
    iid: 8,
    title: "MR",
    status: "opened",
    webUrl: "https://gitlab.test/team/repo/-/merge_requests/8",
    author: { name: "Reviewer" },
    createdAt: "",
    sourceBranch: "feature",
    targetBranch: "main",
    state: "opened",
    description: "",
    approvals: { required: 1, approved: 0 },
    pipeline: null,
    assignees: [],
    labels: [],
  };
  const mrView = (state) =>
    renderMergeRequestDetail({
      view: "mr_detail",
      mode: "mcp",
      project: { projectUrl: "https://gitlab.test/team/repo" },
      messages,
      data: {
        mergeRequest: { ...mergeRequest, state, status: state },
        discussions: [],
        diffs: [],
        relatedIssues: [],
      },
    });
  assert.match(mrView("opened"), /data-state="closed"[^>]*>Close<\/button>/);
  assert.match(mrView("closed"), /data-state="opened"[^>]*>Reopen<\/button>/);
});

test("omits merged from the issue filter but retains it for merge requests", () => {
  const render = (view) =>
    renderListView({
      view,
      filters: { state: "opened", labels: [], page: 1 },
      messages,
      data: { items: [] },
    });
  assert.doesNotMatch(render("issue_list"), /<option value="merged"/);
  assert.match(render("mr_list"), /<option value="merged"/);
});

test("renders MR pipeline jobs and safely escaped unified diff lines", () => {
  const state = {
    view: "mr_detail",
    activeTab: "changes",
    mode: "glab",
    project: { projectUrl: "https://gitlab.test/team/repo" },
    messages,
    data: {
      mergeRequest: {
        iid: 9,
        title: "Refactor",
        state: "opened",
        status: "opened",
        webUrl: "https://gitlab.test/team/repo/-/merge_requests/9",
        author: { name: "Reviewer" },
        createdAt: "",
        sourceBranch: "feature",
        targetBranch: "main",
        diffRefs: { baseSha: "base", headSha: "head", startSha: "start" },
        approvals: { approved: 1, required: 2 },
        pipeline: {
          id: 21,
          status: "success",
          webUrl: "javascript:alert(1)",
          jobs: [{ name: "test", stage: "test", status: "success" }],
        },
        assignees: [],
        labels: [],
      },
      discussions: [],
      diffs: [
        {
          oldPath: "src/app.js",
          newPath: "src/app.js",
          diff: "@@ -1 +1 @@\n- old\n+ <script>alert(1)</script>\n",
        },
      ],
      relatedIssues: [],
    },
  };
  const overview = renderMergeRequestDetail({ ...state, activeTab: "overview" });
  const diff = renderDiffFiles(state.data.diffs, [], state);
  const changes = renderMergeRequestDetail(state);

  assert.match(overview, /test \(success\)/);
  assert.doesNotMatch(overview, /href="javascript:/i);
  assert.doesNotMatch(diff, /<script>/i);
  assert.match(diff, /&lt;script&gt;/i);
  assert.match(changes, /data-diff-comment/);
  assert.match(diff, /data-base-sha="base"/);
});
