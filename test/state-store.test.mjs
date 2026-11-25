import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStateStore } from "../.github/extensions/gitlab-canvas/lib/state-store.mjs";

test("persists panel state by a safe instance key and user preferences globally", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gitlab-canvas-"));
  const workspacePath = path.join(root, "workspace");
  const copilotHome = path.join(root, "copilot-home");
  const store = createStateStore({ workspacePath, copilotHome });

  try {
    await store.savePanelState("panel/../../unsafe", {
      view: "mr_detail",
      project: { host: "gitlab.test", path: "team/repo" },
      iid: 4,
      filters: { state: "opened" },
    });
    await store.savePreferences({ language: "ja" });

    assert.deepEqual(await store.loadPanelState("panel/../../unsafe"), {
      view: "mr_detail",
      project: { host: "gitlab.test", path: "team/repo" },
      iid: 4,
      filters: { state: "opened" },
    });
    assert.deepEqual(await store.loadPreferences(), { language: "ja" });

    const panelDirectory = path.join(
      workspacePath,
      ".copilot",
      "gitlab-canvas",
      "panels",
    );
    const panelFiles = await readdir(panelDirectory);
    assert.equal(panelFiles.length, 1);
    assert.match(panelFiles[0], /^[a-f0-9]{64}\.json$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns documented defaults when no state exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gitlab-canvas-"));
  const store = createStateStore({ workspacePath: root, copilotHome: root });

  try {
    assert.equal(await store.loadPanelState("one"), null);
    assert.deepEqual(await store.loadPreferences(), { language: "auto" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
