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
