// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClassBoard } from "@/features/classroom/live/useClassBoard";
import { buildBoardCheckpoint } from "@/features/classroom/checkpoint/codec";
import type { PendingBoardCheckpoint } from "@/features/classroom/checkpoint/types";
import type { SaveResult } from "@/features/classroom/checkpoint/sync";
import type { SessionEventLog } from "@/features/classroom/sync/eventlog";
import type { StrokeItem } from "@/features/whiteboard/types";

const storage = vi.hoisted(() => ({ pending: vi.fn(), journal: vi.fn(), flush: vi.fn(), fetch: vi.fn(), enqueue: vi.fn(), append: vi.fn(), prepare: vi.fn() }));
vi.mock("@/features/classroom/checkpoint/outbox", () => ({ getPendingBoardCheckpoint: storage.pending, enqueueLatestBoardCheckpoint: storage.enqueue }));
vi.mock("@/features/classroom/checkpoint/journal", async (original) => ({
  ...await original<typeof import("@/features/classroom/checkpoint/journal")>(), getBoardMutationJournal: storage.journal, appendBoardMutationJournal: storage.append,
}));
vi.mock("@/features/classroom/checkpoint/sync", () => ({ flushPendingBoardCheckpoint: storage.flush, fetchBoardCheckpoint: storage.fetch }));
vi.mock("@/features/classroom/checkpoint/preparer", () => ({ BoardCheckpointPreparer: class { prepare = storage.prepare; close() {} } }));

const stroke = (id: string): StrokeItem => ({ id, mode: "ink", color: "ink", wNorm: 0.004, points: [[0.1, 0.1], [0.2, 0.2]] });
const original = stroke("saved-stroke");
const recovered = stroke("pending-stroke");
const fresh = stroke("new-stroke");
const pending: PendingBoardCheckpoint = {
  ...buildBoardCheckpoint([recovered]), sessionId: "session", boardKey: "side", scope: "formal",
  checkpointId: "pending", writerId: "writer", writerSeq: 1, baseVersion: 0, sourceRevision: 1,
  preparedAt: "2026-10-05T00:00:00.000Z",
};
const log = {
  sessionId: "session", ephemeral: false, sendFx: vi.fn(), onFx: () => () => {}, subscribe: () => () => {},
} as unknown as SessionEventLog;
let root: Root;
let container: HTMLDivElement;
let board: ReturnType<typeof useClassBoard>;
let resolveSave: (value: SaveResult) => void;
let resolvePending: (value: PendingBoardCheckpoint) => void;

function Harness({ editable = false }: { editable?: boolean }) {
  const currentBoard = useClassBoard(log, "side", editable, [original], { checkpointV2Writer: editable });
  useEffect(() => { board = currentBoard; }, [currentBoard]);
  return null;
}

async function finishSave() {
  await act(async () => resolveSave({ accepted: true, status: "saved", version: 1 }));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  storage.pending.mockResolvedValue(pending);
  storage.journal.mockResolvedValue(undefined);
  storage.append.mockResolvedValue(1);
  storage.prepare.mockImplementation(async (items: StrokeItem[]) => buildBoardCheckpoint(items));
  storage.enqueue.mockImplementation(async (checkpoint: Omit<PendingBoardCheckpoint, "writerSeq">) => ({ ...checkpoint, writerSeq: 1 }));
  storage.flush.mockImplementation(() => new Promise<SaveResult>((resolve) => { resolveSave = resolve; }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("classroom pending checkpoint reconciliation", () => {
  it("recovers unchanged board contents after acknowledgement", async () => {
    await act(async () => root.render(createElement(Harness)));
    await finishSave();
    expect(board.store.getState().items).toEqual([recovered]);
    expect(board.checkpointStatus.state).toBe("saved");
  });

  it.each(["draw", "clear", "remote"] as const)("keeps a %s made while an older checkpoint is uploading", async (change) => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      if (change === "draw") board.store.getState().commitItem(fresh);
      else if (change === "clear") board.store.getState().clear();
      else board.store.getState().applyRemote({ t: "commit", item: fresh });
    });
    const beforeAcknowledgement = board.store.getState().items;
    await finishSave();
    expect(board.store.getState().items).toEqual(beforeAcknowledgement);
  });

  it("keeps local edits made before a retry reads an older pending snapshot", async () => {
    storage.pending.mockResolvedValueOnce(undefined);
    await act(async () => root.render(createElement(Harness)));
    board.store.getState().commitItem(fresh);
    await act(async () => window.dispatchEvent(new Event("online")));
    await finishSave();
    expect(board.store.getState().items).toEqual([original, fresh]);
  });

  it("does not start duplicate reads while a reconcile upload is pending", async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    expect(storage.pending).toHaveBeenCalledTimes(1);
    expect(storage.flush).toHaveBeenCalledTimes(1);
    await finishSave();
  });

  it("can recover on a later retry after an upload failure", async () => {
    storage.flush.mockRejectedValueOnce(new Error("offline"));
    await act(async () => root.render(createElement(Harness)));
    expect(board.checkpointStatus.state).toBe("error");
    await act(async () => window.dispatchEvent(new Event("online")));
    await finishSave();
    expect(board.store.getState().items).toEqual([recovered]);
    expect(board.checkpointStatus.state).toBe("saved");
    expect(storage.flush).toHaveBeenCalledTimes(2);
  });

  it("acknowledges the current writer's retried checkpoint without replacing its canvas", async () => {
    storage.pending.mockResolvedValueOnce(undefined);
    await act(async () => root.render(createElement(Harness, { editable: true })));
    await act(async () => board.store.getState().commitItem(fresh));
    storage.flush.mockRejectedValueOnce(new Error("offline"));
    await act(async () => board.flushCheckpoint());
    expect(board.checkpointStatus.state).toBe("error");
    const currentPending = storage.flush.mock.calls[0][0] as PendingBoardCheckpoint;
    const liveItems = board.store.getState().items;
    storage.pending.mockResolvedValue(currentPending);
    await act(async () => window.dispatchEvent(new Event("online")));
    await finishSave();
    expect(board.store.getState().items).toBe(liveItems);
    expect(board.checkpointStatus.state).toBe("saved");
  });

  it("keeps a remote operation that arrives while local recovery is still reading", async () => {
    storage.pending.mockImplementationOnce(() => new Promise<PendingBoardCheckpoint>((resolve) => { resolvePending = resolve; }));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => root.render(createElement(Harness)));
    board.store.getState().applyRemote({ t: "commit", item: fresh });
    await act(async () => resolvePending(pending));
    expect(board.store.getState().items).toEqual([original, fresh]);
    expect(storage.flush).not.toHaveBeenCalled();
  });

  it("does not mutate an unmounted board when its upload finishes", async () => {
    await act(async () => root.render(createElement(Harness)));
    const store = board.store;
    await act(async () => root.unmount());
    await finishSave();
    expect(store.getState().items).toEqual([original]);
    expect(log.sendFx).not.toHaveBeenCalled();
  });

  it("does not upload a checkpoint whose storage read completes after unmount", async () => {
    storage.pending.mockImplementation(() => new Promise<PendingBoardCheckpoint>((resolve) => { resolvePending = resolve; }));
    await act(async () => root.render(createElement(Harness)));
    await act(async () => root.unmount());
    await act(async () => resolvePending(pending));
    expect(storage.flush).not.toHaveBeenCalled();
  });
});
