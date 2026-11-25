import { escapeHtml, renderDiscussionThread } from "./views/common.js";

function notePosition(discussion) {
  return discussion.notes?.find((note) => note.position)?.position ?? null;
}

function renderInlineThreads(discussions, file, row, state) {
  return discussions
    .filter((discussion) => {
      const position = notePosition(discussion);
      return (
        position &&
        ((position.newPath === file.newPath &&
          position.newLine != null &&
          position.newLine === row.newLine) ||
          (position.oldPath === file.oldPath &&
            position.oldLine != null &&
            position.oldLine === row.oldLine))
      );
    })
    .map((discussion) => {
      const thread = renderDiscussionThread(discussion, state, {
        allowResolve: true,
      });
      return `<tr class="inline-thread-row"><td colspan="4">${thread}</td></tr>`;
    })
    .join("");
}

function parsePatch(diff) {
  const rows = [];
  let oldLine = null;
  let newLine = null;
  for (const line of String(diff ?? "").split(/\r?\n/)) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({ type: "hunk", text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      rows.push({ type: "meta", text: line, oldLine: null, newLine: null });
      continue;
    }
    if (oldLine == null || newLine == null) {
      rows.push({ type: "meta", text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ type: "added", text: line.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (line.startsWith("-")) {
      rows.push({ type: "removed", text: line.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else {
      rows.push({
        type: "context",
        text: line.startsWith(" ") ? line.slice(1) : line,
        oldLine,
        newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}

function renderPatch(file, discussions, state) {
  const rows = parsePatch(file.diff);
  if (!rows.length) {
    return `<p class="muted">Diff content is unavailable for this file.</p>`;
  }
  return `<div class="diff-scroll"><table class="diff-table"><tbody>${rows
    .map((row, index) => {
      if (row.type === "hunk" || row.type === "meta") {
        return `<tr class="diff-${row.type}"><td colspan="4">${escapeHtml(row.text)}</td></tr>`;
      }
      const path = file.newPath || file.oldPath;
      const diffRefs = state.data?.mergeRequest?.diffRefs ?? {};
      return `<tr class="diff-${row.type}">
        <td class="line-number">${row.oldLine ?? ""}</td><td class="line-number">${row.newLine ?? ""}</td>
        <td class="diff-content"><code>${escapeHtml(row.text)}</code></td>
        <td class="diff-comment"><button type="button" title="Add review comment" aria-label="Add review comment" data-diff-comment data-path="${escapeHtml(path)}" data-new-line="${row.newLine ?? ""}" data-old-line="${row.oldLine ?? ""}" data-base-sha="${escapeHtml(diffRefs.baseSha)}" data-head-sha="${escapeHtml(diffRefs.headSha)}" data-start-sha="${escapeHtml(diffRefs.startSha)}">+</button></td>
      </tr>${renderInlineThreads(discussions, file, row, state)}`;
    })
    .join("")}</tbody></table></div>`;
}

export function renderDiffFiles(diffs, discussions = [], state = {}) {
  if (!Array.isArray(diffs) || !diffs.length) {
    return `<p class="empty-state">${escapeHtml(state.messages?.noResults || "No changed files.")}</p>`;
  }
  return `<div class="diff-files">${diffs
    .map((file, index) => {
      const path = file.newPath || file.oldPath;
      const additions = (file.diff.match(/^\+(?!\+\+).*/gm) ?? []).length;
      const deletions = (file.diff.match(/^-(?!--).*/gm) ?? []).length;
      return `<details class="diff-file" open>
        <summary><span>${escapeHtml(path)}</span><span class="diff-count"><span class="added-count">+${additions}</span> <span class="removed-count">−${deletions}</span></span></summary>
        ${renderPatch(file, discussions, state)}
      </details>`;
    })
    .join("")}</div>`;
}
