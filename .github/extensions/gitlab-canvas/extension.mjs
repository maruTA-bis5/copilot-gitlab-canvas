import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CanvasError,
  createCanvas,
  joinSession,
} from "@microsoft/copilot-sdk/extension";
import {
  normalizeViewData,
} from "./lib/data-normalizer.mjs";
import { GlabClient } from "./lib/glab-client.mjs";
import { createCanvasHttpServer } from "./lib/http-server.mjs";
import { closePanelEntry, replacePanelEntry } from "./lib/panel-registry.mjs";
import {
  getOriginRemote,
  parseGitLabItemUrl,
  resolveProject,
} from "./lib/git-remote.mjs";
import { createPanelClientState } from "./lib/panel-state.mjs";
import {
  canvasViews,
  normalizeFilters,
  prepareNavigationState,
} from "./lib/panel-navigation.mjs";
import { createStateStore } from "./lib/state-store.mjs";
import { loadViewData } from "./lib/view-loader.mjs";

const views = new Set(canvasViews);
const instanceMap = new Map();
const staticRoot = fileURLToPath(new URL("./ui/", import.meta.url));

function canvasError(code, message) {
  return new CanvasError(code, message);
}

function asCanvasError(error) {
  if (error instanceof CanvasError) {
    return error;
  }
  return canvasError(
    error?.code ?? "gitlab_request_failed",
    error?.message ?? String(error),
  );
}

function panelStateForStorage(state) {
  return {
    view: state.view,
    project: state.project,
    iid: state.iid,
    filters: state.filters,
  };
}

async function resolvePanelProject(input, saved) {
  if (input.url || input.host || input.project) {
    return resolveProject(input);
  }
  if (saved?.project?.host && saved?.project?.project) {
    return resolveProject({
      host: saved.project.baseUrl ?? saved.project.host,
      project: saved.project.project,
    });
  }
  const origin = await getOriginRemote(process.cwd());
  return resolveProject({}, origin);
}

async function stateForClient(entry) {
  const preferences = await entry.store.loadPreferences();
  return createPanelClientState(
    entry.state,
    entry.mode,
    preferences.language,
  );
}

async function persistAndPublish(entry) {
  await entry.store.savePanelState(
    entry.instanceId,
    panelStateForStorage(entry.state),
  );
  if (entry.server) {
    entry.server.publish(await stateForClient(entry));
  }
}

async function refreshEntry(entry) {
  if (entry.mode !== "glab" || !entry.client) {
    return requestMcpAction(entry, { type: "refresh" });
  }
  const loaded = await loadViewData(entry.client, entry.state);
  entry.state.data = loaded.data;
  entry.state.warnings = loaded.warnings;
  entry.state.error = null;
  entry.state.pending = false;
  await persistAndPublish(entry);
  return { refreshed: true };
}

function actionPrompt(entry, action) {
  const itemType = entry.state.view.startsWith("issue")
    ? "issue"
    : "merge request";
  const itemUrl = entry.state.iid
    ? `${entry.project.projectUrl}/-/${itemType === "issue" ? "issues" : "merge_requests"}/${entry.state.iid}`
    : entry.project.projectUrl;
  return [
    "Use the connected official GitLab MCP server to complete this GitLab Canvas request.",
    `GitLab host: ${entry.project.host}`,
    `Project: ${entry.project.project}`,
    `Current view: ${entry.state.view}`,
    `Current item URL: ${itemUrl}`,
    `Canvas instance ID: ${entry.instanceId}`,
    "After retrieving or changing data, call invoke_canvas_action with actionName set_view_data and input { view, data } for this canvas instance.",
    "Return only data from GitLab; do not invent missing fields.",
    `Requested operation: ${JSON.stringify(action)}`,
  ].join("\n");
}

async function requestMcpAction(entry, action) {
  entry.state.pending = true;
  entry.state.error = null;
  entry.state.warnings = [];
  await persistAndPublish(entry);
  try {
    await entry.session.send({ prompt: actionPrompt(entry, action) });
  } catch (error) {
    entry.state.pending = false;
    entry.state.error = error.message;
    await persistAndPublish(entry);
    throw error;
  }
  return { delegated: true };
}

async function navigateEntry(entry, input) {
  const canLoadDirectly = entry.mode === "glab" && entry.client;
  const nextState = await prepareNavigationState(
    entry.state,
    input,
    canLoadDirectly
      ? (state) => loadViewData(entry.client, state)
      : undefined,
  );
  if (canLoadDirectly) {
    entry.state = nextState;
    await persistAndPublish(entry);
    return { refreshed: true };
  }
  const previousState = entry.state;
  entry.state = nextState;
  try {
    return await requestMcpAction(entry, {
      type: "navigate",
      view: entry.state.view,
      iid: entry.state.iid,
      filters: entry.state.filters,
    });
  } catch (error) {
    entry.state = previousState;
    await persistAndPublish(entry);
    throw error;
  }
}

async function chatWithItem(entry, intent) {
  const issue = entry.state.view.startsWith("issue");
  const itemUrl = `${entry.project.projectUrl}/-/${issue ? "issues" : "merge_requests"}/${entry.state.iid}`;
  const prompts = {
    investigate: `Investigate GitLab ${issue ? "issue" : "merge request"} {itemNumber} at {url}. Use the available GitLab tools and report findings.`,
    plan: `Create an implementation plan for GitLab issue {itemNumber} at {url}.`,
    review: `Review GitLab merge request {itemNumber} at {url}. Identify actionable findings and evidence.`,
    fix: `Address the review feedback for GitLab merge request {itemNumber} at {url}.`,
  };
  const template = prompts[intent];
  if (!template) {
    throw canvasError("canvas_input_invalid", "Unknown GitLab Canvas chat action.");
  }
  const number = Number(entry.state.iid);
  const itemNumber = issue ? `#${number}` : `!${number}`;
  await entry.session.send({
    prompt: template
      .replace("{itemNumber}", itemNumber)
      .replace("{url}", itemUrl),
  });
  return { sent: true };
}

async function dispatchUiAction(entry, action) {
  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    throw canvasError("canvas_input_invalid", "A GitLab Canvas action type is required.");
  }
  if (action.type === "navigate") {
    return navigateEntry(entry, action);
  }
  if (action.type === "refresh") {
    return refreshEntry(entry);
  }
  if (action.type === "set_language") {
    const preferences = await entry.store.savePreferences({
      language: action.language,
    });
    await persistAndPublish(entry);
    return { language: preferences.language };
  }
  if (action.type === "chat") {
    return chatWithItem(entry, action.intent);
  }
  if (entry.mode !== "glab" || !entry.client) {
    return requestMcpAction(entry, action);
  }

  const iid = Number(action.iid ?? entry.state.iid);
  if (!Number.isInteger(iid) || iid < 1) {
    throw canvasError("gitlab_item_unresolved", "A positive issue or merge request IID is required.");
  }
  const kind = action.kind === "issues" ? "issues" : "merge_requests";
  switch (action.type) {
    case "comment":
      await entry.client.createNote(kind, iid, String(action.body ?? ""));
      break;
    case "reply":
      await entry.client.replyToDiscussion(
        kind,
        iid,
        String(action.discussionId ?? ""),
        String(action.body ?? ""),
      );
      break;
    case "resolve":
      if (kind !== "merge_requests") {
        throw canvasError("gitlab_action_unsupported", "Only merge request discussions can be resolved.");
      }
      await entry.client.resolveDiscussion(
        iid,
        String(action.discussionId ?? ""),
        Boolean(action.resolved),
      );
      break;
    case "set_state":
      if (!["closed", "opened"].includes(action.state)) {
        throw canvasError("canvas_input_invalid", "State must be closed or opened.");
      }
      await entry.client.updateState(kind, iid, action.state);
      break;
    case "set_assignee":
      await entry.client.updateAssignee(
        kind,
        iid,
        String(action.assignee ?? "").trim(),
      );
      break;
    case "set_labels":
      await entry.client.updateLabels(kind, iid, {
        add: Array.isArray(action.add) ? action.add : [],
        remove: Array.isArray(action.remove) ? action.remove : [],
      });
      break;
    case "diff_comment":
      if (kind !== "merge_requests") {
        throw canvasError("gitlab_action_unsupported", "Diff comments require a merge request.");
      }
      await entry.client.createDiffDiscussion(iid, String(action.body ?? ""), action.position);
      break;
    case "approve":
      await entry.client.approveMergeRequest(iid);
      break;
    case "unapprove":
      await entry.client.unapproveMergeRequest(iid);
      break;
    default:
      throw canvasError("canvas_action_not_found", `Unknown GitLab Canvas action: ${action.type}`);
  }

  return refreshEntry(entry);
}

function canvasInputSchema() {
  return {
    type: "object",
    properties: {
      view: {
        type: "string",
        enum: [...views],
        default: "mr_list",
      },
      iid: { type: "integer", minimum: 1 },
      url: {
        type: "string",
        description: "GitLab Issue, Merge Request, or Project URL.",
      },
      host: { type: "string" },
      project: {
        type: "string",
        description: "GitLab group/subgroup/project path.",
      },
      filters: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["opened", "closed", "merged", "all"] },
          search: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          assignee: { type: "string" },
          author: { type: "string" },
          page: { type: "integer", minimum: 1 },
        },
      },
      data: {
        type: "object",
        description: "Initial data supplied by the GitLab MCP fallback.",
      },
    },
  };
}

function getInstance(instanceId) {
  const entry = instanceMap.get(instanceId);
  if (!entry) {
    throw canvasError("canvas_instance_not_found", "The GitLab Canvas instance is not open.");
  }
  return entry;
}

async function openCanvasInternal(ctx) {
  const input = ctx.input ?? {};
  const store = createStateStore({ workspacePath: session.workspacePath });
  const saved = await store.loadPanelState(ctx.instanceId);
  let project;
  try {
    project = await resolvePanelProject(input, saved);
  } catch (error) {
    throw canvasError(error.code ?? "gitlab_project_unresolved", error.message);
  }

  const urlTarget = input.url ? parseGitLabItemUrl(input.url) : null;
  const view = views.has(input.view)
    ? input.view
    : urlTarget?.view ?? (views.has(saved?.view) ? saved.view : "mr_list");
  const filters = normalizeFilters(input.filters, saved?.filters);
  const dataIid =
    input.data?.issue?.iid ??
    input.data?.mergeRequest?.iid ??
    input.data?.merge_request?.iid ??
    input.data?.iid;
  const iid = input.iid ?? urlTarget?.iid ?? saved?.iid ?? dataIid ?? null;
  const entry = {
    instanceId: ctx.instanceId,
    project,
    store,
    session,
    client: new GlabClient({
      host: project.host,
      project: project.project,
      baseUrl: project.baseUrl,
      cwd: process.cwd(),
    }),
    mode: "mcp",
    state: {
      project,
      view,
      iid: iid == null ? null : Number(iid),
      filters,
      data: null,
      error: null,
      pending: false,
      warnings: [],
    },
    server: null,
  };
  const availability = await entry.client.checkAvailability();
  if (availability.available) {
    entry.mode = "glab";
    const loaded = await loadViewData(entry.client, entry.state);
    entry.state.data = loaded.data;
    entry.state.warnings = loaded.warnings;
  } else if (input.data !== undefined) {
    entry.state.data = normalizeViewData(view, input.data);
  } else {
    throw canvasError(
      "gitlab_backend_unavailable",
      `GitLab access is unavailable (${availability.reason}). Install and authenticate glab for ${project.host}, or pass data from the GitLab MCP server.`,
    );
  }

  const token = randomBytes(32).toString("base64url");
  entry.server = createCanvasHttpServer({
    token,
    staticRoot,
    getState: () => stateForClient(entry),
    dispatchAction: (action) => dispatchUiAction(entry, action),
    proxyUpload: async (uploadPath) => {
      if (entry.mode !== "glab" || !entry.client) {
        throw canvasError(
          "gitlab_upload_unavailable",
          "Private GitLab uploads are not available through the MCP backend.",
        );
      }
      const contentTypes = {
        ".gif": "image/gif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
      };
      const extension = uploadPath.match(/\.[a-z0-9]+(?:\?.*)?$/i)?.[0]
        ?.split("?")[0]
        .toLowerCase();
      return {
        body: await entry.client.getUpload(uploadPath),
        contentType: contentTypes[extension] ?? "application/octet-stream",
      };
    },
  });
  const { url } = await entry.server.start();
  let registered = false;
  try {
    await replacePanelEntry(instanceMap, ctx.instanceId, entry);
    registered = true;
    await persistAndPublish(entry);
  } catch (error) {
    if (registered) {
      await closePanelEntry(instanceMap, ctx.instanceId, entry);
    } else {
      await entry.server.close();
    }
    throw error;
  }

  return {
    title: `${project.project} — GitLab`,
    status: entry.mode,
    url,
  };
}

async function openCanvas(ctx) {
  try {
    return await openCanvasInternal(ctx);
  } catch (error) {
    throw asCanvasError(error);
  }
}

async function handleCanvasActionInternal(ctx) {
  const entry = getInstance(ctx.instanceId);
  switch (ctx.actionName) {
    case "get_state":
      return {
        project: {
          host: entry.project.host,
          path: entry.project.project,
          url: entry.project.projectUrl,
        },
        view: entry.state.view,
        iid: entry.state.iid,
        filters: entry.state.filters,
        backend: entry.mode,
      };
    case "navigate":
      return navigateEntry(entry, ctx.input ?? {});
    case "refresh":
      return refreshEntry(entry);
    case "set_view_data": {
      const input = ctx.input ?? {};
      if (input.view && !views.has(input.view)) {
        throw canvasError("canvas_input_invalid", "The requested GitLab Canvas view is invalid.");
      }
      if (input.view) {
        entry.state.view = input.view;
      }
      if (input.iid !== undefined) {
        entry.state.iid = Number(input.iid);
      } else if (entry.state.view === "issue_detail") {
        entry.state.iid = Number(input.data?.issue?.iid ?? input.data?.iid ?? entry.state.iid);
      } else if (entry.state.view === "mr_detail") {
        entry.state.iid = Number(
          input.data?.mergeRequest?.iid ??
            input.data?.merge_request?.iid ??
            input.data?.iid ??
            entry.state.iid,
        );
      }
      entry.mode = "mcp";
      entry.state.data = normalizeViewData(entry.state.view, input.data ?? {});
      entry.state.pending = false;
      entry.state.error = null;
      entry.state.warnings = [];
      await persistAndPublish(entry);
      return { updated: true, view: entry.state.view };
    }
    default:
      throw canvasError("canvas_action_not_found", `Unknown canvas action: ${ctx.actionName}`);
  }
}

async function handleCanvasAction(ctx) {
  try {
    return await handleCanvasActionInternal(ctx);
  } catch (error) {
    throw asCanvasError(error);
  }
}

function isGitLabWrite(input) {
  const name = String(input.toolName ?? "");
  const args =
    typeof input.toolArgs === "string"
      ? input.toolArgs
      : JSON.stringify(input.toolArgs ?? {});
  const combined = `${name} ${args}`;
  const mcpWrite =
    /gitlab/i.test(name) &&
    /\b(create|update|delete|close|reopen|approve|unapprove|resolve|reply|comment|note|assign|label)\w*/i.test(
      name,
    );
  const glabWrite =
    /\bglab\s+(?:api\b[\s\S]{0,300}?(?:-X|--method)\s+(?:POST|PUT|DELETE)|(?:issue|mr)\s+(?:close|reopen|approve|unapprove|note|create|update))\b/i.test(
      combined,
    );
  return mcpWrite || glabWrite;
}

function toolProjectIdentifiers(value, key = "", identifiers = []) {
  if (typeof value === "string" && /host|project|path|namespace|url|repository/i.test(key)) {
    identifiers.push(value.toLowerCase());
  } else if (Array.isArray(value)) {
    for (const item of value) {
      toolProjectIdentifiers(item, key, identifiers);
    }
  } else if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      toolProjectIdentifiers(childValue, childKey, identifiers);
    }
  }
  return identifiers;
}

function isRelatedGitLabWrite(input, entry) {
  const identifiers = toolProjectIdentifiers(input.toolArgs);
  if (!identifiers.length) {
    return true;
  }
  const projectValues = [
    entry.project.host,
    entry.project.project,
    entry.project.projectId,
    entry.project.projectUrl,
  ].map((value) => String(value).toLowerCase());
  return identifiers.some((identifier) =>
    projectValues.some(
      (projectValue) =>
        identifier.includes(projectValue) || projectValue.includes(identifier),
    ),
  );
}

const canvas = createCanvas({
  id: "gitlab",
  displayName: "GitLab",
  description: "Browse GitLab issues and merge requests, inspect diffs, and perform common review actions.",
  inputSchema: canvasInputSchema(),
  actions: [
    {
      name: "navigate",
      description: "Switch this GitLab canvas to an issue or merge request view.",
      inputSchema: {
        type: "object",
        properties: {
          view: { type: "string", enum: [...views] },
          iid: { type: "integer", minimum: 1 },
          filters: { type: "object" },
        },
      },
      handler: handleCanvasAction,
    },
    {
      name: "refresh",
      description: "Refresh the currently displayed GitLab view.",
      inputSchema: { type: "object", properties: {} },
      handler: handleCanvasAction,
    },
    {
      name: "set_view_data",
      description: "Update the canvas with data retrieved through GitLab MCP.",
      inputSchema: {
        type: "object",
        properties: {
          view: { type: "string", enum: [...views] },
          iid: { type: "integer", minimum: 1 },
          data: { type: "object" },
        },
        required: ["data"],
      },
      handler: handleCanvasAction,
    },
    {
      name: "get_state",
      description: "Get the project, view, item, filters, and backend of this canvas.",
      inputSchema: { type: "object", properties: {} },
      handler: handleCanvasAction,
    },
  ],
  open: openCanvas,
  onClose: async (ctx) => {
    await closePanelEntry(instanceMap, ctx.instanceId);
  },
});

const session = await joinSession({
  canvases: { definitions: [canvas] },
  hooks: {
    handlers: {
      onPostToolUse: async (input) => {
        if (!isGitLabWrite(input)) {
          return;
        }
        await Promise.all(
          [...instanceMap.values()]
            .filter(
              (entry) =>
                entry.mode === "glab" && isRelatedGitLabWrite(input, entry),
            )
            .map(async (entry) => {
              try {
                await refreshEntry(entry);
              } catch (error) {
                await session.log(
                  `GitLab Canvas refresh failed: ${error.message}`,
                  { level: "warning" },
                );
              }
            }),
        );
      },
    },
  },
});
