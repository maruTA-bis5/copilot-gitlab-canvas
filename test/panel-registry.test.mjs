import assert from "node:assert/strict";
import test from "node:test";
import {
  closePanelEntry,
  replacePanelEntry,
} from "../.github/extensions/gitlab-canvas/lib/panel-registry.mjs";

test("closes the old server before replacing a panel with the same instance ID", async () => {
  let closed = 0;
  const previous = { server: { close: async () => { closed += 1; } } };
  const next = { server: { close: async () => {} } };
  const registry = new Map([["panel-1", previous]]);

  await replacePanelEntry(registry, "panel-1", next);

  assert.equal(closed, 1);
  assert.equal(registry.get("panel-1"), next);
});

test("removes a panel entry only after its server closes", async () => {
  const entry = { server: { close: async () => {} } };
  const registry = new Map([["panel-1", entry]]);

  assert.equal(await closePanelEntry(registry, "panel-1", entry), true);
  assert.equal(registry.has("panel-1"), false);
  assert.equal(await closePanelEntry(registry, "panel-1"), false);
});
