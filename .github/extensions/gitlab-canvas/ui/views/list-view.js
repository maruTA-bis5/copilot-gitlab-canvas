import { escapeHtml, renderLabels, renderPeople } from "./common.js";

const stateOptions = ["opened", "closed", "merged", "all"];

function renderFilters(state) {
  const filters = state.filters ?? {};
  const t = state.messages ?? {};
  const options = stateOptions
    .map(
      (value) =>
        `<option value="${value}"${(filters.state ?? "opened") === value ? " selected" : ""}>${escapeHtml(t[value] || value)}</option>`,
    )
    .join("");
  return `<form class="filter-bar" data-form="filters">
    <label>${escapeHtml(t.state || "State")}<select name="state">${options}</select></label>
    <label>${escapeHtml(t.search || "Search")}<input name="search" value="${escapeHtml(filters.search || "")}" placeholder="${escapeHtml(t.search || "Search")}"></label>
    <label>${escapeHtml(t.labels || "Labels")}<input name="labels" value="${escapeHtml((filters.labels || []).join(", "))}" placeholder="bug, needs triage"></label>
    <label>${escapeHtml(t.assignee || "Assignee")}<input name="assignee" value="${escapeHtml(filters.assignee || "")}" placeholder="@username"></label>
    <label>${escapeHtml(t.author || "Author")}<input name="author" value="${escapeHtml(filters.author || "")}" placeholder="@username"></label>
    <button type="submit" class="primary-button">${escapeHtml(t.search || "Search")}</button>
  </form>`;
}

function itemStatus(item, isMr, t) {
  if (isMr && item.status === "draft") {
    return `<span class="status-badge status-draft">${escapeHtml(t.draft || "Draft")}</span>`;
  }
  return `<span class="status-badge status-${escapeHtml(item.state)}">${escapeHtml(t[item.state] || item.state)}</span>`;
}

function renderItem(item, isMr, state) {
  const t = state.messages ?? {};
  const number = `${isMr ? "!" : "#"}${item.iid}`;
  const pipelineStatus = item.pipeline?.status || "";
  const pipelineIcon = {
    canceled: "×",
    failed: "×",
    manual: "‖",
    pending: "○",
    running: "…",
    skipped: "−",
    success: "✓",
  }[pipelineStatus] || "·";
  const pipeline = isMr
    ? `<span class="pipeline-status pipeline-${escapeHtml(pipelineStatus)}" role="img" aria-label="${escapeHtml(pipelineStatus || t.noPipeline || "No pipeline")}" title="${escapeHtml(pipelineStatus || t.noPipeline || "No pipeline")}">${pipelineIcon}</span>`
    : "";
  return `<button type="button" class="list-row" data-open-view="${isMr ? "mr_detail" : "issue_detail"}" data-iid="${item.iid}">
    <span class="list-row-main">
      <span class="list-row-title"><span class="item-number">${escapeHtml(number)}</span><strong>${escapeHtml(item.title)}</strong>${itemStatus(item, isMr, t)}</span>
      <span class="list-row-meta">${renderLabels(item.labels)}<span>${escapeHtml(item.author?.name || item.author?.username || "")}</span>${renderPeople(item.assignees)}<span>${item.comments} ${escapeHtml(t.comments || "Comments")}</span><time>${escapeHtml(item.updatedAt || "")}</time>${pipeline}</span>
    </span>
  </button>`;
}

export function renderListView(state) {
  const isMr = state.view === "mr_list";
  const items = state.data?.items ?? [];
  const t = state.messages ?? {};
  const page = Math.max(1, Number(state.filters?.page ?? 1));
  const hasNext = items.length >= 50;
  return `<section class="list-view">
    ${renderFilters(state)}
    <div class="list-results" aria-live="polite">
      ${
        items.length
          ? items.map((item) => renderItem(item, isMr, state)).join("")
          : `<p class="empty-state">${escapeHtml(t.noResults || "No results found.")}</p>`
      }
    </div>
    <nav class="pagination" aria-label="Pagination">
      <button type="button" class="secondary-button" data-page="${page - 1}"${page <= 1 ? " disabled" : ""}>${escapeHtml(t.previous || "Previous")}</button>
      <span>${page}</span>
      <button type="button" class="secondary-button" data-page="${page + 1}"${hasNext ? "" : " disabled"}>${escapeHtml(t.next || "Next")}</button>
    </nav>
  </section>`;
}
