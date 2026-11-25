export const canvasViews = [
  "issue_list",
  "issue_detail",
  "mr_list",
  "mr_detail",
];

const viewSet = new Set(canvasViews);
const stateValues = new Set(["opened", "closed", "merged", "all"]);

function navigationError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function normalizeFilters(filters = {}, previous = {}, view) {
  let state = stateValues.has(filters.state)
    ? filters.state
    : stateValues.has(previous.state)
      ? previous.state
      : "opened";
  if (view === "issue_list" && state === "merged") {
    state = "opened";
  }
  return {
    state,
    search: String(filters.search ?? previous.search ?? ""),
    labels: Array.isArray(filters.labels)
      ? filters.labels.map(String).filter(Boolean)
      : Array.isArray(previous.labels)
        ? previous.labels
        : [],
    assignee: String(filters.assignee ?? previous.assignee ?? ""),
    author: String(filters.author ?? previous.author ?? ""),
    page: Math.max(1, Number(filters.page ?? previous.page ?? 1) || 1),
  };
}

export async function prepareNavigationState(state, input = {}, loadData) {
  if (input.view && !viewSet.has(input.view)) {
    throw navigationError(
      "canvas_input_invalid",
      "The requested GitLab Canvas view is invalid.",
    );
  }
  const view = input.view ?? state.view;
  let iid = state.iid == null ? null : Number(state.iid);
  if (input.iid !== undefined) {
    iid = Number(input.iid);
    if (!Number.isInteger(iid) || iid < 1) {
      throw navigationError(
        "gitlab_item_unresolved",
        "A positive issue or merge request IID is required.",
      );
    }
  } else if (view.endsWith("_list")) {
    iid = null;
  }
  if (
    (view === "issue_detail" || view === "mr_detail") &&
    (!Number.isInteger(iid) || iid < 1)
  ) {
    throw navigationError(
      "gitlab_item_unresolved",
      "A positive issue or merge request IID is required.",
    );
  }

  const nextState = {
    ...state,
    view,
    iid,
    filters: normalizeFilters(input.filters ?? {}, state.filters, view),
    data: null,
    error: null,
    pending: false,
    warnings: [],
  };
  if (!loadData) {
    return nextState;
  }
  const loaded = await loadData(nextState);
  return {
    ...nextState,
    data: loaded.data,
    warnings: loaded.warnings,
  };
}
