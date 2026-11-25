const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

function isUploadPath(value, projectUrl) {
  if (value.startsWith("/uploads/") && !value.split("/").includes("..")) {
    return value;
  }
  if (!projectUrl) {
    return null;
  }
  try {
    const target = new URL(value, projectUrl);
    const project = new URL(projectUrl);
    return target.origin === project.origin &&
      target.pathname.startsWith("/uploads/") &&
      !target.pathname.split("/").includes("..")
      ? `${target.pathname}${target.search}`
      : null;
  } catch {
    return null;
  }
}

function safeHref(value, projectUrl) {
  const trimmed = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!trimmed) {
    return null;
  }
  try {
    const base = projectUrl || "https://gitlab.com/";
    const target = new URL(trimmed, base);
    if (
      !["http:", "https:", "mailto:"].includes(target.protocol) ||
      target.username ||
      target.password
    ) {
      return null;
    }
    return target.href;
  } catch {
    return null;
  }
}

function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function renderInline(value, options = {}, nested = false) {
  const tokens = [];
  const keep = (html) => {
    const key = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return key;
  };
  let text = String(value ?? "");

  if (!nested) {
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, source, title) => {
      const upload = isUploadPath(source, options.projectUrl);
      if (upload && options.backend === "glab") {
        return keep(
          `<img alt="${escapeHtml(alt)}" data-upload-path="${escapeHtml(upload)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`,
        );
      }
      if (upload && options.backend === "mcp") {
        const project = new URL(options.projectUrl || "https://gitlab.com/");
        return keep(
          `<a href="${escapeHtml(new URL(upload, project).href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(options.openImageLabel || "Open image in GitLab")}</a>`,
        );
      }
      const href = safeHref(source, options.projectUrl);
      if (!href) {
        return escapeHtml(alt);
      }
      return keep(
        `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ""} loading="lazy">`,
      );
    });

    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, target, title) => {
      const href = safeHref(target, options.projectUrl);
      if (!href) {
        return escapeHtml(label);
      }
      return keep(
        `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHtml(title)}"` : ""}>${renderInline(label, options, true)}</a>`,
      );
    });
  }

  text = text.replace(/`([^`]+)`/g, (_, code) =>
    keep(`<code>${escapeHtml(code)}</code>`),
  );
  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  text = text.replace(/(^|[^\w/"'`])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^\w/"'`])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");

  if (!nested) {
    text = text.replace(
      /(^|[^\w/"'`])(#|!)(\d+)\b/g,
      (_, prefix, marker, iid) =>
        `${prefix}<a href="#" data-reference-kind="${marker === "#" ? "issue" : "merge_request"}" data-iid="${iid}">${marker}${iid}</a>`,
    );
  }
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? "";
  return (
    /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line) ||
    /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line) ||
    (line.includes("|") && isTableDivider(lines[index + 1] ?? ""))
  );
}

function renderTable(lines, start, options) {
  const headers = cells(lines[start]);
  const alignments = cells(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : "";
  });
  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(cells(lines[index]));
    index += 1;
  }
  const alignment = (column) =>
    alignments[column] ? ` style="text-align:${alignments[column]}"` : "";
  const header = headers
    .map(
      (cell, column) =>
        `<th${alignment(column)}>${renderInline(cell, options)}</th>`,
    )
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${headers
          .map(
            (_, column) =>
              `<td${alignment(column)}>${renderInline(row[column] ?? "", options)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return { html: `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`, index };
}

function renderList(lines, start, options) {
  const first = lines[start].match(/^\s*(\d+\.|[-*+])\s+(.*)$/);
  const ordered = /^\d+\.$/.test(first[1]);
  const tag = ordered ? "ol" : "ul";
  const items = [];
  let index = start;

  while (index < lines.length) {
    const match = lines[index].match(/^\s*(\d+\.|[-*+])\s+(.*)$/);
    if (!match || /^\d+\.$/.test(match[1]) !== ordered) {
      break;
    }
    let content = match[2];
    const task = !ordered && content.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      content = `<input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""}> ${renderInline(task[2], options)}`;
    } else {
      content = renderInline(content, options);
    }
    items.push(`<li>${content}</li>`);
    index += 1;
  }
  return { html: `<${tag}>${items.join("")}</${tag}>`, index };
}

export function renderMarkdown(markdown, options = {}) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([a-zA-Z0-9_+-]*)\s*$/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      blocks.push(
        `<pre><code${language}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2], options)}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
      const table = renderTable(lines, index, options);
      blocks.push(table.html);
      index = table.index;
      continue;
    }

    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdown(quote.join("\n"), options)}</blockquote>`);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const list = renderList(lines, index, options);
      blocks.push(list.html);
      index = list.index;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join("\n").replace(/\n/g, "  \n"), options).replace(/ {2}\n/g, "<br>")}</p>`);
  }

  return blocks.join("\n");
}
