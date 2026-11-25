import { renderMarkdown } from "./markdown.js";
import { createDiffCommentPosition } from "./diff-viewer.js";
import { backendLabel } from "./views/common.js";
import { renderIssueDetail } from "./views/issue-detail.js";
import { renderListView } from "./views/list-view.js";
import { renderMergeRequestDetail } from "./views/mr-detail.js";

const app = document.querySelector("#app");
const token = window.location.hash.slice(1);
let state = null;
let eventStreamOpen = true;
let activeTab = "overview";
const eventStreamController = new AbortController();
const blobUrls = new Set();

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

function message(key, fallback) {
  return state?.messages?.[key] || fallback || key;
}

function renderHeader() {
  const isIssues = state.view.startsWith("issue");
  const projectPath = state.project?.project || state.project?.path || "";
  const lang = state.languagePreference || "auto";
  const mode = backendLabel(state.mode);
  return `<header class="app-header">
    <div class="brand"><span class="brand-mark" aria-hidden="true">G</span><span class="project-path">${escapeHtml(projectPath)}</span></div>
    <nav class="header-nav" aria-label="GitLab sections">
      <button type="button" class="${isIssues ? "active" : ""}" data-nav="issue_list">${escapeHtml(message("issues", "Issues"))}</button>
      <button type="button" class="${!isIssues ? "active" : ""}" data-nav="mr_list">${escapeHtml(message("mergeRequests", "Merge requests"))}</button>
    </nav>
    <div class="header-actions">
      <span class="mode-indicator" title="${escapeHtml(message("backend", "Backend"))}">${escapeHtml(mode)}</span>
      <button type="button" class="secondary-button" data-command="refresh">${escapeHtml(message("refresh", "Refresh"))}</button>
      <a class="secondary-button" href="${escapeHtml(state.project?.projectUrl || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(message("openInGitLab", "Open in GitLab"))}</a>
      <label class="language-select">${escapeHtml(message("language", "Language"))}
        <select data-language>
          <option value="auto"${lang === "auto" ? " selected" : ""}>Auto</option>
          <option value="ja"${lang === "ja" ? " selected" : ""}>日本語</option>
          <option value="en"${lang === "en" ? " selected" : ""}>English</option>
        </select>
      </label>
    </div>
  </header>`;
}

function renderBody() {
  if (state.view === "issue_list" || state.view === "mr_list") {
    return renderListView(state);
  }
  if (state.view === "issue_detail") {
    return renderIssueDetail(state);
  }
  if (state.view === "mr_detail") {
    return renderMergeRequestDetail({ ...state, activeTab });
  }
  return `<div class="empty-state">${escapeHtml(message("noResults", "No results found."))}</div>`;
}

function render() {
  for (const blobUrl of blobUrls) {
    URL.revokeObjectURL(blobUrl);
  }
  blobUrls.clear();
  if (!state) {
    app.innerHTML = `<p class="loading">${escapeHtml(message("loading", "Loading…"))}</p>`;
    return;
  }
  window.gitlabCanvasState = state;
  app.innerHTML = `<div class="app-shell">
    ${renderHeader()}
    <main class="canvas-content">
      ${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error)}</div>` : ""}
      ${state.pending ? `<div class="info-banner" role="status">${escapeHtml(message("mcpPending", "Waiting for GitLab MCP data from the agent."))}</div>` : ""}
      ${(state.warnings ?? []).map((warning) => `<div class="info-banner warning-banner" role="status">${escapeHtml(warning)}</div>`).join("")}
      ${renderBody()}
    </main>
  </div>`;
  void loadUploadImages();
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "x-gitlab-canvas-token": token,
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}.`);
  }
  return payload;
}

async function performAction(action) {
  try {
    state.error = null;
    render();
    return await requestJson("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
  } catch (error) {
    state.error = error.message;
    render();
    return null;
  }
}

async function loadUploadImages() {
  const images = app.querySelectorAll("img[data-upload-path]");
  for (const image of images) {
    if (image.dataset.loading === "true" || image.dataset.loaded === "true") {
      continue;
    }
    image.dataset.loading = "true";
    try {
      const response = await fetch(image.dataset.uploadPath, {
        headers: { "x-gitlab-canvas-token": token },
      });
      if (!response.ok) {
        throw new Error(`Image request failed with status ${response.status}.`);
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrls.add(blobUrl);
      image.src = blobUrl;
      image.dataset.loaded = "true";
    } catch {
      image.alt = image.alt ? `${image.alt} (unavailable)` : "Image unavailable";
    } finally {
      delete image.dataset.loading;
    }
  }
}

function currentKind() {
  return state.view.startsWith("issue") ? "issues" : "merge_requests";
}

function currentIid() {
  return Number(state.iid ?? state.data?.issue?.iid ?? state.data?.mergeRequest?.iid);
}

function splitLabels(value) {
  return String(value ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function openDiffComment(button) {
  const row = button.closest("tr");
  if (!row || row.nextElementSibling?.classList.contains("inline-comment-row")) {
    return;
  }
  const wrapper = document.createElement("tr");
  wrapper.className = "inline-comment-row";
  const cell = document.createElement("td");
  cell.colSpan = 4;
  const form = document.createElement("form");
  form.className = "inline-comment-form";
  form.dataset.form = "diff-comment";
  form.dataset.oldPath = button.dataset.oldPath || "";
  form.dataset.newPath = button.dataset.newPath || "";
  form.dataset.newLine = button.dataset.newLine || "";
  form.dataset.oldLine = button.dataset.oldLine || "";
  form.dataset.baseSha = button.dataset.baseSha || "";
  form.dataset.headSha = button.dataset.headSha || "";
  form.dataset.startSha = button.dataset.startSha || "";
  const textarea = document.createElement("textarea");
  textarea.name = "body";
  textarea.rows = 3;
  textarea.required = true;
  textarea.setAttribute("aria-label", message("comment", "Comment"));
  const submit = document.createElement("button");
  submit.className = "primary-button";
  submit.type = "submit";
  submit.textContent = message("send", "Send");
  const cancel = document.createElement("button");
  cancel.className = "secondary-button";
  cancel.type = "button";
  cancel.textContent = message("cancel", "Cancel");
  cancel.addEventListener("click", () => wrapper.remove());
  form.append(textarea, submit, cancel);
  cell.append(form);
  wrapper.append(cell);
  row.after(wrapper);
  textarea.focus();
}

async function submitForm(form) {
  const values = new FormData(form);
  if (form.dataset.form === "filters") {
    await performAction({
      type: "navigate",
      view: state.view,
      filters: {
        state: values.get("state"),
        search: values.get("search"),
        labels: splitLabels(values.get("labels")),
        assignee: values.get("assignee"),
        author: values.get("author"),
        page: 1,
      },
    });
    return;
  }

  if (form.dataset.form === "comment") {
    await performAction({
      type: "comment",
      kind: currentKind(),
      iid: currentIid(),
      body: values.get("body"),
    });
  } else if (form.dataset.form === "reply") {
    await performAction({
      type: "reply",
      kind: currentKind(),
      iid: currentIid(),
      discussionId: form.dataset.discussionId,
      body: values.get("body"),
    });
  } else if (form.dataset.form === "assignee") {
    await performAction({
      type: "set_assignee",
      kind: form.dataset.kind,
      iid: currentIid(),
      assignee: values.get("assignee"),
    });
  } else if (form.dataset.form === "label-add") {
    await performAction({
      type: "set_labels",
      kind: form.dataset.kind,
      iid: currentIid(),
      add: [values.get("label")],
    });
  } else if (form.dataset.form === "diff-comment") {
    await performAction({
      type: "diff_comment",
      iid: currentIid(),
      body: values.get("body"),
      position: createDiffCommentPosition(form.dataset),
    });
  }
  form.reset();
}

app.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) {
    return;
  }
  event.preventDefault();
  void submitForm(form);
});

app.addEventListener("change", (event) => {
  if (event.target.matches("[data-language]")) {
    void performAction({
      type: "set_language",
      language: event.target.value,
    });
  }
});

app.addEventListener("click", (event) => {
  const reference = event.target.closest("[data-reference-kind][data-iid]");
  if (reference) {
    event.preventDefault();
    activeTab = "overview";
    void performAction({
      type: "navigate",
      view: reference.dataset.referenceKind === "issue" ? "issue_detail" : "mr_detail",
      iid: Number(reference.dataset.iid),
      filters: state.filters,
    });
    return;
  }

  const routeButton = event.target.closest("[data-nav], [data-open-view]");
  if (routeButton) {
    const view = routeButton.dataset.nav || routeButton.dataset.openView;
    const iid = routeButton.dataset.iid ? Number(routeButton.dataset.iid) : undefined;
    activeTab = "overview";
    void performAction({ type: "navigate", view, iid, filters: state.filters });
    return;
  }

  const pageButton = event.target.closest("[data-page]");
  if (pageButton && !pageButton.disabled) {
    void performAction({
      type: "navigate",
      view: state.view,
      filters: { ...state.filters, page: Number(pageButton.dataset.page) },
    });
    return;
  }

  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) {
    activeTab = tabButton.dataset.tab;
    render();
    return;
  }

  const diffButton = event.target.closest("[data-diff-comment]");
  if (diffButton) {
    openDiffComment(diffButton);
    return;
  }

  const button = event.target.closest("[data-command]");
  if (!button) {
    return;
  }

  const command = button.dataset.command;
  if (command === "refresh") {
    void performAction({ type: "refresh" });
  } else if (command === "set-state") {
    void performAction({
      type: "set_state",
      kind: button.dataset.kind || currentKind(),
      iid: currentIid(),
      state: button.dataset.state,
    });
  } else if (command === "approve" || command === "unapprove") {
    void performAction({ type: command, iid: currentIid() });
  } else if (command === "resolve") {
    void performAction({
      type: "resolve",
      iid: currentIid(),
      discussionId: button.dataset.discussionId,
      resolved: button.dataset.resolved !== "true",
    });
  } else if (command === "label-remove") {
    void performAction({
      type: "set_labels",
      kind: currentKind(),
      iid: currentIid(),
      remove: [button.dataset.label],
    });
  } else if (command === "chat") {
    void performAction({
      type: "chat",
      kind: currentKind(),
      iid: currentIid(),
      intent: button.dataset.intent,
    });
  }
});

async function receiveState() {
  try {
    state = await requestJson("/api/state");
    render();
  } catch (error) {
    state = {
      view: "mr_list",
      error: error.message,
      messages: {},
      data: {},
      filters: { state: "opened", page: 1 },
    };
    render();
  }
}

async function listenForUpdates() {
  while (eventStreamOpen) {
    try {
      const response = await fetch("/events", {
        headers: { "x-gitlab-canvas-token": token },
        signal: eventStreamController.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Event stream failed with status ${response.status}.`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (eventStreamOpen) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const eventText of events) {
          const data = eventText
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (data) {
            state = JSON.parse(data);
            render();
          }
        }
      }
    } catch {
      if (!eventStreamOpen) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

window.addEventListener("pagehide", () => {
  eventStreamOpen = false;
  eventStreamController.abort();
});

await receiveState();
void listenForUpdates();
