import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDiscussions,
  normalizeIssue,
  normalizeMergeRequest,
  normalizeMergeRequestDiffs,
} from "../.github/extensions/gitlab-canvas/lib/data-normalizer.mjs";

test("normalizes issue fields and tolerates missing optional values", () => {
  assert.deepEqual(
    normalizeIssue({
      iid: 12,
      title: "Broken widget",
      state: "opened",
      description: null,
      web_url: "https://gitlab.test/team/app/-/issues/12",
      author: { id: 1, username: "ada", name: "Ada Lovelace" },
      assignees: [{ id: 2, username: "grace", name: "Grace Hopper" }],
      labels: ["bug"],
      label_details: [
        { name: "bug", color: "#d73a4a", text_color: "#ffffff" },
      ],
      user_notes_count: 3,
      milestone: { title: "M1" },
      created_at: "2026-01-02T03:04:05Z",
      updated_at: "2026-01-03T03:04:05Z",
    }),
    {
      kind: "issue",
      iid: 12,
      title: "Broken widget",
      state: "opened",
      description: "",
      webUrl: "https://gitlab.test/team/app/-/issues/12",
      author: { id: 1, username: "ada", name: "Ada Lovelace" },
      assignees: [{ id: 2, username: "grace", name: "Grace Hopper" }],
      labels: [{ name: "bug", color: "#d73a4a", textColor: "#ffffff" }],
      comments: 3,
      milestone: "M1",
      createdAt: "2026-01-02T03:04:05Z",
      updatedAt: "2026-01-03T03:04:05Z",
    },
  );
});

test("normalizes merge request draft, pipeline, and approval metadata", () => {
  const mr = normalizeMergeRequest({
    iid: 8,
    title: "Ship feature",
    state: "opened",
    draft: true,
    source_branch: "feature",
    target_branch: "main",
    diff_refs: { base_sha: "base", head_sha: "head", start_sha: "start" },
    author: { id: 4, username: "lin", name: "Lin" },
    assignees: [],
    labels: [{ name: "bug", color: "#abc", text_color: "#ffffff" }],
    user_notes_count: 0,
    head_pipeline: {
      id: 25,
      status: "success",
      web_url: "https://gitlab.test/team/app/-/pipelines/25",
      jobs: [{ id: 26, name: "test", stage: "test", status: "success" }],
    },
    approvals_before_merge: 2,
    approved_by: [{ user: { id: 6, username: "sam", name: "Sam" } }],
  });

  assert.equal(mr.kind, "merge_request");
  assert.equal(mr.status, "draft");
  assert.equal(mr.sourceBranch, "feature");
  assert.deepEqual(mr.labels, [
    { name: "bug", color: "#abc", textColor: "#ffffff" },
  ]);
  assert.deepEqual(mr.diffRefs, {
    baseSha: "base",
    headSha: "head",
    startSha: "start",
  });
  assert.deepEqual(mr.pipeline, {
    id: 25,
    status: "success",
    webUrl: "https://gitlab.test/team/app/-/pipelines/25",
    jobs: [
      {
        id: 26,
        name: "test",
        stage: "test",
        status: "success",
        webUrl: "",
      },
    ],
  });
  assert.equal(mr.approvals.required, 2);
  assert.equal(mr.approvals.approved, 1);
  assert.equal(mr.approvals.userApproved, false);
});

test("normalizes discussion threads including inline diff positions", () => {
  assert.deepEqual(
    normalizeDiscussions([
      {
        id: "thread-1",
        resolvable: true,
        resolved: false,
        individualNote: false,
        system: false,
        notes: [
          {
            id: 20,
            body: "Please adjust this line",
            system: false,
            author: { id: 7, username: "reviewer", name: "Reviewer" },
            created_at: "2026-02-01T10:00:00Z",
            position: {
              new_path: "src/app.js",
              new_line: 18,
              old_path: "src/app.js",
              old_line: null,
            },
          },
        ],
      },
    ]),
    [
      {
        id: "thread-1",
        resolvable: true,
        resolved: false,
        individualNote: false,
        system: false,
        notes: [
          {
            id: 20,
            body: "Please adjust this line",
            system: false,
            author: { id: 7, username: "reviewer", name: "Reviewer" },
            createdAt: "2026-02-01T10:00:00Z",
            position: {
              newPath: "src/app.js",
              newLine: 18,
              oldPath: "src/app.js",
              oldLine: null,
            },
          },
        ],
      },
    ],
  );
});

test("derives discussion resolution state from resolvable notes", () => {
  assert.deepEqual(
    normalizeDiscussions([
      {
        id: "resolved-thread",
        notes: [
          { id: 1, body: "Resolved", resolvable: true, resolved: true },
          { id: 2, body: "Reply", resolvable: false, resolved: false },
        ],
      },
      {
        id: "open-thread",
        notes: [{ id: 3, body: "Open", resolvable: true, resolved: false }],
      },
    ]),
    [
      {
        id: "resolved-thread",
        resolvable: true,
        resolved: true,
        individualNote: false,
        system: false,
        notes: [
          {
            id: 1,
            body: "Resolved",
            system: false,
            author: null,
            createdAt: "",
            position: null,
          },
          {
            id: 2,
            body: "Reply",
            system: false,
            author: null,
            createdAt: "",
            position: null,
          },
        ],
      },
      {
        id: "open-thread",
        resolvable: true,
        resolved: false,
        individualNote: false,
        system: false,
        notes: [
          {
            id: 3,
            body: "Open",
            system: false,
            author: null,
            createdAt: "",
            position: null,
          },
        ],
      },
    ],
  );
});

test("normalizes label objects and label detail aliases", () => {
  const issue = normalizeIssue({
    labels: [
      "plain",
      { name: "already detailed", color: "#123456", text_color: "#abcdef" },
    ],
    labelDetails: [{ name: "plain", color: "#fff", textColor: "#1f2328" }],
  });
  assert.deepEqual(issue.labels, [
    { name: "plain", color: "#fff", textColor: "#1f2328" },
    {
      name: "already detailed",
      color: "#123456",
      textColor: "#abcdef",
    },
  ]);
});

test("marks a discussion as system-only only when every note is a system note", () => {
  const [systemThread, mixedThread, emptyThread] = normalizeDiscussions([
    {
      id: "system",
      notes: [{ id: 1, body: "assigned to", system: true }],
    },
    {
      id: "mixed",
      notes: [
        { id: 2, body: "system event", system: true },
        { id: 3, body: "user reply", system: false },
      ],
    },
    { id: "empty", notes: [] },
  ]);

  assert.equal(systemThread.system, true);
  assert.equal(systemThread.notes[0].system, true);
  assert.equal(mixedThread.system, false);
  assert.equal(mixedThread.notes[1].system, false);
  assert.equal(emptyThread.system, false);
});

test("normalizes diff metadata without dropping patch text", () => {
  assert.deepEqual(
    normalizeMergeRequestDiffs([
      {
        old_path: "src/old.js",
        new_path: "src/new.js",
        new_file: false,
        deleted_file: false,
        renamed_file: true,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      },
    ]),
    [
      {
        oldPath: "src/old.js",
        newPath: "src/new.js",
        newFile: false,
        deletedFile: false,
        renamedFile: true,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      },
    ],
  );
});
