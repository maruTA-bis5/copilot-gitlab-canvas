import { execFile } from "node:child_process";

function unresolved(message) {
  const error = new Error(message);
  error.code = "gitlab_project_unresolved";
  return error;
}

function isKnownNonGitLabHost(hostname) {
  const host = hostname.toLowerCase();
  return (
    /(^|[.-])github([.-]|$)/.test(host) ||
    host === "bitbucket.org" ||
    /(^|[.-])bitbucket([.-]|$)/.test(host) ||
    host === "dev.azure.com" ||
    /(^|[.-])visualstudio([.-]|$)/.test(host)
  );
}

function decodeProjectPath(pathname) {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  let project;
  try {
    project = trimmed
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    throw unresolved("The GitLab project path is not valid URL encoding.");
  }

  const segments = project.split("/");
  if (
    segments.length < 2 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw unresolved("A GitLab project path must contain at least a group and project.");
  }
  return project;
}

function makeProject(protocol, host, project) {
  let parsedHost;
  try {
    parsedHost = new URL(`${protocol}//${host}`);
  } catch {
    throw unresolved("The GitLab host is invalid.");
  }
  if (
    !["http:", "https:"].includes(parsedHost.protocol) ||
    parsedHost.username ||
    parsedHost.password ||
    parsedHost.pathname !== "/" ||
    parsedHost.search ||
    parsedHost.hash
  ) {
    throw unresolved("The GitLab host must be an HTTP(S) hostname without a path.");
  }
  if (isKnownNonGitLabHost(parsedHost.hostname)) {
    throw unresolved(`The remote host ${parsedHost.hostname} is not a GitLab host.`);
  }

  const normalizedProject = decodeProjectPath(project);
  const baseUrl = `${parsedHost.protocol}//${parsedHost.host}`;
  const projectId = encodeURIComponent(normalizedProject);
  const encodedPath = normalizedProject
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return {
    baseUrl,
    host: parsedHost.host,
    project: normalizedProject,
    projectId,
    projectUrl: `${baseUrl}/${encodedPath}`,
  };
}

function parseRemoteParts(remoteUrl) {
  const value = String(remoteUrl ?? "").trim();
  if (!value) {
    throw unresolved("No GitLab origin remote is configured.");
  }

  const scp = value.match(/^(?:[^@/]+@)?(\[[^\]]+\]|[^/:]+):(.+)$/);
  if (scp && !/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    return {
      protocol: "https:",
      host: scp[1].replace(/^\[|\]$/g, ""),
      projectPath: scp[2],
    };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw unresolved("The origin remote URL is not supported.");
  }
  if (!["http:", "https:", "ssh:"].includes(parsed.protocol)) {
    throw unresolved("The origin remote must use HTTPS, HTTP, or SSH.");
  }
  if (parsed.protocol !== "ssh:" && (parsed.username || parsed.password)) {
    throw unresolved("The origin remote must not embed credentials.");
  }
  if (parsed.protocol === "ssh:" && isKnownNonGitLabHost(parsed.hostname)) {
    throw unresolved(`The remote host ${parsed.hostname} is not a GitLab host.`);
  }

  return {
    protocol: parsed.protocol === "http:" ? "http:" : "https:",
    host: parsed.host,
    projectPath: parsed.pathname,
  };
}

export async function getOriginRemote(cwd, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      "git",
      ["remote", "get-url", "origin"],
      { cwd, encoding: "utf8", shell: false, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(unresolved("Could not read the Git origin remote."));
          return;
        }
        const remote = String(stdout ?? "").trim();
        if (!remote) {
          reject(unresolved("The Git origin remote is empty."));
          return;
        }
        resolve(remote);
      },
    );
  });
}

export function parseGitRemote(remoteUrl) {
  const parts = parseRemoteParts(remoteUrl);
  return makeProject(parts.protocol, parts.host, parts.projectPath);
}

export function parseGitLabUrl(projectUrl) {
  let parsed;
  try {
    parsed = new URL(projectUrl);
  } catch {
    throw unresolved("The GitLab URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw unresolved("The GitLab URL must use HTTP(S) and must not contain credentials.");
  }
  if (isKnownNonGitLabHost(parsed.hostname)) {
    throw unresolved(`The URL host ${parsed.hostname} is not a GitLab host.`);
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const separator = segments.indexOf("-");
  let projectSegments;
  if (separator > 0) {
    projectSegments = segments.slice(0, separator);
  } else {
    const resourceIndex = segments.findIndex(
      (segment, index) =>
        ["issues", "merge_requests", "merge-requests"].includes(segment) &&
        /^\d+$/.test(segments[index + 1] ?? ""),
    );
    projectSegments =
      resourceIndex > 0 ? segments.slice(0, resourceIndex) : segments;
  }

  return makeProject(parsed.protocol, parsed.host, projectSegments.join("/"));
}

export function parseGitLabItemUrl(itemUrl) {
  let parsed;
  try {
    parsed = new URL(itemUrl);
  } catch {
    throw unresolved("The GitLab URL is invalid.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const separator = segments.indexOf("-");
  const resourceSegments = separator >= 0 ? segments.slice(separator + 1) : segments;
  const resourceIndex = resourceSegments.findIndex(
    (segment, index) =>
      ["issues", "merge_requests", "merge-requests"].includes(segment) &&
      /^\d+$/.test(resourceSegments[index + 1] ?? ""),
  );
  if (resourceIndex < 0) {
    return null;
  }
  const resource = resourceSegments[resourceIndex];
  return {
    view: resource === "issues" ? "issue_detail" : "mr_detail",
    iid: Number(resourceSegments[resourceIndex + 1]),
  };
}

export function resolveProject(input = {}, originRemote = "") {
  if (input.url) {
    return parseGitLabUrl(input.url);
  }
  if (input.host || input.project) {
    if (!input.host || !input.project) {
      throw unresolved("Specify both a GitLab host and project path.");
    }

    let protocol = "https:";
    let host = input.host;
    if (/^https?:\/\//i.test(host)) {
      let parsed;
      try {
        parsed = new URL(host);
      } catch {
        throw unresolved("The GitLab host is invalid.");
      }
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw unresolved("Specify a host, not a URL path, query, or fragment.");
      }
      protocol = parsed.protocol;
      host = parsed.host;
    }
    return makeProject(protocol, host, input.project);
  }
  if (!originRemote) {
    throw unresolved("Specify a GitLab project URL or configure an origin remote.");
  }
  return parseGitRemote(originRemote);
}
