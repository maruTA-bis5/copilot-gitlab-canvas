import assert from "node:assert/strict";
import test from "node:test";
import { GlabClient } from "../.github/extensions/gitlab-canvas/lib/glab-client.mjs";

function fakeExecFile(responses = []) {
  const calls = [];
  const execFileImpl = (file, args, options, callback) => {
    calls.push({ file, args, options });
    const response = responses.shift() ?? { stdout: "[]", stderr: "" };
    callback(response.error ?? null, response.stdout ?? "", response.stderr ?? "");
  };
  return { calls, execFileImpl };
}

test("uses execFile and URL-encodes nested project paths and list filters", async () => {
  const { calls, execFileImpl } = fakeExecFile([{ stdout: '[{"iid":1}]' }]);
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/subgroup/repo",
    cwd: "C:\\work",
    execFileImpl,
  });

  assert.deepEqual(
    await client.listIssues({
      state: "opened",
      search: "network failure",
      labels: ["bug", "needs triage"],
      page: 2,
    }),
    [{ iid: 1 }],
  );
  assert.equal(calls[0].file, "glab");
  assert.equal(calls[0].options.shell, false);
  assert.ok(calls[0].args.includes("--hostname"));
  assert.ok(
    calls[0].args.some((arg) =>
      arg.includes("projects/team%2Fsubgroup%2Frepo/issues?"),
    ),
  );
  assert.ok(calls[0].args.some((arg) => arg.includes("labels=bug%2Cneeds+triage")));
});

test("falls back to configured GLAB_PATH and GLAB_BIN after PATH lookup fails", async () => {
  for (const variable of ["GLAB_PATH", "GLAB_BIN"]) {
    const calls = [];
    const executable = `C:\\tools\\${variable}.exe`;
    const client = new GlabClient({
      host: "gitlab.com",
      project: "team/repo",
      env: { [variable]: executable },
      platform: "win32",
      execFileImpl(file, args, options, callback) {
        calls.push(file);
        if (file === "glab") {
          callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
          return;
        }
        callback(null, args[0] === "--version" ? "glab 1.0" : "", "");
      },
    });

    assert.equal((await client.checkAvailability()).available, true);
    assert.deepEqual(calls, ["glab", executable, executable]);
  }
});

test("falls back to the standard Windows glab installation path", async () => {
  const calls = [];
  const executable =
    "C:\\Users\\tester\\AppData\\Local\\Programs\\glab\\glab.exe";
  const client = new GlabClient({
    host: "gitlab.com",
    project: "team/repo",
    env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
    platform: "win32",
    execFileImpl(file, args, options, callback) {
      calls.push(file);
      if (file === "glab") {
        callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
        return;
      }
      callback(null, args[0] === "--version" ? "glab 1.0" : "", "");
    },
  });

  assert.equal((await client.checkAvailability()).available, true);
  assert.deepEqual(calls, ["glab", executable, executable]);
});

test("continues to the next fallback when an explicit binary path is stale", async () => {
  const calls = [];
  const stale = "C:\\missing\\glab.exe";
  const executable = "C:\\tools\\glab.exe";
  const client = new GlabClient({
    host: "gitlab.com",
    project: "team/repo",
    env: { GLAB_PATH: stale, GLAB_BIN: executable },
    platform: "win32",
    execFileImpl(file, args, options, callback) {
      calls.push(file);
      if (file === "glab" || file === stale) {
        callback(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
        return;
      }
      callback(null, args[0] === "--version" ? "glab 1.0" : "", "");
    },
  });

  assert.equal((await client.checkAvailability()).available, true);
  assert.deepEqual(calls, ["glab", stale, executable, executable]);
});

test("passes user content as a single safe argv field", async () => {
  const { calls, execFileImpl } = fakeExecFile([{ stdout: '{"id":7}' }]);
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/repo",
    execFileImpl,
  });
  const body = "Looks good; `echo unsafe`";

  await client.createNote("issues", 7, body);

  assert.equal(calls[0].options.shell, false);
  assert.ok(calls[0].args.includes(`body=${body}`));
});

test("sends assignee IDs as a JSON array field", async () => {
  const { calls, execFileImpl } = fakeExecFile([
    { stdout: '[{"id":7,"username":"reviewer"}]' },
    { stdout: '{"iid":3}' },
  ]);
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/repo",
    execFileImpl,
  });

  await client.updateAssignee("issues", 3, "reviewer");

  assert.ok(calls[1].args.includes("--field"));
  assert.ok(calls[1].args.includes("assignee_ids=[7]"));
  assert.ok(!calls[1].args.some((arg) => arg.includes("assignee_ids[]")));
});

test("sends diff positions as a structured JSON field", async () => {
  const { calls, execFileImpl } = fakeExecFile([{ stdout: '{"id":5}' }]);
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/repo",
    execFileImpl,
  });
  const position = {
    position_type: "text",
    old_path: "src/old.js",
    new_path: "src/new.js",
    old_line: null,
    new_line: 8,
    base_sha: "base",
    head_sha: "head",
    start_sha: "start",
  };

  await client.createDiffDiscussion(5, "Temporary review comment", position);

  assert.ok(calls[0].args.includes("--field"));
  const expectedPosition = {
    position_type: "text",
    old_path: "src/old.js",
    new_path: "src/new.js",
    new_line: 8,
    base_sha: "base",
    head_sha: "head",
    start_sha: "start",
  };
  assert.ok(
    calls[0].args.includes(`position=${JSON.stringify(expectedPosition)}`),
  );
  assert.ok(!calls[0].args.some((arg) => arg.includes("position[")));
});

test("redacts bearer and private tokens from glab errors", async () => {
  const { execFileImpl } = fakeExecFile([
    {
      error: Object.assign(new Error("glab exited"), { code: 1 }),
      stderr:
        "Authorization: Bearer bearer-secret\nPRIVATE-TOKEN: glpat-private-secret",
    },
  ]);
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/repo",
    execFileImpl,
  });

  await assert.rejects(client.getIssue(7), (error) => {
    assert.match(error.message, /\[redacted\]/);
    assert.doesNotMatch(error.message, /bearer-secret|glpat-private-secret/);
    return true;
  });
});

test("reads upload responses as bytes rather than attempting JSON parsing", async () => {
  const image = Buffer.from([0, 1, 2, 255]);
  const { calls, execFileImpl } = fakeExecFile([{ stdout: image }]);
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/repo",
    execFileImpl,
  });

  assert.deepEqual(await client.getUpload("/uploads/hash/image.png"), image);
  assert.equal(calls[0].options.encoding, null);
  assert.ok(
    calls[0].args.includes(
      "https://gitlab.example.com/team/repo/uploads/hash/image.png",
    ),
  );
});

test("keeps project-relative upload paths from duplicating the project prefix", async () => {
  const { calls, execFileImpl } = fakeExecFile([
    { stdout: Buffer.from("one") },
    { stdout: Buffer.from("two") },
  ]);
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/subgroup/repo",
    execFileImpl,
  });

  await client.getUpload("/uploads/hash/one.png");
  await client.getUpload("/team/subgroup/repo/uploads/hash/two.png");

  assert.ok(
    calls[0].args.includes(
      "https://gitlab.example.com/team/subgroup/repo/uploads/hash/one.png",
    ),
  );
  assert.ok(
    calls[1].args.includes(
      "https://gitlab.example.com/team/subgroup/repo/uploads/hash/two.png",
    ),
  );
});

test("rejects encoded traversal in upload paths", async () => {
  const { calls, execFileImpl } = fakeExecFile();
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/repo",
    execFileImpl,
  });

  assert.throws(() => client.getUpload("/uploads/%2e%2e/secrets"), {
    code: "invalid_upload_path",
  });
  assert.equal(calls.length, 0);
});

test("does not ask GitLab for a merged state on issue endpoints", async () => {
  const { calls, execFileImpl } = fakeExecFile();
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/repo",
    execFileImpl,
  });

  assert.deepEqual(await client.listIssues({ state: "merged" }), []);
  assert.equal(calls.length, 0);
});

test("resolves related issues from GitLab issue links", async () => {
  const link = {
    link_type: "relates_to",
    source_issue: { iid: 7, title: "Current issue" },
    target_issue: { iid: 9, title: "Related issue" },
  };
  const reversedLink = {
    link_type: "relates_to",
    source_issue: { iid: 10, title: "Other related issue" },
    target_issue: { iid: 7, title: "Current issue" },
  };
  const { calls, execFileImpl } = fakeExecFile([
    { stdout: JSON.stringify([link, reversedLink]) },
  ]);
  const client = new GlabClient({
    host: "gitlab.example.com",
    project: "team/repo",
    execFileImpl,
  });

  assert.deepEqual(
    await client.getRelatedIssues(7),
    [link.target_issue, reversedLink.source_issue],
  );
  assert.ok(calls[0].args.some((arg) => arg.includes("/issues/7/links")));
});
