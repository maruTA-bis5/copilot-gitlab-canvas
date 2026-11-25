import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasHttpServer } from "../.github/extensions/gitlab-canvas/lib/http-server.mjs";

function getRawPath(port, path, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { hostname: "127.0.0.1", port, path, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

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
    const headerModule = await fetch(new URL("views/header.js", url));
    assert.equal(headerModule.status, 200);
    assert.match(await headerModule.text(), /renderHeader/);

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

test("returns a JSON error when the initial SSE state request fails", async () => {
  const app = createCanvasHttpServer({
    token: "secret",
    getState: async () => {
      throw new Error("state unavailable");
    },
  });
  const { url, close } = await app.start();

  try {
    const response = await fetch(new URL("events", url), {
      headers: { "x-gitlab-canvas-token": "secret" },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "state unavailable",
      code: "canvas_request_failed",
    });
  } finally {
    await close();
  }
});

test("closes immediately with an active SSE connection", async () => {
  const app = createCanvasHttpServer({
    token: "secret",
    getState: () => ({ mode: "mcp" }),
  });
  const { url, close } = await app.start();
  const response = await fetch(new URL("events", url), {
    headers: { "x-gitlab-canvas-token": "secret" },
  });

  try {
    assert.equal(response.status, 200);
    let timeout;
    const closed = await Promise.race([
      close().then(() => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), 1000);
      }),
    ]);
    clearTimeout(timeout);
    assert.equal(closed, true);
  } finally {
    await response.body?.cancel().catch(() => {});
  }
});

test("rejects oversized action bodies with HTTP 413", async () => {
  const app = createCanvasHttpServer({
    token: "secret",
    getState: () => ({}),
    dispatchAction: () => ({}),
  });
  const { url, close } = await app.start();

  try {
    const response = await fetch(new URL("api/action", url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitlab-canvas-token": "secret",
      },
      body: "x".repeat(1024 * 1024 + 1),
    });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /1 MiB limit/);
  } finally {
    await close();
  }
});

test("binds only to loopback and proxies uploads behind the panel token", async () => {
  let proxyCalls = 0;
  const app = createCanvasHttpServer({
    token: "secret",
    getState: () => ({}),
    proxyUpload: async (uploadPath) => {
      proxyCalls += 1;
      return {
        body: Buffer.from(uploadPath),
        contentType: "image/png",
      };
    },
  });
  const { url, close, address } = await app.start();

  try {
    assert.equal(address.address, "127.0.0.1");

    const response = await fetch(new URL("uploads/hash/file.png", url), {
      headers: { "x-gitlab-canvas-token": "secret" },
    });
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(await response.text(), "/uploads/hash/file.png");

    const traversal = await getRawPath(address.port, "/uploads/%2e%2e/secret", {
      "x-gitlab-canvas-token": "secret",
    });
    assert.equal(traversal.status, 404);
    assert.equal(proxyCalls, 1);
  } finally {
    await close();
  }
});
