import { execFile } from "node:child_process";

export class GlabError extends Error {
  constructor(message, { code = "glab_error", exitCode = null, cause } = {}) {
    super(message, { cause });
    this.name = "GlabError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function sanitizeOutput(value) {
  return String(value ?? "")
    .replace(/((?:private-token|job-token|access-token|token)\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?\S+/gi, "$1[redacted]")
    .slice(0, 1000)
    .trim();
}

function queryString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null || value === "") {
      continue;
    }
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function flattenFields(value, prefix = "") {
  const fields = [];
  for (const [key, entry] of Object.entries(value ?? {})) {
    const field = prefix ? `${prefix}[${key}]` : key;
    if (entry == null) {
      continue;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        fields.push([`${field}[]`, String(item)]);
      }
    } else if (typeof entry === "object") {
      fields.push(...flattenFields(entry, field));
    } else {
      fields.push([field, String(entry)]);
    }
  }
  return fields;
}

export class GlabClient {
  constructor({
    host,
    project,
    baseUrl = `https://${host}`,
    cwd = process.cwd(),
    execFileImpl = execFile,
    timeout = 20_000,
    maxBuffer = 20 * 1024 * 1024,
  }) {
    if (!host || !project) {
      throw new TypeError("A GitLab host and project are required.");
    }
    this.host = host;
    this.project = project;
    this.projectId = encodeURIComponent(project);
    this.baseUrl = new URL(baseUrl).origin;
    this.cwd = cwd;
    this.execFileImpl = execFileImpl;
    this.timeout = timeout;
    this.maxBuffer = maxBuffer;
  }

  async run(args, { binary = false } = {}) {
    const options = {
      cwd: this.cwd,
      encoding: binary ? null : "utf8",
      maxBuffer: this.maxBuffer,
      shell: false,
      timeout: this.timeout,
      windowsHide: true,
    };
    return new Promise((resolve, reject) => {
      this.execFileImpl("glab", args, options, (error, stdout, stderr) => {
        if (error) {
          const output = sanitizeOutput(stderr);
          const detail = output ? `: ${output}` : "";
          reject(
            new GlabError(`glab command failed${detail}`, {
              code: error.code === "ENOENT" ? "glab_not_installed" : "glab_command_failed",
              exitCode: Number.isInteger(error.code) ? error.code : null,
              cause: error,
            }),
          );
          return;
        }
        resolve(stdout);
      });
    });
  }

  async checkAvailability() {
    try {
      await this.run(["--version"]);
    } catch (error) {
      return {
        available: false,
        reason: error.code === "glab_not_installed" ? "not_installed" : "command_failed",
        message: error.message,
      };
    }

    try {
      await this.run(["auth", "status", "--hostname", this.host]);
    } catch (error) {
      return {
        available: false,
        reason: "not_authenticated",
        message: error.message,
      };
    }
    return { available: true, reason: null, message: "" };
  }

  async api(method, endpoint, { query, fields, binary = false } = {}) {
    const target = `${endpoint}${queryString(query)}`;
    const args = [
      "api",
      "--hostname",
      this.host,
      "--method",
      method.toUpperCase(),
      target,
    ];
    for (const [key, value] of flattenFields(fields)) {
      args.push("--raw-field", `${key}=${value}`);
    }

    const output = await this.run(args, { binary });
    if (binary) {
      return Buffer.isBuffer(output) ? output : Buffer.from(output);
    }
    const text = String(output ?? "").trim();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new GlabError("GitLab returned an invalid JSON response.", {
        code: "glab_invalid_response",
        cause: error,
      });
    }
  }

  projectEndpoint(resource) {
    return `projects/${this.projectId}/${resource.replace(/^\/+/, "")}`;
  }

  listIssues(filters = {}) {
    if (filters.state === "merged") {
      return Promise.resolve([]);
    }
    return this.api("GET", this.projectEndpoint("issues"), {
      query: {
        state: filters.state,
        search: filters.search,
        labels: filters.labels,
        assignee_username: filters.assignee,
        author_username: filters.author,
        page: filters.page ?? 1,
        per_page: 50,
        order_by: "updated_at",
        sort: "desc",
      },
    });
  }

  listMergeRequests(filters = {}) {
    return this.api("GET", this.projectEndpoint("merge_requests"), {
      query: {
        state: filters.state,
        search: filters.search,
        labels: filters.labels,
        assignee_username: filters.assignee,
        author_username: filters.author,
        page: filters.page ?? 1,
        per_page: 50,
        order_by: "updated_at",
        sort: "desc",
      },
    });
  }

  getIssue(iid) {
    return this.api("GET", this.projectEndpoint(`issues/${Number(iid)}`));
  }

  getMergeRequest(iid) {
    return this.api("GET", this.projectEndpoint(`merge_requests/${Number(iid)}`));
  }

  getDiscussions(kind, iid) {
    return this.api(
      "GET",
      this.projectEndpoint(`${kind === "issues" ? "issues" : "merge_requests"}/${Number(iid)}/discussions`),
      { query: { per_page: 100 } },
    );
  }

  getMergeRequestChanges(iid) {
    return this.api(
      "GET",
      this.projectEndpoint(`merge_requests/${Number(iid)}/changes`),
    );
  }

  getRelatedIssues(iid) {
    return this.api(
      "GET",
      this.projectEndpoint(`issues/${Number(iid)}/related_issues`),
    );
  }

  getRelatedMergeRequests(issueIid) {
    return this.api(
      "GET",
      this.projectEndpoint(`issues/${Number(issueIid)}/related_merge_requests`),
    );
  }

  getMergeRequestClosingIssues(iid) {
    return this.api(
      "GET",
      this.projectEndpoint(`merge_requests/${Number(iid)}/closes_issues`),
    );
  }

  getApprovals(iid) {
    return this.api(
      "GET",
      this.projectEndpoint(`merge_requests/${Number(iid)}/approvals`),
    );
  }

  getPipelineJobs(pipelineId) {
    return this.api(
      "GET",
      this.projectEndpoint(`pipelines/${Number(pipelineId)}/jobs`),
      { query: { per_page: 100 } },
    );
  }

  async createNote(kind, iid, body) {
    const resource = kind === "issues" ? "issues" : "merge_requests";
    return this.api(
      "POST",
      this.projectEndpoint(`${resource}/${Number(iid)}/notes`),
      { fields: { body } },
    );
  }

  replyToDiscussion(kind, iid, discussionId, body) {
    const resource = kind === "issues" ? "issues" : "merge_requests";
    return this.api(
      "POST",
      this.projectEndpoint(
        `${resource}/${Number(iid)}/discussions/${encodeURIComponent(discussionId)}/notes`,
      ),
      { fields: { body } },
    );
  }

  resolveDiscussion(iid, discussionId, resolved) {
    return this.api(
      "PUT",
      this.projectEndpoint(
        `merge_requests/${Number(iid)}/discussions/${encodeURIComponent(discussionId)}`,
      ),
      { fields: { resolved: Boolean(resolved) } },
    );
  }

  updateState(kind, iid, state) {
    const resource = kind === "issues" ? "issues" : "merge_requests";
    const stateEvent = state === "closed" ? "close" : "reopen";
    return this.api(
      "PUT",
      this.projectEndpoint(`${resource}/${Number(iid)}`),
      { fields: { state_event: stateEvent } },
    );
  }

  async updateAssignee(kind, iid, username) {
    const resource = kind === "issues" ? "issues" : "merge_requests";
    let assigneeId = 0;
    if (username) {
      const users = await this.api("GET", "users", {
        query: { username: String(username).replace(/^@/, "") },
      });
      const match = Array.isArray(users)
        ? users.find(
            (user) =>
              user.username?.toLowerCase() === String(username).replace(/^@/, "").toLowerCase(),
          )
        : null;
      if (!match) {
        throw new GlabError(`GitLab user "${username}" was not found.`, {
          code: "gitlab_user_not_found",
        });
      }
      assigneeId = Number(match.id);
    }
    return this.api(
      "PUT",
      this.projectEndpoint(`${resource}/${Number(iid)}`),
      { fields: { "assignee_ids[]": assigneeId } },
    );
  }

  async updateLabels(kind, iid, { add = [], remove = [] } = {}) {
    const current =
      kind === "issues" ? await this.getIssue(iid) : await this.getMergeRequest(iid);
    const labels = new Set(Array.isArray(current.labels) ? current.labels : []);
    for (const label of remove) {
      labels.delete(String(label));
    }
    for (const label of add) {
      if (String(label).trim()) {
        labels.add(String(label).trim());
      }
    }
    const resource = kind === "issues" ? "issues" : "merge_requests";
    return this.api(
      "PUT",
      this.projectEndpoint(`${resource}/${Number(iid)}`),
      { fields: { labels: [...labels].join(",") } },
    );
  }

  createDiffDiscussion(iid, body, position) {
    return this.api(
      "POST",
      this.projectEndpoint(`merge_requests/${Number(iid)}/discussions`),
      { fields: { body, position } },
    );
  }

  approveMergeRequest(iid) {
    return this.api(
      "POST",
      this.projectEndpoint(`merge_requests/${Number(iid)}/approve`),
    );
  }

  unapproveMergeRequest(iid) {
    return this.api(
      "POST",
      this.projectEndpoint(`merge_requests/${Number(iid)}/unapprove`),
    );
  }

  getUpload(uploadPath) {
    if (typeof uploadPath !== "string" || !uploadPath) {
      throw new GlabError("Only GitLab /uploads/ paths can be proxied.", {
        code: "invalid_upload_path",
      });
    }
    const rawPath = uploadPath
      .replace(/^https?:\/\/[^/]+/i, "")
      .split(/[?#]/, 1)[0];
    let decodedPath;
    let url;
    try {
      decodedPath = decodeURIComponent(rawPath);
      url = new URL(uploadPath, this.baseUrl);
    } catch (error) {
      throw new GlabError("Only valid GitLab upload paths can be proxied.", {
        code: "invalid_upload_path",
        cause: error,
      });
    }
    if (
      url.origin !== this.baseUrl ||
      decodedPath.includes("\\") ||
      decodedPath.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      throw new GlabError("The upload URL is outside the configured GitLab host.", {
        code: "invalid_upload_path",
      });
    }
    const encodedProjectPath = this.project
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const projectPathPrefix = `/${encodedProjectPath}/uploads/`;
    const encodedProjectIdPrefix = `/${encodeURIComponent(this.project)}/uploads/`;
    if (url.pathname.startsWith("/uploads/")) {
      url.pathname = `/${encodedProjectPath}${url.pathname}`;
    } else if (
      !url.pathname.startsWith(projectPathPrefix) &&
      !url.pathname.startsWith(encodedProjectIdPrefix)
    ) {
      throw new GlabError("Only GitLab project upload paths can be proxied.", {
        code: "invalid_upload_path",
      });
    }
    return this.api("GET", url.href, { binary: true });
  }
}
