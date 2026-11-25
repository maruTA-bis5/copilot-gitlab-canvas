import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiffCommentPosition,
  renderDiffFiles,
} from "../.github/extensions/gitlab-canvas/ui/diff-viewer.js";

test("counts parsed added and removed lines, including content starting with plus signs", () => {
  const html = renderDiffFiles([
    {
      oldPath: "src/old.js",
      newPath: "src/new.js",
      diff: "@@ -1 +1 @@\n-old\n+++i\n",
    },
  ]);

  assert.match(html, /class="added-count">\+1/);
  assert.match(html, /class="removed-count">−1/);
  assert.match(html, /data-old-path="src\/old\.js"/);
  assert.match(html, /data-new-path="src\/new\.js"/);
});

test("does not render a phantom context row for a trailing newline", () => {
  const html = renderDiffFiles([
    {
      oldPath: "src/file.js",
      newPath: "src/file.js",
      diff: "@@ -1 +1 @@\n context\n",
    },
  ]);

  assert.equal((html.match(/class="diff-context"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<td class="line-number">2<\/td><td class="line-number">2<\/td>/);
});

test("keeps old and new paths distinct in a renamed-file comment position", () => {
  const html = renderDiffFiles([
    {
      oldPath: "src/old.js",
      newPath: "src/new.js",
      diff: "@@ -1 +1 @@\n-old\n+new\n",
    },
  ]);
  const button = {
    oldPath: "src/old.js",
    newPath: "src/new.js",
    oldLine: "1",
    newLine: "1",
    baseSha: "base",
    headSha: "head",
    startSha: "start",
  };

  assert.match(html, /data-old-path="src\/old\.js"/);
  assert.match(html, /data-new-path="src\/new\.js"/);
  assert.deepEqual(createDiffCommentPosition(button), {
    position_type: "text",
    old_path: "src/old.js",
    new_path: "src/new.js",
    old_line: 1,
    new_line: 1,
    base_sha: "base",
    head_sha: "head",
    start_sha: "start",
  });
});
