import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderDiffFiles } from "../.github/extensions/gitlab-canvas/ui/diff-viewer.js";
import { renderIssueDetail } from "../.github/extensions/gitlab-canvas/ui/views/issue-detail.js";
import {
  renderDiscussionThread,
  renderLabels,
} from "../.github/extensions/gitlab-canvas/ui/views/common.js";
import { renderHeader } from "../.github/extensions/gitlab-canvas/ui/views/header.js";
import { renderListView } from "../.github/extensions/gitlab-canvas/ui/views/list-view.js";
import { renderMergeRequestDetail } from "../.github/extensions/gitlab-canvas/ui/views/mr-detail.js";

const stylesheet = readFileSync(
  new URL("../.github/extensions/gitlab-canvas/ui/styles.css", import.meta.url),
  "utf8",
);
const htmlShell = readFileSync(
  new URL("../.github/extensions/gitlab-canvas/ui/index.html", import.meta.url),
  "utf8",
);

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
  assert.doesNotMatch(html, /href="#"/);
  assert.doesNotMatch(html, />Open in GitLab<\/a>/);
  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;/i);
});

test("renders a single Open in GitLab button for the displayed detail item", () => {
  const project = {
    path: "team/repo",
    projectUrl: "https://gitlab.test/team/repo",
  };
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
  };
  const issueState = {
    view: "issue_detail",
    iid: 3,
    mode: "mcp",
    project,
    messages,
    data: {
      issue,
      discussions: [],
      relatedMergeRequests: [],
      relatedIssues: [],
    },
  };
  const issueHtml = `${renderHeader(issueState)}${renderIssueDetail(issueState)}`;
  assert.equal(issueHtml.match(/>Open in GitLab<\/a>/g)?.length, 1);
  assert.match(
    issueHtml,
    /href="https:\/\/gitlab\.test\/team\/repo\/-\/issues\/3"[^>]*>Open in GitLab<\/a>/,
  );
  assert.doesNotMatch(renderIssueDetail(issueState), />Open in GitLab<\/a>/);

  const mergeRequest = {
    iid: 8,
    title: "MR",
    state: "opened",
    status: "opened",
    webUrl: "https://gitlab.test/team/repo/-/merge_requests/8",
    author: { name: "Reviewer" },
    createdAt: "",
    sourceBranch: "feature",
    targetBranch: "main",
    description: "",
    approvals: { required: 1, approved: 0 },
    pipeline: null,
    assignees: [],
    labels: [],
  };
  const mrState = {
    view: "mr_detail",
    iid: 8,
    mode: "mcp",
    project,
    messages,
    data: {
      mergeRequest,
      discussions: [],
      diffs: [],
      relatedIssues: [],
    },
  };
  const mrHtml = `${renderHeader(mrState)}${renderMergeRequestDetail(mrState)}`;
  assert.equal(mrHtml.match(/>Open in GitLab<\/a>/g)?.length, 1);
  assert.match(
    mrHtml,
    /href="https:\/\/gitlab\.test\/team\/repo\/-\/merge_requests\/8"[^>]*>Open in GitLab<\/a>/,
  );
  assert.doesNotMatch(renderMergeRequestDetail(mrState), />Open in GitLab<\/a>/);
});

test("hides the header link when a loaded item URL is unsafe", () => {
  const html = renderHeader({
    view: "issue_detail",
    iid: 3,
    project: {
      path: "team/repo",
      projectUrl: "https://gitlab.test/team/repo",
    },
    data: { issue: { iid: 3, title: "Issue", webUrl: "javascript:alert(1)" } },
    messages,
  });

  assert.doesNotMatch(html, /Open in GitLab/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /target="_blank"/);
});

test("falls back to the project URL while detail data is loading", () => {
  const html = renderHeader({
    view: "mr_detail",
    iid: 8,
    project: {
      path: "team/repo",
      projectUrl: "https://gitlab.test/team/repo",
    },
    data: {},
    messages,
  });

  assert.equal(html.match(/>Open in GitLab<\/a>/g)?.length, 1);
  assert.match(html, /href="https:\/\/gitlab\.test\/team\/repo"/);
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

test("groups Copilot prompts in an accessible dropdown", () => {
  const issueHtml = renderIssueDetail({
    view: "issue_detail",
    mode: "mcp",
    project: { projectUrl: "https://gitlab.test/team/repo" },
    messages: {
      ...messages,
      askCopilot: "Ask Copilot",
      gitlabActions: "GitLab actions",
      investigate: "Investigate this item",
      plan: "Create an implementation plan",
    },
    data: {
      issue: {
        iid: 3,
        title: "Issue",
        state: "opened",
        webUrl: "https://gitlab.test/team/repo/-/issues/3",
        description: "",
        assignees: [],
        labels: [],
      },
      discussions: [],
      relatedMergeRequests: [],
      relatedIssues: [],
    },
  });
  const mrHtml = renderMergeRequestDetail({
    view: "mr_detail",
    mode: "mcp",
    project: { projectUrl: "https://gitlab.test/team/repo" },
    messages: {
      ...messages,
      askCopilot: "Ask Copilot",
      gitlabActions: "GitLab actions",
      review: "Review this merge request",
      fixFeedback: "Address review feedback",
    },
    data: {
      mergeRequest: {
        iid: 8,
        title: "MR",
        state: "opened",
        status: "opened",
        webUrl: "https://gitlab.test/team/repo/-/merge_requests/8",
        description: "",
        approvals: { userApproved: false },
        assignees: [],
        labels: [],
      },
      discussions: [],
      diffs: [],
      relatedIssues: [],
    },
  });

  for (const html of [issueHtml, mrHtml]) {
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /role="menu"/);
    assert.match(html, /role="menuitem"/);
    assert.match(html, /class="gitlab-actions" role="group"/);
  }
  assert.match(issueHtml, /data-intent="investigate"[^>]*>Investigate this item<\/button>/);
  assert.match(issueHtml, /data-intent="plan"[^>]*>Create an implementation plan<\/button>/);
  assert.match(mrHtml, /data-intent="review"[^>]*>Review this merge request<\/button>/);
  assert.match(mrHtml, /data-intent="fix"[^>]*>Address review feedback<\/button>/);
  assert.match(
    stylesheet,
    /\.copilot-menu-panel\s*\{[^}]*z-index:\s*2;[^}]*width:\s*min\(15rem,\s*calc\(100vw - 36px\)\);[^}]*background:\s*var\(--canvas-bg\);[^}]*color:\s*var\(--canvas-text\);/,
  );
});

test("shows only the valid approval action for the current MR state", () => {
  const render = (state, approvals) =>
    renderMergeRequestDetail({
      view: "mr_detail",
      mode: "mcp",
      messages,
      data: {
        mergeRequest: {
          iid: 8,
          title: "MR",
          state,
          status: state,
          description: "",
          approvals,
          assignees: [],
          labels: [],
        },
        discussions: [],
        diffs: [],
        relatedIssues: [],
      },
    });
  const commands = (html) =>
    [...html.matchAll(/data-command="(approve|unapprove)"/g)].map(
      (match) => match[1],
    );

  assert.deepEqual(commands(render("opened", { userApproved: false })), ["approve"]);
  assert.deepEqual(commands(render("opened", { userApproved: true })), ["unapprove"]);
  assert.deepEqual(
    commands(render("opened", { userApproved: false, userCanApprove: false })),
    [],
  );
  assert.deepEqual(
    commands(render("opened", { userApproved: true, userCanApprove: false })),
    ["unapprove"],
  );
  const merged = render("merged", { userApproved: false });
  assert.deepEqual(commands(merged), []);
  assert.doesNotMatch(merged, /class="gitlab-actions"/);
  assert.deepEqual(commands(render("closed", { userApproved: true })), []);
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

test("renders the GitLab icon and issue title in the header", () => {
  const html = renderHeader({
    view: "issue_detail",
    iid: 42,
    project: {
      path: "team/repo",
      projectUrl: "https://gitlab.test/team/repo",
    },
    data: { issue: { iid: 42, title: "Improve & verify labels" } },
    messages: { issues: "Issues", mergeRequests: "Merge requests" },
  });

  assert.match(html, /<svg class="gitlab-icon"[^>]*aria-hidden="true"/);
  assert.match(html, /<span class="header-title">#42 Improve &amp; verify labels<\/span>/);
  assert.match(html, /title="[^"]*team\/repo/);
  assert.match(html, /href="https:\/\/gitlab\.test\/team\/repo"/);
  assert.doesNotMatch(html, /<span class="header-title">team\/repo<\/span>/);

  const mrHtml = renderHeader({
    view: "mr_detail",
    iid: 8,
    project: { path: "team/repo" },
    data: { mergeRequest: { iid: 8, title: "Update API contract" } },
    messages: { issues: "Issues", mergeRequests: "Merge requests" },
  });
  assert.match(
    mrHtml,
    /<span class="header-title">!8 Update API contract<\/span>/,
  );
});

test("uses localized list names instead of the project path in the header", () => {
  const html = renderHeader({
    view: "mr_list",
    project: {
      path: "team/repo",
      projectUrl: "https://gitlab.test/team/repo",
    },
    messages: { mergeRequests: "Merge requests" },
  });

  assert.match(html, /<span class="header-title">Merge requests<\/span>/);
  assert.doesNotMatch(html, /<span class="header-title">team\/repo<\/span>/);
  assert.equal(html.match(/>Open in GitLab<\/a>/g)?.length, 1);
  assert.match(
    html,
    /href="https:\/\/gitlab\.test\/team\/repo"[^>]*>Open in GitLab<\/a>/,
  );

  const unsafe = renderHeader({
    view: "issue_list",
    project: { projectUrl: "javascript:alert(1)" },
    messages: { issues: "Issues" },
  });
  assert.doesNotMatch(unsafe, /href="javascript:/i);
  assert.doesNotMatch(unsafe, /target="_blank"/);
});

test("shows item IIDs while detail data is loading and hides unavailable links", () => {
  const issueHtml = renderHeader({
    view: "issue_detail",
    iid: 42,
    project: { path: "team/repo" },
    data: {},
  });
  const mrHtml = renderHeader({
    view: "mr_detail",
    iid: 8,
    project: { path: "team/repo" },
    data: {},
  });

  assert.match(issueHtml, /<span class="header-title">#42<\/span>/);
  assert.match(mrHtml, /<span class="header-title">!8<\/span>/);
  assert.doesNotMatch(issueHtml, /<a\b[^>]*target="_blank"/);
  assert.doesNotMatch(issueHtml, /href="#"/);
});

test("keeps header controls on one line while allowing the header to wrap", () => {
  assert.match(stylesheet, /\.app-header\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(
    stylesheet,
    /\.header-nav button,\s*\.header-actions > \*,\s*\.mode-indicator,\s*\.language-select\s*\{[^}]*flex-shrink:\s*0;[^}]*white-space:\s*nowrap/s,
  );
  assert.match(stylesheet, /\.header-title\s*\{[^}]*min-width:\s*0/);
  assert.match(stylesheet, /\.header-title\s*\{[^}]*text-overflow:\s*ellipsis/);
});

test("renders safe label colors with a contrasting text color", () => {
  const html = renderLabels([
    { name: "light", color: "#ffffff" },
    { name: "dark", color: "#000000" },
    { name: "explicit", color: "#123456", textColor: "#abcdef" },
    { name: "fallback-text", color: "#ffffff", textColor: "red;display:none" },
    { name: "plain" },
    { name: "unsafe", color: '";background:url(javascript:alert(1))' },
  ]);

  assert.match(
    html,
    /style="background-color:#ffffff;color:#1f2328"/,
  );
  assert.match(
    html,
    /style="background-color:#000000;color:#ffffff"/,
  );
  assert.match(
    html,
    /style="background-color:#123456;color:#abcdef"/,
  );
  assert.equal(
    html.match(/style="background-color:#ffffff;color:#1f2328"/g)?.length,
    2,
  );
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /red;display:none/);
});

test("does not render replies or resolve controls for system discussions", () => {
  const state = {
    mode: "mcp",
    project: { projectUrl: "https://gitlab.test/team/repo" },
    messages: { resolve: "Resolve", reply: "Reply" },
  };
  const systemHtml = renderDiscussionThread(
    {
      id: "system-thread",
      system: true,
      resolvable: true,
      resolved: false,
      notes: [
        {
          system: true,
          body: "assigned to reviewer",
          author: { name: "GitLab" },
          createdAt: "2026-02-01T10:00:00Z",
        },
      ],
    },
    state,
    { allowResolve: true },
  );
  const userHtml = renderDiscussionThread(
    {
      id: "user-thread",
      system: false,
      resolvable: true,
      resolved: false,
      notes: [{ system: false, body: "Please review this change" }],
    },
    state,
    { allowResolve: true },
  );

  assert.match(systemHtml, /discussion-thread is-system/);
  assert.doesNotMatch(systemHtml, /data-form="reply"/);
  assert.doesNotMatch(systemHtml, /data-command="resolve"/);
  assert.match(userHtml, /data-form="reply"/);
  assert.match(userHtml, /data-command="resolve"/);
});

test("uses only theme-contract colors and adaptive surfaces in dark mode", () => {
  assert.doesNotMatch(
    stylesheet,
    /--(?:background-color-secondary|background-color-danger|background-color-success|color-accent-emphasis|text-color-link)\b/,
  );
  assert.match(stylesheet, /color-mix\(\s*in srgb/);
  assert.match(stylesheet, /:root\[data-color-mode="dark"\]/);
  assert.match(stylesheet, /body\[data-color-mode="dark"\]/);
  assert.match(stylesheet, /@media \(prefers-color-scheme: dark\)/);
  assert.match(stylesheet, /--canvas-bg:\s*var\(--background-color-default,\s*#ffffff\)/);
  assert.match(stylesheet, /--canvas-bg:\s*var\(--background-color-default,\s*#0d1117\)/);
  assert.match(stylesheet, /--canvas-green:\s*var\(--true-color-green,\s*#[0-9a-f]{6}\)/i);
  assert.match(stylesheet, /--canvas-yellow:\s*var\(--true-color-yellow,\s*#[0-9a-f]{6}\)/i);
  assert.match(stylesheet, /--status-bar-color:\s*var\(--canvas-bg\)/);
  assert.doesNotMatch(htmlShell, /<meta[^>]+name="theme-color"[^>]*var\(/i);
});

test("uses visible dark-mode hovers and constrains narrow tables and header rows", () => {
  assert.match(
    stylesheet,
    /\.secondary-button:hover\s*\{[^}]*background:\s*var\(--canvas-surface-hover\)/,
  );
  assert.match(
    stylesheet,
    /\.primary-button:hover\s*\{[^}]*background:\s*color-mix/,
  );
  assert.match(
    stylesheet,
    /\.markdown-body table\s*\{[^}]*display:\s*block;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/,
  );
  assert.match(
    stylesheet,
    /@media \(max-width: 620px\)[\s\S]*?\.header-actions\s*\{[^}]*justify-content:\s*flex-start;[^}]*margin-left:\s*0;/,
  );
});
