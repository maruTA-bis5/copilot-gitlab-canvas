import assert from "node:assert/strict";
import test from "node:test";
import { prepareNavigationState } from "../.github/extensions/gitlab-canvas/lib/panel-navigation.mjs";

const initialState = {
  view: "issue_list",
  iid: null,
  filters: { state: "opened", labels: [] },
  data: { items: [{ iid: 1 }] },
  error: null,
  pending: false,
};

test("rejects invalid detail navigation without modifying the current state", async () => {
  const state = structuredClone(initialState);

  await assert.rejects(
    prepareNavigationState(state, { view: "issue_detail" }),
    { code: "gitlab_item_unresolved" },
  );
  assert.deepEqual(state, initialState);
});

test("keeps the existing state intact when loading the requested view fails", async () => {
  const state = structuredClone(initialState);

  await assert.rejects(
    prepareNavigationState(
      state,
      { view: "mr_detail", iid: 8 },
      async () => {
        throw new Error("request failed");
      },
    ),
    /request failed/,
  );
  assert.deepEqual(state, initialState);
});

test("returns a loaded state only after the requested data succeeds", async () => {
  const next = await prepareNavigationState(
    initialState,
    { view: "mr_detail", iid: 8, filters: { page: 2 } },
    async (state) => ({
      data: { mergeRequest: { iid: state.iid } },
      warnings: [],
    }),
  );

  assert.equal(next.view, "mr_detail");
  assert.equal(next.iid, 8);
  assert.equal(next.filters.page, 2);
  assert.deepEqual(next.data, { mergeRequest: { iid: 8 } });
  assert.deepEqual(initialState.data, { items: [{ iid: 1 }] });
});
