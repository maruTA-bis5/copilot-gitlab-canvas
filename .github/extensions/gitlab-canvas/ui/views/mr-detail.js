import { renderMarkdown } from "../markdown.js";
import { renderDiffFiles } from "../diff-viewer.js";
import {
  escapeHtml,
  renderDiscussionList,
  renderMetadataForm,
  renderRelatedItems,
  safeExternalUrl,
} from "./common.js";

function renderOverview(state, mergeRequest) {
  const t = state.messages ?? {};
  const description = mergeRequest.description
    ? renderMarkdown(mergeRequest.description, {
        backend: state.mode,
        projectUrl: state.project?.projectUrl,
        openImageLabel: t.openInGitLab,
      })
    : `<p class="muted">${escapeHtml(t.noDescription || "No description provided.")}</p>`;
  const pipeline = mergeRequest.pipeline;
  const approvals = mergeRequest.approvals ?? {};
  const pipelineJobs = pipeline?.jobs ?? [];
  const pipelineStages = [...new Set(pipelineJobs.map((job) => job.stage).filter(Boolean))];

  return `<div class="detail-layout">
    <div class="detail-main">
      <section class="content-card markdown-body">${description}</section>
      <section class="content-card">
        <h2>${escapeHtml(t.comments || "Comments")}</h2>
        ${renderDiscussionList(state.data.discussions, state, { allowResolve: true })}
        <form class="comment-form" data-form="comment">
          <label>${escapeHtml(t.addComment || "Add a comment")}<textarea name="body" rows="4" required></textarea></label>
          <button type="submit" class="primary-button">${escapeHtml(t.send || "Send")}</button>
        </form>
      </section>
    </div>
    <aside class="detail-sidebar">
      <section class="metadata-card">
        <h3>${escapeHtml(t.pipeline || "Pipeline")}</h3>
        ${
          pipeline
            ? `<a class="pipeline-badge pipeline-${escapeHtml(pipeline.status)}" href="${escapeHtml(safeExternalUrl(pipeline.webUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(pipeline.status)}${pipeline.id ? ` #${pipeline.id}` : ""}</a>
              ${
                pipelineStages.length
                  ? `<ul class="pipeline-stages">${pipelineStages
                      .map((stage) => `<li><strong>${escapeHtml(stage)}</strong>: ${pipelineJobs
                        .filter((job) => job.stage === stage)
                        .map((job) => `${escapeHtml(job.name)} (${escapeHtml(job.status)})`)
                        .join(", ")}</li>`)
                      .join("")}</ul>`
                  : `<span class="muted">${pipelineJobs.length ? `${pipelineJobs.length} jobs` : ""}</span>`
              }`
            : `<span class="muted">${escapeHtml(t.noPipeline || "No pipeline information.")}</span>`
        }
        <h3>${escapeHtml(t.approvals || "Approvals")}</h3>
        <span>${approvals.approved ?? 0} / ${approvals.required ?? 0}</span>
      </section>
      ${renderMetadataForm(mergeRequest, state, "merge_requests")}
      <section class="metadata-card"><h3>${escapeHtml(t.relatedIssues || "Related issues")}</h3>${renderRelatedItems(state.data.relatedIssues, "issue", state)}</section>
    </aside>
  </div>`;
}

export function renderMergeRequestDetail(state) {
  const mergeRequest = state.data?.mergeRequest;
  const t = state.messages ?? {};
  if (!mergeRequest) {
    return `<section class="empty-state">${escapeHtml(t.mcpPending || "Waiting for GitLab data.")}</section>`;
  }

  const currentTab = state.activeTab === "changes" ? "changes" : "overview";
  const stateAction = mergeRequest.state === "closed" ? "opened" : "closed";
  const stateControl =
    mergeRequest.state === "merged"
      ? ""
      : `<button type="button" class="secondary-button" data-command="set-state" data-state="${stateAction}" data-kind="merge_requests">${escapeHtml(stateAction === "closed" ? t.close || "Close" : t.reopen || "Reopen")}</button>`;
  const statusLabel = mergeRequest.status === "draft"
    ? t.draft || "Draft"
    : t[mergeRequest.status] || mergeRequest.status;
  const detail =
    currentTab === "changes"
      ? `<section class="changes-view"><h2>${escapeHtml(t.changedFiles || "Changed files")}</h2>${renderDiffFiles(state.data.diffs, state.data.discussions, state)}</section>`
      : renderOverview(state, mergeRequest);

  return `<article class="detail-view">
    <div class="detail-heading">
      <div>
        <div class="item-number">!${mergeRequest.iid}</div>
        <h1>${escapeHtml(mergeRequest.title)}</h1>
        <div class="detail-subtitle"><span class="status-badge status-${escapeHtml(mergeRequest.status)}">${escapeHtml(statusLabel)}</span> · ${escapeHtml(mergeRequest.author?.name || mergeRequest.author?.username || "")} · ${escapeHtml(mergeRequest.createdAt)}</div>
        <div class="branch-line"><code>${escapeHtml(mergeRequest.sourceBranch)}</code><span>→</span><code>${escapeHtml(mergeRequest.targetBranch)}</code></div>
      </div>
      <a class="secondary-button" href="${escapeHtml(safeExternalUrl(mergeRequest.webUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.openInGitLab || "Open in GitLab")}</a>
    </div>
    <div class="detail-actions">
      ${stateControl}
      <button type="button" class="secondary-button" data-command="approve"${mergeRequest.state !== "opened" ? " disabled" : ""}>${escapeHtml(t.approve || "Approve")}</button>
      <button type="button" class="secondary-button" data-command="unapprove"${mergeRequest.state !== "opened" ? " disabled" : ""}>${escapeHtml(t.unapprove || "Unapprove")}</button>
      <button type="button" class="secondary-button" data-command="chat" data-intent="review">${escapeHtml(t.review || "Review this merge request")}</button>
      <button type="button" class="secondary-button" data-command="chat" data-intent="fix">${escapeHtml(t.fixFeedback || "Address review feedback")}</button>
    </div>
    <nav class="detail-tabs" aria-label="Merge request sections">
      <button type="button" data-tab="overview" class="${currentTab === "overview" ? "active" : ""}">${escapeHtml(t.overview || "Overview")}</button>
      <button type="button" data-tab="changes" class="${currentTab === "changes" ? "active" : ""}">${escapeHtml(t.changes || "Changes")}</button>
    </nav>
    ${detail}
  </article>`;
}
