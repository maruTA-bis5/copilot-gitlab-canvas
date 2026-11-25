# GitLab Canvas

GitLab Canvas is a project Copilot plugin that provides an extension canvas for
browsing and updating GitLab issues and merge requests. It includes a
GitLab-aware agent skill and uses the GitLab CLI (`glab`) when it is installed
and authenticated.

## What it includes

- One `gitlab` canvas with issue/MR list and detail views.
- Issue and MR filters, pagination, GFM descriptions, discussions, labels,
  assignees, and related items.
- MR pipeline and approval state, unified diffs, and inline review discussions.
- Comment/reply/resolve, close/reopen, label and assignee updates, and
  approve/unapprove actions. Merging is intentionally not exposed.
- A GitLab MCP fallback that lets the agent provide view data and execute
  requested operations through the official GitLab MCP server.
- Optional metadata and pipeline endpoints can fail independently without
  hiding the main issue or merge request; the canvas shows a warning when
  supplementary data could not be loaded.
- Japanese and English UI labels, plus automatic locale selection.

## Use

The extension is discovered from
`.github/extensions/gitlab-canvas/extension.mjs`. For direct API access, install
`glab` and authenticate it for the target host. The extension never reads or
stores GitLab credentials itself. If `glab` is not on `PATH`, it checks
`GLAB_PATH`, `GLAB_BIN`, and the standard per-user Windows install location
(`%LOCALAPPDATA%\Programs\glab\glab.exe`).

Open the canvas for the current GitLab project with the `gitlab` canvas ID, or
pass a project URL explicitly:

```js
open_canvas({
  canvasId: "gitlab",
  instanceId: "gitlab-project",
  input: {
    view: "mr_list",
    url: "https://gitlab.example.com/group/subgroup/project"
  }
});
```

If `glab` is unavailable, the agent can use the configured GitLab MCP server
and supply the initial view data in `input.data`. Subsequent refreshes and
actions are delegated through `session.send`; the agent returns the result to
the panel with the `set_view_data` action. The detailed agent procedure is in
[`skills/gitlab-canvas/SKILL.md`](skills/gitlab-canvas/SKILL.md).

## Development

The extension and its renderer use Node.js and browser standard APIs only; no
runtime npm dependencies or build step are required.

```powershell
npm test
```

The HTTP server binds to `127.0.0.1` on an ephemeral port. Each panel receives
its own random request token, and the token is sent in an HTTP header for API,
SSE, and upload requests.
