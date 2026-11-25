import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasHttpServer } from "../.github/extensions/gitlab-canvas/lib/http-server.mjs";

test("serves authenticated state and dispatches authenticated actions", async () => {
  const actions = [];
  const app = createCanvasHttpServer({
    token: "panel-secret",
    getState: async () => ({ view: "issue_list" }),
    dispatchAction: async (action) => {
      actions.push(action);
      return { accepted: true };
    },
  });
  const { url, close } = await app.start();

  try {
    assert.equal(new URL(url).hash, "#panel-secret");
    const unauthorized = await fetch(new URL("api/state", url));
    assert.equal(unauthorized.status, 401);

    const stateResponse = await fetch(new URL("api/state", url), {
      headers: { "x-gitlab-canvas-token": "panel-secret" },
    });
    assert.deepEqual(await stateResponse.json(), { view: "issue_list" });

    const rootResponse = await fetch(url);
    assert.equal(rootResponse.status, 200);
    assert.doesNotMatch(await rootResponse.text(), /panel-secret/);
    const sharedModule = await fetch(new URL("views/common.js", url));
    assert.equal(sharedModule.status, 200);

    const actionResponse = await fetch(new URL("api/action", url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitlab-canvas-token": "panel-secret",
      },
      body: JSON.stringify({ type: "refresh" }),
    });
    assert.deepEqual(await actionResponse.json(), { accepted: true });
    assert.deepEqual(actions, [{ type: "refresh" }]);
  } finally {
    await close();
  }
});

test("binds only to loopback and proxies uploads behind the panel token", async () => {
  const app = createCanvasHttpServer({
    token: "secret",
    getState: () => ({}),
    proxyUpload: async (uploadPath) => ({
      body: Buffer.from(uploadPath),
      contentType: "image/png",
    }),
  });
  const { url, close, address } = await app.start();

  try {
    assert.equal(address.address, "127.0.0.1");

    const response = await fetch(new URL("uploads/hash/file.png", url), {
      headers: { "x-gitlab-canvas-token": "secret" },
    });
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(await response.text(), "/uploads/hash/file.png");
  } finally {
    await close();
  }
});
