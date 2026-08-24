"use client";

import { useEffect, useRef, useState } from "react";
import { BoardBus } from "@/features/whiteboard/bus";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import { isStrokeItem, type BoardItem, type BoardOp, type ProgressChunk, type StrokeItem } from "@/features/whiteboard/types";
import { newId } from "@/lib/uuid";
import { getPendingBoardCheckpoint, enqueueLatestBoardCheckpoint } from "../checkpoint/outbox";
import { flattenCheckpointChunks } from "../checkpoint/parse";
import { BoardCheckpointPreparer } from "../checkpoint/preparer";
import { fetchBoardCheckpoint, flushPendingBoardCheckpoint } from "../checkpoint/sync";
import type { BoardCheckpointStatus, PendingBoardCheckpoint, SessionBoardCheckpoint } from "../checkpoint/types";
import type { SessionEventLog } from "../sync/eventlog";

const PROGRESS_INTERVAL_MS = 50;
const CURSOR_MIN_INTERVAL_MS = 90;
const SNAPSHOT_DEBOUNCE_MS = 2500;

function savedCheckpointStatus(checkpoint: SessionBoardCheckpoint): BoardCheckpointStatus {
  return {
    state: "saved",
    source: "server-v2",
    version: checkpoint.version,
    checkpointId: checkpoint.checkpointId,
    chunkCount: checkpoint.chunkCount,
    itemCount: checkpoint.itemCount,
    contentBytes: checkpoint.contentBytes,
    message: null,
  };
}

interface ClassBoardOptions {
  cursorName?: string;
  checkpointV2Writer?: boolean;
  initialCheckpoint?: SessionBoardCheckpoint;
  onCheckpointStatus?: (boardKey: string, status: BoardCheckpointStatus) => void;
}

/**
 * 课堂板书（08-§5）：复用白板画布组件，同步层换成课堂事件层——
 * 笔迹 op 与绘制中增量走 fx 短命通道（T0/T2 广播，可丢），
 * 最终状态由防抖 board_snapshot 持久事件收敛（进 outbox，离线自动回传）。
 * 主板书 boardKey = 页 uuid（按页隔离，临时插页也稳定）；副板书 boardKey = "side"（全课一块）。
 */
export function useClassBoard(
  log: SessionEventLog | null,
  boardKey: string,
  editable: boolean,
  initialItems: BoardItem[] | undefined,
  options: ClassBoardOptions = {},
) {
  const cursorName = options.cursorName ?? "";
  const checkpointV2Writer = options.checkpointV2Writer ?? false;
  const initialCheckpoint = options.initialCheckpoint;
  const onCheckpointStatus = options.onCheckpointStatus;
  const [store] = useState(createWhiteboardStore);
  const [bus] = useState(() => new BoardBus());
  const [preparer] = useState(() => new BoardCheckpointPreparer());
  const [checkpointStatus, setCheckpointStatus] = useState<BoardCheckpointStatus>(() => ({
    state: "idle",
    source: initialCheckpoint ? "server-v2" : initialItems?.length ? "legacy-v1" : "memory",
    version: initialCheckpoint?.version ?? null,
    checkpointId: initialCheckpoint?.checkpointId ?? null,
    chunkCount: initialCheckpoint?.chunkCount ?? 0,
    itemCount: initialCheckpoint?.itemCount ?? initialItems?.length ?? 0,
    contentBytes: initialCheckpoint?.contentBytes ?? 0,
    message: null,
  }));
  const hydrated = useRef(false);
  const baseVersionRef = useRef(initialCheckpoint?.version ?? 0);

  useEffect(() => {
    onCheckpointStatus?.(boardKey, checkpointStatus);
  }, [boardKey, checkpointStatus, onCheckpointStatus]);

  // 初始水合：晚加入/翻回本页时用重放出的最后一次快照（仅一次，之后以 op 流为准）
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (initialItems) store.getState().replaceItems(initialItems);
    // initialItems 仅首帧使用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Existing v2 outbox is part of the reader contract even when the new writer flag is off.
  useEffect(() => {
    if (!log) return;
    let disposed = false;
    const scope = log.ephemeral ? "rehearsal" as const : "formal" as const;
    const applyLocal = (pending: PendingBoardCheckpoint) => {
      const items = flattenCheckpointChunks(pending.chunks, pending.itemCount);
      store.getState().replaceItems(items);
      if (!disposed) {
        setCheckpointStatus({
          state: "pending",
          source: "local-v2",
          version: pending.writerSeq,
          checkpointId: pending.checkpointId,
          chunkCount: pending.chunks.length,
          itemCount: pending.itemCount,
          contentBytes: pending.contentBytes,
          message: null,
        });
      }
    };
    const reconcile = async () => {
      try {
        const pending = await getPendingBoardCheckpoint(log.sessionId, boardKey, scope);
        if (!pending) return;
        flattenCheckpointChunks(pending.chunks, pending.itemCount);
        if (scope === "rehearsal" || !navigator.onLine) {
          applyLocal(pending);
          return;
        }
        const result = await flushPendingBoardCheckpoint(pending);
        baseVersionRef.current = Math.max(baseVersionRef.current, result.version);
        if (result.accepted) {
          applyLocal(pending);
          if (!disposed) {
            setCheckpointStatus((current) => ({ ...current, state: "saved", source: "server-v2", version: result.version }));
          }
          log.sendFx({ scope: "board", payload: { key: boardKey, checkpoint: { version: result.version } } });
          return;
        }
        const server = await fetchBoardCheckpoint(log.sessionId, boardKey);
        if (result.status === "conflict") {
          if (server) baseVersionRef.current = Math.max(baseVersionRef.current, server.version);
          if (!disposed) {
            setCheckpointStatus({
              state: "error",
              source: "local-v2",
              version: pending.writerSeq,
              checkpointId: pending.checkpointId,
              chunkCount: pending.chunks.length,
              itemCount: pending.itemCount,
              contentBytes: pending.contentBytes,
              message: `CHECKPOINT_CONFLICT:${result.version}`,
            });
          }
          return;
        }
        if (!server) throw new Error("CHECKPOINT_SERVER_STATE_MISSING");
        if (store.getState().revision === 0) store.getState().replaceItems(server.items);
        if (!disposed) {
          setCheckpointStatus(savedCheckpointStatus(server));
        }
      } catch (error) {
        if (!disposed) {
          setCheckpointStatus((current) => ({
            ...current,
            state: "error",
            message: error instanceof Error ? error.message : "CHECKPOINT_SYNC_FAILED",
          }));
        }
      }
    };
    void reconcile();
    const retry = () => { void reconcile(); };
    const interval = scope === "formal" ? window.setInterval(retry, 15_000) : null;
    window.addEventListener("online", retry);
    return () => {
      disposed = true;
      if (interval !== null) window.clearInterval(interval);
      window.removeEventListener("online", retry);
    };
  }, [log, boardKey, store]);

  // op 流与绘制中增量：双向接 fx 通道
  useEffect(() => {
    if (!log) return;
    let disposed = false;

    const unsubOutbox = store.subscribe((state, prev) => {
      if (state.outbox === prev.outbox || state.outbox.length === 0) return;
      for (const op of store.getState().drainOutbox()) {
        log.sendFx({ scope: "board", payload: { key: boardKey, op } });
      }
    });

    let active: { stroke: StrokeItem; sent: number; seq: number } | null = null;
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    const flushProgress = () => {
      if (!active) return;
      const { stroke } = active;
      if (stroke.points.length > active.sent) {
        const chunk: ProgressChunk = {
          id: stroke.id,
          mode: stroke.mode,
          color: stroke.color,
          wNorm: stroke.wNorm,
          points: stroke.points.slice(active.sent),
          seq: active.seq,
        };
        log.sendFx({ scope: "board", payload: { key: boardKey, progress: chunk } });
        active.sent = stroke.points.length;
        active.seq += 1;
      }
    };
    const offStart = bus.on("local-progress-start", (stroke) => {
      if (!editable) return;
      active = { stroke, sent: 0, seq: 0 };
      flushProgress();
      progressTimer = setInterval(flushProgress, PROGRESS_INTERVAL_MS);
    });
    const offEnd = bus.on("local-progress-end", () => {
      flushProgress();
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = null;
      active = null;
    });

    const offFx = log.onFx((fx) => {
      if (fx.scope !== "board") return;
      const payload = fx.payload as {
        key?: unknown;
        op?: BoardOp;
        progress?: ProgressChunk;
        cursor?: { key: string; name: string; x: number; y: number };
        checkpoint?: { version: number };
      };
      if (payload.key !== boardKey) return;
      if (payload.op) {
        store.getState().applyRemote(payload.op);
        if (payload.op.t === "commit" && isStrokeItem(payload.op.item)) {
          const item = payload.op.item;
          bus.emit("remote-progress", { id: item.id, mode: item.mode, color: item.color, wNorm: item.wNorm, points: [], done: true });
        }
      } else if (payload.progress) {
        bus.emit("remote-progress", payload.progress);
      } else if (payload.cursor && payload.cursor.key !== log.deviceId) {
        bus.emit("remote-cursor", payload.cursor);
      } else if (payload.checkpoint && !editable) {
        const version = Number(payload.checkpoint.version);
        if (!Number.isSafeInteger(version) || version <= baseVersionRef.current) return;
        void fetchBoardCheckpoint(log.sessionId, boardKey).then((checkpoint) => {
          if (!checkpoint || disposed || checkpoint.version <= baseVersionRef.current) return;
          baseVersionRef.current = checkpoint.version;
          store.getState().replaceItems(checkpoint.items);
          setCheckpointStatus(savedCheckpointStatus(checkpoint));
        }).catch((error: unknown) => {
          if (!disposed) setCheckpointStatus((current) => ({
            ...current,
            state: "error",
            message: error instanceof Error ? error.message : "CHECKPOINT_READ_FAILED",
          }));
        });
      }
    });

    let lastCursorAt = 0;
    const offCursor = bus.on("local-cursor", ({ x, y }) => {
      if (!editable) return;
      const now = Date.now();
      if (now - lastCursorAt < CURSOR_MIN_INTERVAL_MS) return;
      lastCursorAt = now;
      log.sendFx({
        scope: "board",
        payload: { key: boardKey, cursor: { key: log.deviceId, name: cursorName, x, y } },
      });
    });

    // 教师的持久快照到达（含晚到的 T2 重放）：跟随端整块对齐兜底
    const offEv = log.subscribe((ev, local) => {
      if (local || editable || ev.type !== "board_snapshot" || baseVersionRef.current > 0) return;
      const payload = ev.payload as { pageKey?: unknown; items?: unknown };
      if (payload.pageKey !== boardKey || !Array.isArray(payload.items)) return;
      store.getState().replaceItems(payload.items as BoardItem[]);
    });

    return () => {
      disposed = true;
      flushProgress();
      unsubOutbox();
      offStart();
      offEnd();
      offFx();
      offEv();
      offCursor();
      if (progressTimer) clearInterval(progressTimer);
    };
  }, [log, boardKey, editable, store, bus, cursorName]);

  // Writer flag only chooses v1 append snapshots vs v2 latest checkpoints.
  useEffect(() => {
    if (!log || !editable) return;
    if (!checkpointV2Writer) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const snapshot = () => {
        timer = null;
        void log.append("board_snapshot", { pageKey: boardKey, items: store.getState().items });
      };
      const unsub = store.subscribe((state, prev) => {
        if (state.revision === prev.revision) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(snapshot, SNAPSHOT_DEBOUNCE_MS);
      });
      return () => {
        unsub();
        if (timer) {
          clearTimeout(timer);
          snapshot();
        }
      };
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latestTaskRevision = 0;
    let lastEnqueuedRevision = -1;
    const tasks = new Set<Promise<void>>();
    const persist = async () => {
      timer = null;
      const state = store.getState();
      if (state.revision === lastEnqueuedRevision) return;
      const sourceRevision = state.revision;
      latestTaskRevision = Math.max(latestTaskRevision, sourceRevision);
      if (!disposed) setCheckpointStatus((current) => ({ ...current, state: "preparing", message: null }));
      try {
        const prepared = await preparer.prepare(state.items);
        if (!prepared) return;
        const pending = await enqueueLatestBoardCheckpoint({
          ...prepared,
          scope: log.ephemeral ? "rehearsal" : "formal",
          checkpointId: newId(),
          sessionId: log.sessionId,
          boardKey,
          writerId: log.deviceId,
          baseVersion: baseVersionRef.current,
          sourceRevision,
          preparedAt: new Date().toISOString(),
        });
        lastEnqueuedRevision = sourceRevision;
        if (!disposed && sourceRevision === latestTaskRevision) {
          setCheckpointStatus({
            state: "pending",
            source: "local-v2",
            version: pending.writerSeq,
            checkpointId: pending.checkpointId,
            chunkCount: pending.chunks.length,
            itemCount: pending.itemCount,
            contentBytes: pending.contentBytes,
            message: null,
          });
        }
        if (log.ephemeral || !navigator.onLine) return;
        const result = await flushPendingBoardCheckpoint(pending);
        baseVersionRef.current = Math.max(baseVersionRef.current, result.version);
        if (result.accepted) {
          log.sendFx({ scope: "board", payload: { key: boardKey, checkpoint: { version: result.version } } });
          if (!disposed && sourceRevision === latestTaskRevision) {
            setCheckpointStatus({
              state: "saved",
              source: "server-v2",
              version: result.version,
              checkpointId: pending.checkpointId,
              chunkCount: pending.chunks.length,
              itemCount: pending.itemCount,
              contentBytes: pending.contentBytes,
              message: null,
            });
          }
          return;
        }
        const server = await fetchBoardCheckpoint(log.sessionId, boardKey);
        if (server) baseVersionRef.current = Math.max(baseVersionRef.current, server.version);
        if (disposed || sourceRevision !== latestTaskRevision) return;
        if (result.status === "stale") {
          if (!server) throw new Error("CHECKPOINT_SERVER_STATE_MISSING");
          setCheckpointStatus(savedCheckpointStatus(server));
          return;
        }
        setCheckpointStatus({
          state: "error",
          source: "local-v2",
          version: pending.writerSeq,
          checkpointId: pending.checkpointId,
          chunkCount: pending.chunks.length,
          itemCount: pending.itemCount,
          contentBytes: pending.contentBytes,
          message: `CHECKPOINT_CONFLICT:${result.version}`,
        });
      } catch (error) {
        if (!disposed && sourceRevision === latestTaskRevision) {
          setCheckpointStatus((current) => ({
            ...current,
            state: "error",
            message: error instanceof Error ? error.message : "CHECKPOINT_SAVE_FAILED",
          }));
        }
      }
    };
    const runPersist = () => {
      const task = persist();
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    };
    const unsub = store.subscribe((state, prev) => {
      if (state.revision === prev.revision) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(runPersist, SNAPSHOT_DEBOUNCE_MS);
    });
    return () => {
      disposed = true;
      unsub();
      if (timer) {
        clearTimeout(timer);
        runPersist();
      }
      void Promise.allSettled([...tasks]).then(() => preparer.close());
    };
  }, [log, boardKey, editable, store, checkpointV2Writer, preparer]);

  return { store, bus, checkpointStatus };
}
