import { renderMarkdown } from "../markdown.js";
import {
  escapeHtml,
  renderDiscussionList,
  renderMetadataForm,
  renderRelatedItems,
  safeExternalUrl,
} from "./common.js";

export function renderIssueDetail(state) {
  const issue = state.data?.issue;
  if (!issue) {
    return `<section class="empty-state">${escapeHtml(state.messages?.mcpPending || "Waiting for GitLab data.")}</section>`;
  }
  const t = state.messages ?? {};
  const statusAction = issue.state === "closed" ? "opened" : "closed";
  const description = issue.description
    ? renderMarkdown(issue.description, {
        backend: state.mode,
        projectUrl: state.project?.projectUrl,
        openImageLabel: t.openInGitLab,
      })
    : `<p class="muted">${escapeHtml(t.noDescription || "No description provided.")}</p>`;

  return `<article class="detail-view">
    <div class="detail-heading">
      <div>
        <div class="item-number">#${issue.iid}</div>
        <h1>${escapeHtml(issue.title)}</h1>
        <div class="detail-subtitle">${escapeHtml(issue.state)} · ${escapeHtml(issue.author?.name || issue.author?.username || "")} · ${escapeHtml(issue.createdAt)}</div>
      </div>
      <a class="secondary-button" href="${escapeHtml(safeExternalUrl(issue.webUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.openInGitLab || "Open in GitLab")}</a>
    </div>
    <div class="detail-actions">
      <button type="button" class="secondary-button" data-command="set-state" data-state="${statusAction}">${escapeHtml(statusAction === "closed" ? t.close || "Close" : t.reopen || "Reopen")}</button>
      <button type="button" class="secondary-button" data-command="chat" data-intent="investigate">${escapeHtml(t.investigate || "Investigate this item")}</button>
      <button type="button" class="secondary-button" data-command="chat" data-intent="plan">${escapeHtml(t.plan || "Create an implementation plan")}</button>
    </div>
    <div class="detail-layout">
      <div class="detail-main">
        <section class="content-card markdown-body">${description}</section>
        <section class="content-card">
          <h2>${escapeHtml(t.comments || "Comments")}</h2>
          ${renderDiscussionList(state.data.discussions, state)}
          <form class="comment-form" data-form="comment">
            <label>${escapeHtml(t.addComment || "Add a comment")}<textarea name="body" rows="4" required></textarea></label>
            <button type="submit" class="primary-button">${escapeHtml(t.send || "Send")}</button>
          </form>
        </section>
      </div>
      <aside class="detail-sidebar">
        <section class="metadata-card">
          <h3>${escapeHtml(t.status || "Status")}</h3><span class="status-badge status-${escapeHtml(issue.state)}">${escapeHtml(t[issue.state] || issue.state)}</span>
          <h3>${escapeHtml(t.milestone || "Milestone")}</h3><span>${escapeHtml(issue.milestone || "—")}</span>
        </section>
        ${renderMetadataForm(issue, state, "issues")}
        <section class="metadata-card"><h3>${escapeHtml(t.relatedMergeRequests || "Related merge requests")}</h3>${renderRelatedItems(state.data.relatedMergeRequests, "mr", state)}</section>
        <section class="metadata-card"><h3>${escapeHtml(t.relatedIssues || "Related issues")}</h3>${renderRelatedItems(state.data.relatedIssues, "issue", state)}</section>
      </aside>
    </div>
  </article>`;
}
