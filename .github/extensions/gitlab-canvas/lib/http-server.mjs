import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

const defaultStaticRoot = fileURLToPath(new URL("../ui/", import.meta.url));
const maxBodyBytes = 1024 * 1024;
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/markdown.js", ["markdown.js", "text/javascript; charset=utf-8"]],
  ["/diff-viewer.js", ["diff-viewer.js", "text/javascript; charset=utf-8"]],
  ["/views/common.js", ["views/common.js", "text/javascript; charset=utf-8"]],
  ["/views/header.js", ["views/header.js", "text/javascript; charset=utf-8"]],
  ["/views/list-view.js", ["views/list-view.js", "text/javascript; charset=utf-8"]],
  ["/views/issue-detail.js", ["views/issue-detail.js", "text/javascript; charset=utf-8"]],
  ["/views/mr-detail.js", ["views/mr-detail.js", "text/javascript; charset=utf-8"]],
]);

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function hasValidToken(request, expected) {
  const provided = request.headers["x-gitlab-canvas-token"];
  if (typeof provided !== "string") {
    return false;
  }
  const actualBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBodyBytes) {
      const error = new Error("Request body exceeds the 1 MiB limit.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    const invalid = new Error("Request body must be valid JSON.", { cause: error });
    invalid.status = 400;
    throw invalid;
  }
}

function validUploadPath(pathname) {
  if (!pathname.startsWith("/uploads/")) {
    return false;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return (
    decoded.startsWith("/uploads/") &&
    !decoded.split("/").some((segment) => segment === "." || segment === "..") &&
    !decoded.includes("\\")
  );
}

export function createCanvasHttpServer({
  token,
  getState,
  dispatchAction,
  proxyUpload,
  staticRoot = defaultStaticRoot,
}) {
  if (!token || typeof getState !== "function") {
    throw new TypeError("A per-instance token and state provider are required.");
  }
  const eventClients = new Set();
  let baseUrl = null;
  let boundAddress = null;

  const server = createServer((request, response) => {
    void route(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendJson(response, error.status ?? 500, {
        error: error.message || "Canvas request failed.",
        code: error.code ?? "canvas_request_failed",
      });
    });
  });

  async function route(request, response) {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;

    if (pathname === "/api/state") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }
      if (!hasValidToken(request, token)) {
        sendJson(response, 401, { error: "Unauthorized." });
        return;
      }
      sendJson(response, 200, await getState());
      return;
    }

    if (pathname === "/api/action") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }
      if (!hasValidToken(request, token)) {
        sendJson(response, 401, { error: "Unauthorized." });
        return;
      }
      if (typeof dispatchAction !== "function") {
        sendJson(response, 501, { error: "Canvas actions are unavailable." });
        return;
      }
      const action = await readJsonBody(request);
      sendJson(response, 200, await dispatchAction(action));
      return;
    }

    if (pathname === "/events") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }
      if (!hasValidToken(request, token)) {
        sendJson(response, 401, { error: "Unauthorized." });
        return;
      }
      const state = await getState();
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      eventClients.add(response);
      response.on("close", () => eventClients.delete(response));
      return;
    }

    if (pathname.startsWith("/uploads/")) {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }
      if (!hasValidToken(request, token)) {
        sendJson(response, 401, { error: "Unauthorized." });
        return;
      }
      if (!validUploadPath(pathname) || typeof proxyUpload !== "function") {
        sendJson(response, 404, { error: "Upload not found." });
        return;
      }
      const upload = await proxyUpload(decodeURIComponent(pathname));
      const contentType = String(upload?.contentType ?? "");
      if (!/^image\/(?:png|jpeg|gif|webp|svg\+xml|bmp)$/i.test(contentType)) {
        sendJson(response, 415, { error: "Only image uploads can be proxied." });
        return;
      }
      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      });
      response.end(Buffer.isBuffer(upload.body) ? upload.body : Buffer.from(upload.body ?? ""));
      return;
    }

    const asset = assets.get(pathname);
    if (!asset || request.method !== "GET") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    const content = await readFile(path.join(staticRoot, asset[0]));
    response.writeHead(200, {
      "content-type": asset[1],
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'self' blob: data:; img-src 'self' blob: data: http: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    });
    response.end(content);
  }

  return {
    async start() {
      if (server.listening) {
        return {
          url: `${baseUrl}#${token}`,
          address: boundAddress,
          close: () => this.close(),
        };
      }
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(0, "127.0.0.1");
      });
      boundAddress = server.address();
      if (!boundAddress || typeof boundAddress === "string") {
        throw new Error("The canvas HTTP server did not bind to a TCP port.");
      }
      baseUrl = `http://127.0.0.1:${boundAddress.port}/`;
      return {
        url: `${baseUrl}#${token}`,
        address: boundAddress,
        close: () => this.close(),
      };
    },
    publish(state) {
      const event = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
      for (const client of eventClients) {
        if (client.writableEnded || client.destroyed) {
          eventClients.delete(client);
        } else {
          client.write(event);
        }
      }
    },
    async close() {
      for (const client of eventClients) {
        client.end();
      }
      eventClients.clear();
      if (!server.listening) {
        return;
      }
      const closing = new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server.closeAllConnections?.();
      await closing;
      baseUrl = null;
      boundAddress = null;
    },
  };
}
