import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../.github/extensions/gitlab-canvas/ui/markdown.js";

test("renders common GFM blocks, task lists, and safe issue references", () => {
  const html = renderMarkdown(
    "# Plan\n\n- [x] done\n- [ ] pending\n\nSee #12 and !8.",
  );

  assert.match(html, /<h1>Plan<\/h1>/);
  assert.match(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /data-reference-kind="issue" data-iid="12"/);
  assert.match(html, /data-reference-kind="merge_request" data-iid="8"/);
});

test("escapes raw HTML and rejects executable URLs", () => {
  const html = renderMarkdown(
    '<script>alert(1)</script>\n\n[x](javascript:alert%281%29) ![image](javascript:alert(2))',
  );

  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /src="javascript:/i);
});

test("proxies relative GitLab uploads and renders links in MCP mode", () => {
  const direct = renderMarkdown("![diagram](/uploads/hash/diagram.png)", {
    backend: "glab",
    projectUrl: "https://gitlab.test/team/repo",
  });
  const mcp = renderMarkdown("![diagram](/uploads/hash/diagram.png)", {
    backend: "mcp",
    projectUrl: "https://gitlab.test/team/repo",
  });

  assert.match(direct, /data-upload-path="\/uploads\/hash\/diagram\.png"/);
  assert.match(mcp, /href="https:\/\/gitlab\.test\/uploads\/hash\/diagram\.png"/);
  assert.doesNotMatch(mcp, /<img/);
});

test("renders GFM tables and fenced code without interpreting code as HTML", () => {
  const html = renderMarkdown(
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```html\n<b>x</b>\n```",
  );

  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});
