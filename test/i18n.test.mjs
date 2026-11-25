import assert from "node:assert/strict";
import test from "node:test";
import { getMessages, resolveLanguage } from "../.github/extensions/gitlab-canvas/lib/i18n.mjs";

test("resolves explicit languages and falls back from unsupported preferences", () => {
  assert.equal(resolveLanguage("ja", "en-US"), "ja");
  assert.equal(resolveLanguage("en", "ja-JP"), "en");
  assert.equal(resolveLanguage("fr", "ja-JP"), "ja");
  assert.equal(resolveLanguage("auto", "ja-JP"), "ja");
  assert.equal(resolveLanguage("auto", "fr-FR"), "en");
});

test("provides complete localized messages for the supported languages", () => {
  const english = getMessages("en");
  const japanese = getMessages("ja");

  assert.equal(english.issueList, "Issues");
  assert.equal(japanese.issueList, "課題");
  assert.ok(Object.keys(english).length > 20);
  assert.deepEqual(Object.keys(english).sort(), Object.keys(japanese).sort());
});
