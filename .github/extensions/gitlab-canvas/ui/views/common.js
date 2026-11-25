import { renderMarkdown } from "../markdown.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export function safeExternalUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return "#";
    }
    return url.href;
  } catch {
    return "#";
  }
}

export function renderLabels(labels, { removable = false } = {}) {
  if (!Array.isArray(labels) || !labels.length) {
    return `<span class="muted">—</span>`;
  }
  return labels
    .map(
      (label) =>
        `<span class="label-pill">${escapeHtml(label)}${
          removable
            ? `<button type="button" class="icon-button" aria-label="Remove ${escapeHtml(label)}" data-command="label-remove" data-label="${escapeHtml(label)}">×</button>`
            : ""
        }</span>`,
    )
    .join("");
}

export function renderPeople(people) {
  if (!Array.isArray(people) || !people.length) {
    return `<span class="muted">—</span>`;
  }
  return people
    .map((person) => `<span class="person">${escapeHtml(person.name || person.username)}</span>`)
    .join("");
}

export function renderRelatedItems(items, kind, state) {
  if (!items?.length) {
    return `<p class="muted">—</p>`;
  }
  return `<div class="related-list">${items
    .map(
      (item) => `<button type="button" class="related-item" data-open-view="${kind === "issue" ? "issue_detail" : "mr_detail"}" data-iid="${item.iid}">
        <span>${kind === "issue" ? "#" : "!"}${item.iid}</span>${escapeHtml(item.title)}
      </button>`,
    )
    .join("")}</div>`;
}

export function renderDiscussionThread(thread, state, options = {}) {
  const t = state.messages ?? {};
  const notes = (thread.notes ?? [])
    .map(
      (note) => `<article class="note">
        <div class="note-meta"><strong>${escapeHtml(note.author?.name || note.author?.username || "Unknown user")}</strong><time>${escapeHtml(note.createdAt)}</time></div>
        <div class="markdown-body">${renderMarkdown(note.body, {
          backend: state.mode,
          projectUrl: state.project?.projectUrl,
          openImageLabel: t.openInGitLab || "Open image in GitLab",
        })}</div>
      </article>`,
    )
    .join("");
  const discussionId = escapeHtml(thread.id);
  const controls =
    options.allowResolve && thread.resolvable
      ? `<button type="button" class="text-button" data-command="resolve" data-discussion-id="${discussionId}" data-resolved="${thread.resolved ? "true" : "false"}">${thread.resolved ? escapeHtml(t.unresolve || "Reopen thread") : escapeHtml(t.resolve || "Resolve")}</button>`
      : "";
  const replyForm = `<form class="reply-form" data-form="reply" data-discussion-id="${discussionId}">
    <textarea name="body" rows="2" required aria-label="${escapeHtml(t.reply || "Reply")}"></textarea>
    <button type="submit" class="secondary-button">${escapeHtml(t.reply || "Reply")}</button>
  </form>`;
  return `<section class="discussion-thread${thread.resolved ? " is-resolved" : ""}" data-thread-id="${discussionId}">
    ${notes}${controls}${replyForm}
  </section>`;
}

export function renderDiscussionList(threads, state, options = {}) {
  if (!Array.isArray(threads) || !threads.length) {
    return `<p class="muted">${escapeHtml(state.messages?.noDiscussions || "No discussions yet.")}</p>`;
  }
  return threads
    .map((thread) => renderDiscussionThread(thread, state, options))
    .join("");
}

export function renderMetadataForm(item, state, kind) {
  const t = state.messages ?? {};
  return `<section class="metadata-card">
    <h3>${escapeHtml(t.assignee || "Assignee")}</h3>
    <form data-form="assignee" data-kind="${kind}">
      <input name="assignee" value="${escapeHtml(item.assignees?.[0]?.username || "")}" placeholder="@username">
      <button type="submit" class="secondary-button">${escapeHtml(t.saveAssignee || "Save assignee")}</button>
    </form>
    <h3>${escapeHtml(t.labels || "Labels")}</h3>
    <div class="label-list">${renderLabels(item.labels, { removable: true })}</div>
    <form class="label-form" data-form="label-add" data-kind="${kind}">
      <input name="label" placeholder="${escapeHtml(t.addLabel || "Add label")}" required>
      <button type="submit" class="secondary-button">${escapeHtml(t.addLabel || "Add label")}</button>
    </form>
  </section>`;
}
