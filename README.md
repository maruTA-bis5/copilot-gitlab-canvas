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

## Install (Copilot App)

Identifiers used below:
- Marketplace: `copilot-gitlab-canvas`
- Plugin / extension directory: `gitlab-canvas`
- Canvas ID: `gitlab`

> **Note**: Currently, installing the plugin alone only installs the agent
> skill (`skills/gitlab-canvas/SKILL.md`), not the canvas extension under
> `.github/extensions/gitlab-canvas/`. Follow both steps below when using the
> extension from another repository.

### 1. Install the canvas extension

If you open this repository directly in Copilot App,
`.github/extensions/gitlab-canvas/extension.mjs` is discovered automatically—do
not run `install_extension` (especially with `project` scope) on this repository
itself.

To use the canvas in other repositories, ask Copilot App to run
`install_extension` with:

- **URL**: `https://github.com/maruTA-bis5/copilot-gitlab-canvas/tree/main/.github/extensions/gitlab-canvas`
- **Name**: `gitlab-canvas`
- **Scope**: `user` (recommended; available across all repositories) or `project` (writes into the target repository's `.github/extensions/gitlab-canvas/`)

`install_extension` automatically reloads extensions after installation. If the
`gitlab` canvas still does not appear, ask the agent to run `extensions_reload`.
Because `user` scope installs a snapshot of `tree/main`, re-run
`install_extension` when updating to a newer version.

### 2. Install the agent skill (optional, recommended)

To install the `gitlab-canvas` skill in Copilot App:

- **In Copilot App UI**: Open **Customize**, add `maruTA-bis5/copilot-gitlab-canvas`
  as a plugin marketplace, and install `gitlab-canvas`.
- **Using Copilot CLI** (when `copilot` is on `PATH` and shares configuration
  with Copilot App):

  ```sh
  copilot plugin marketplace add maruTA-bis5/copilot-gitlab-canvas
  copilot plugin install gitlab-canvas@copilot-gitlab-canvas
  ```

After installing, proceed to [Use](#use) to set up `glab` authentication (or
use the GitLab MCP fallback).

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

CI runs the same commands on Linux and Windows:

```sh
npm test
npm run check
```

The HTTP server binds to `127.0.0.1` on an ephemeral port. Each panel receives
its own random request token, and the token is sent in an HTTP header for API,
SSE, and upload requests.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
