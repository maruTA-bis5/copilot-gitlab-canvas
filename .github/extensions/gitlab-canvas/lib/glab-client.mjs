import { execFile } from "node:child_process";
import { win32 as win32Path } from "node:path";

const PROJECT_LABELS_PAGE_SIZE = 100;
const MAX_PROJECT_LABEL_PAGES = 100;

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
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/[^/@\s:]+:)[^/@\s]+@/gi,
      "$1[redacted]@",
    )
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

function withoutNullFields(value) {
  if (Array.isArray(value)) {
    return value.map(withoutNullFields);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry != null)
        .map(([key, entry]) => [key, withoutNullFields(entry)]),
    );
  }
  return value;
}

function fieldArguments(fields) {
  const args = [];
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value == null) {
      continue;
    }
    if (typeof value === "object" || typeof value === "boolean") {
      args.push("--field", `${key}=${JSON.stringify(withoutNullFields(value))}`);
    } else {
      args.push("--raw-field", `${key}=${String(value)}`);
    }
  }
  return args;
}

function fallbackExecutables(environment, platform) {
  const candidates = [environment.GLAB_PATH, environment.GLAB_BIN];
  if (platform === "win32") {
    if (environment.LOCALAPPDATA) {
      candidates.push(
        win32Path.join(
          environment.LOCALAPPDATA,
          "Programs",
          "glab",
          "glab.exe",
        ),
      );
    }
    if (environment.USERPROFILE) {
      candidates.push(
        win32Path.join(
          environment.USERPROFILE,
          "AppData",
          "Local",
          "Programs",
          "glab",
          "glab.exe",
        ),
      );
    }
  }
  return [
    ...new Set(
      candidates
        .filter((candidate) => typeof candidate === "string" && candidate.trim())
        .map((candidate) => candidate.trim()),
    ),
  ];
}

function commandError(error) {
  const output = sanitizeOutput(error?.stderr);
  const detail = output ? `: ${output}` : "";
  return new GlabError(`glab command failed${detail}`, {
    code: error?.code === "ENOENT" ? "glab_not_installed" : "glab_command_failed",
    exitCode: Number.isInteger(error?.code) ? error.code : null,
    cause: error,
  });
}

export class GlabClient {
  constructor({
    host,
    project,
    baseUrl = `https://${host}`,
    cwd = process.cwd(),
    execFileImpl = execFile,
    env = process.env,
    platform = process.platform,
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
    this.executable = "glab";
    this.fallbackExecutables = fallbackExecutables(env, platform);
    this.timeout = timeout;
    this.maxBuffer = maxBuffer;
  }

  runExecutable(executable, args, options) {
    return new Promise((resolve, reject) => {
      this.execFileImpl(executable, args, options, (error, stdout, stderr) => {
        if (error) {
          const failure = new Error(error.message, { cause: error });
          failure.code = error.code;
          failure.stderr = stderr;
          reject(failure);
          return;
        }
        resolve(stdout);
      });
    });
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
    const executables = [
      this.executable,
      ...this.fallbackExecutables.filter(
        (executable) => executable !== this.executable,
      ),
    ];
    for (const [index, executable] of executables.entries()) {
      try {
        const output = await this.runExecutable(executable, args, options);
        this.executable = executable;
        return output;
      } catch (error) {
        if (error.code === "ENOENT" && index < executables.length - 1) {
          continue;
        }
        throw commandError(error);
      }
    }
    throw new GlabError("glab command could not be resolved.", {
      code: "glab_not_installed",
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
    args.push(...fieldArguments(fields));

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
        with_labels_details: true,
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
        with_labels_details: true,
        order_by: "updated_at",
        sort: "desc",
      },
    });
  }

  getIssue(iid) {
    return this.api(
      "GET",
      this.projectEndpoint(`issues/${Number(iid)}`),
      { query: { with_labels_details: true } },
    );
  }

  getMergeRequest(iid) {
    return this.api(
      "GET",
      this.projectEndpoint(`merge_requests/${Number(iid)}`),
      { query: { with_labels_details: true } },
    );
  }

  async getProjectLabels() {
    const labels = [];
    for (let page = 1; page <= MAX_PROJECT_LABEL_PAGES; page += 1) {
      const currentPage = await this.api(
        "GET",
        this.projectEndpoint("labels"),
        { query: { per_page: PROJECT_LABELS_PAGE_SIZE, page } },
      );
      if (!Array.isArray(currentPage)) {
        throw new GlabError("GitLab returned an invalid project labels response.", {
          code: "glab_invalid_response",
        });
      }
      labels.push(...currentPage);
      if (currentPage.length < PROJECT_LABELS_PAGE_SIZE) {
        return labels;
      }
    }
    throw new GlabError(
      `GitLab project labels exceeded the ${MAX_PROJECT_LABEL_PAGES}-page safety limit.`,
      { code: "glab_pagination_limit" },
    );
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

  async getRelatedIssues(iid) {
    const currentIid = Number(iid);
    const links = await this.api(
      "GET",
      this.projectEndpoint(`issues/${currentIid}/links`),
    );
    if (!Array.isArray(links)) {
      return [];
    }
    return links
      .map((link) => {
        const source = link.source_issue;
        const target = link.target_issue;
        if (!source && !target) {
          return link;
        }
        if (Number(source?.iid) === currentIid) {
          return target;
        }
        if (Number(target?.iid) === currentIid) {
          return source;
        }
        return target ?? source;
      })
      .filter(Boolean);
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
      { fields: { assignee_ids: [assigneeId] } },
    );
  }

  async updateLabels(kind, iid, { add = [], remove = [] } = {}) {
    const normalizeNames = (values) =>
      [...new Set(
        (Array.isArray(values) ? values : [])
          .map((label) => String(label ?? "").trim())
          .filter(Boolean),
      )];
    const addLabels = normalizeNames(add);
    const addLabelSet = new Set(addLabels);
    const removeLabels = normalizeNames(remove).filter(
      (label) => !addLabelSet.has(label),
    );
    const fields = {};
    if (addLabels.length) {
      fields.add_labels = addLabels.join(",");
    }
    if (removeLabels.length) {
      fields.remove_labels = removeLabels.join(",");
    }
    if (!Object.keys(fields).length) {
      return null;
    }
    const resource = kind === "issues" ? "issues" : "merge_requests";
    return this.api(
      "PUT",
      this.projectEndpoint(`${resource}/${Number(iid)}`),
      { fields },
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
