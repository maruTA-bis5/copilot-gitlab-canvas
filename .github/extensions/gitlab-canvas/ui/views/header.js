import { backendLabel, escapeHtml, safeExternalUrl } from "./common.js";

const gitLabIcon = `<svg class="gitlab-icon" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
  <path fill="#E24329" d="M18 34.2 24.6 13.9H11.4z"/>
  <path fill="#FC6D26" d="m18 34.2-6.6-20.3-9.2 5.8a2 2 0 0 0 0 3.5L18 34.2z"/>
  <path fill="#FCA326" d="m2.2 19.7 1.8-5.4 3.8-11.6c.4-1.1 1.9-1.1 2.2 0l1.8 5.5-9.6 11.5z"/>
  <path fill="#FC6D26" d="M18 34.2 24.6 13.9l9.2 5.8a2 2 0 0 1 0 3.5L18 34.2z"/>
  <path fill="#FCA326" d="m33.8 19.7-1.8-5.4-3.8-11.6c-.4-1.1-1.9-1.1-2.2 0l-1.8 5.5 9.6 11.5z"/>
</svg>`;

export function renderHeader(state = {}) {
  const messages = state.messages ?? {};
  const message = (key, fallback) => messages[key] || fallback || key;
  const view = state.view ?? "mr_list";
  const isIssues = view.startsWith("issue");
  const projectPath = state.project?.project || state.project?.path || "";
  const lang = state.languagePreference || "auto";
  const mode = backendLabel(state.mode);
  const item =
    view === "issue_detail"
      ? state.data?.issue
      : view === "mr_detail"
        ? state.data?.mergeRequest
        : null;
  const itemNumber = state.iid ?? item?.iid;
  const prefix = isIssues ? "#" : "!";
  const isDetail = view === "issue_detail" || view === "mr_detail";
  let title;
  if (item) {
    title = [itemNumber == null ? "" : `${prefix}${itemNumber}`, item.title]
      .filter(Boolean)
      .join(" ");
  } else if (isDetail && itemNumber != null) {
    title = `${prefix}${itemNumber}`;
  } else {
    title = isIssues
      ? message("issues", "Issues")
      : message("mergeRequests", "Merge requests");
  }
  const tooltip = [title, projectPath].filter(Boolean).join(" — ");
  const projectUrl = safeExternalUrl(state.project?.projectUrl);
  const openLink =
    projectUrl && projectUrl !== "#"
      ? `<a class="secondary-button" href="${escapeHtml(projectUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(message("openInGitLab", "Open in GitLab"))}</a>`
      : "";

  return `<header class="app-header">
    <div class="brand" title="${escapeHtml(tooltip)}">
      <span class="brand-mark" aria-hidden="true">${gitLabIcon}</span>
      <span class="header-title">${escapeHtml(title)}</span>
    </div>
    <nav class="header-nav" aria-label="GitLab sections">
      <button type="button" class="${isIssues ? "active" : ""}" data-nav="issue_list">${escapeHtml(message("issues", "Issues"))}</button>
      <button type="button" class="${!isIssues ? "active" : ""}" data-nav="mr_list">${escapeHtml(message("mergeRequests", "Merge requests"))}</button>
    </nav>
    <div class="header-actions">
      <span class="mode-indicator" title="${escapeHtml(message("backend", "Backend"))}">${escapeHtml(mode)}</span>
      <button type="button" class="secondary-button" data-command="refresh">${escapeHtml(message("refresh", "Refresh"))}</button>
      ${openLink}
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
