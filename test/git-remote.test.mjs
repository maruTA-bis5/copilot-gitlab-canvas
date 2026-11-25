import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGitLabItemUrl,
  parseGitLabUrl,
  parseGitRemote,
  getOriginRemote,
  resolveProject,
} from "../.github/extensions/gitlab-canvas/lib/git-remote.mjs";

test("parses HTTPS remotes with ports and nested subgroups", () => {
  assert.deepEqual(
    parseGitRemote("https://gitlab.example.com:8443/group/subgroup/repo.git"),
    {
      baseUrl: "https://gitlab.example.com:8443",
      host: "gitlab.example.com:8443",
      project: "group/subgroup/repo",
      projectId: "group%2Fsubgroup%2Frepo",
      projectUrl: "https://gitlab.example.com:8443/group/subgroup/repo",
    },
  );
});

test("parses SCP-style and ssh:// GitLab remotes", () => {
  assert.equal(
    parseGitRemote("git@gitlab.example.com:group/subgroup/repo.git").project,
    "group/subgroup/repo",
  );
  assert.deepEqual(
    parseGitRemote("ssh://git@gitlab.example.com:2222/group/subgroup/repo.git"),
    {
      baseUrl: "https://gitlab.example.com:2222",
      host: "gitlab.example.com:2222",
      project: "group/subgroup/repo",
      projectId: "group%2Fsubgroup%2Frepo",
      projectUrl: "https://gitlab.example.com:2222/group/subgroup/repo",
    },
  );
});

test("extracts a project from issue and merge request URLs", () => {
  assert.equal(
    parseGitLabUrl(
      "https://gitlab.example.com/group/subgroup/repo/-/merge_requests/9",
    ).project,
    "group/subgroup/repo",
  );
  assert.equal(
    parseGitLabUrl("https://gitlab.example.com/group/repo/-/issues/3").project,
    "group/repo",
  );
  assert.deepEqual(
    parseGitLabItemUrl("https://gitlab.example.com/group/repo/-/issues/3"),
    { view: "issue_detail", iid: 3 },
  );
  assert.deepEqual(
    parseGitLabItemUrl("https://gitlab.example.com/group/repo/-/merge_requests/8"),
    { view: "mr_detail", iid: 8 },
  );
});

test("explicit project input takes precedence over the origin", () => {
  assert.deepEqual(
    resolveProject(
      { host: "gitlab.other.test", project: "team/service" },
      "https://github.com/old/project.git",
    ),
    {
      baseUrl: "https://gitlab.other.test",
      host: "gitlab.other.test",
      project: "team/service",
      projectId: "team%2Fservice",
      projectUrl: "https://gitlab.other.test/team/service",
    },
  );
});

test("rejects known non-GitLab remotes and malformed project paths", () => {
  assert.throws(
    () => resolveProject({}, "git@github.com:team/repo.git"),
    (error) => error.code === "gitlab_project_unresolved",
  );
  assert.throws(
    () => resolveProject({}, "git@github.enterprise.test:team/repo.git"),
    (error) => error.code === "gitlab_project_unresolved",
  );
  assert.throws(
    () => resolveProject({ host: "gitlab.example.com", project: "team/../repo" }),
    (error) => error.code === "gitlab_project_unresolved",
  );
  assert.throws(() => parseGitRemote("not-a-remote"), {
    code: "gitlab_project_unresolved",
  });
});

test("reads origin with execFile and reports repositories without an origin", async () => {
  let invocation;
  assert.equal(
    await getOriginRemote("C:\\work\\repo", (file, args, options, callback) => {
      invocation = { file, args, options };
      callback(null, "https://gitlab.example.com/team/repo.git\n", "");
    }),
    "https://gitlab.example.com/team/repo.git",
  );
  assert.equal(invocation.file, "git");
  assert.deepEqual(invocation.args, ["remote", "get-url", "origin"]);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.cwd, "C:\\work\\repo");

  await assert.rejects(
    getOriginRemote("C:\\work\\repo", (file, args, options, callback) => {
      callback(Object.assign(new Error("not a git repository"), { code: 128 }));
    }),
    (error) => error.code === "gitlab_project_unresolved",
  );
});
