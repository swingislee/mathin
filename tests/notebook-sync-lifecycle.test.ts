// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookSync } from "@/features/notebook/workspace/NotebookSync";
import { useNotebookStore } from "@/features/notebook/store";
import type { NoteMeta, NotebookEvent } from "@/features/notebook/types";

const remote = vi.hoisted(() => ({
  list: vi.fn(),
  channels: [] as Array<{ name: string; receive: (message: { payload: NotebookEvent }) => void }>,
}));
vi.mock("@/features/notebook/actions", () => ({ listNoteMetas: remote.list }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      const channel = {
        on: (_type: string, _filter: unknown, receive: (message: { payload: NotebookEvent }) => void) => {
          remote.channels.push({ name, receive });
          return channel;
        },
        subscribe: vi.fn(), send: vi.fn(),
      };
      return channel;
    },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    realtime: { setAuth: async () => {} },
    removeChannel: async () => {},
  }),
}));

const note = (id: string, title = id): NoteMeta => ({
  id, title, parentId: null, icon: null, isArchived: false, version: 1,
  createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
});
const initial = note("note-a");
let root: Root;
let container: HTMLDivElement;
let responses: Array<(notes: NoteMeta[]) => void>;
const render = (userId = "user-a") => {
  const props = { userId, children: null };
  return act(async () => root.render(createElement(NotebookSync, props)));
};
const focus = () => act(async () => window.dispatchEvent(new Event("focus")));
const respond = (index: number, notes: NoteMeta[]) => act(async () => responses[index](notes));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  remote.channels.length = 0;
  responses = [];
  remote.list.mockImplementation(() => new Promise<NoteMeta[]>((resolve) => responses.push(resolve)));
  useNotebookStore.setState({ notes: {}, saveStates: {}, hydratedFor: null });
  useNotebookStore.getState().hydrate("user-a", [initial]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("notebook focus refresh lifetime", () => {
  it("applies a normal refresh for the currently hydrated account", async () => {
    await render();
    await focus();
    const updated = note("note-a", "server title");
    await respond(0, [updated]);
    expect(useNotebookStore.getState().notes).toEqual({ "note-a": updated });
  });

  it.each(["rename", "create", "remove", "broadcast"] as const)("keeps a %s received while a refresh is pending", async (change) => {
    await render();
    await focus();
    await act(async () => {
      if (change === "rename") useNotebookStore.getState().patch(initial.id, { title: "new title" });
      if (change === "create") useNotebookStore.getState().upsert(note("new-note"));
      if (change === "remove") useNotebookStore.getState().remove(initial.id);
      if (change === "broadcast") remote.channels[0].receive({ payload: { type: "meta", note: note(initial.id, "remote title") } });
    });
    const currentNotes = useNotebookStore.getState().notes;
    await respond(0, [initial]);
    expect(useNotebookStore.getState().notes).toBe(currentNotes);
  });

  it.each([true, false])("only applies the latest overlapping request (latest first: %s)", async (latestFirst) => {
    await render();
    await focus();
    await focus();
    const latest = note("latest");
    if (latestFirst) {
      await respond(1, [latest]);
      await respond(0, [note("old")]);
    } else {
      await respond(0, [note("old")]);
      expect(useNotebookStore.getState().notes).toEqual({ "note-a": initial });
      await respond(1, [latest]);
    }
    expect(useNotebookStore.getState().notes).toEqual({ latest });
  });

  it("ignores an old account's refresh after switching accounts", async () => {
    await render();
    await focus();
    const nextAccount = note("note-b");
    await act(async () => useNotebookStore.getState().hydrate("user-b", [nextAccount]));
    await render("user-b");
    await respond(0, [initial]);
    expect(useNotebookStore.getState().notes).toEqual({ "note-b": nextAccount });
  });

  it("ignores a refresh when store hydration changes before component cleanup", async () => {
    await render();
    await focus();
    const nextAccount = note("note-b");
    await act(async () => useNotebookStore.getState().hydrate("user-b", [nextAccount]));
    await respond(0, [initial]);
    expect(useNotebookStore.getState().notes).toEqual({ "note-b": nextAccount });
  });

  it("ignores a refresh that finishes after unmount", async () => {
    await render();
    await focus();
    await act(async () => root.unmount());
    await respond(0, [note("late")]);
    expect(useNotebookStore.getState().notes).toEqual({ "note-a": initial });
  });

  it("ignores a retired account channel even if a queued broadcast arrives", async () => {
    await render();
    const oldChannel = remote.channels[0];
    const nextAccount = note("note-b");
    await act(async () => useNotebookStore.getState().hydrate("user-b", [nextAccount]));
    await render("user-b");
    await act(async () => oldChannel.receive({ payload: { type: "meta", note: initial } }));
    expect(useNotebookStore.getState().notes).toEqual({ "note-b": nextAccount });
  });

  it("does not request metadata before its account is hydrated", async () => {
    await render("user-b");
    await focus();
    expect(remote.list).not.toHaveBeenCalled();
  });

  it("clears save indicators on account change and preserves them on same-account hydration", () => {
    useNotebookStore.getState().setSaveState(initial.id, "conflict");
    useNotebookStore.getState().hydrate("user-a", [initial]);
    expect(useNotebookStore.getState().saveStates).toEqual({ "note-a": "conflict" });
    useNotebookStore.getState().hydrate("user-b", [note("note-b")]);
    expect(useNotebookStore.getState().saveStates).toEqual({});
  });
});
