"use client";

import { useEffect, useRef, useState } from "react";
import { BoardBus } from "@/features/whiteboard/bus";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import type { BoardOp, ProgressChunk, StrokeItem } from "@/features/whiteboard/types";
import type { SessionEventLog } from "../sync/eventlog";

const PROGRESS_INTERVAL_MS = 50;
const SNAPSHOT_DEBOUNCE_MS = 2500;

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
  initialItems: StrokeItem[] | undefined,
) {
  const [store] = useState(createWhiteboardStore);
  const [bus] = useState(() => new BoardBus());
  const hydrated = useRef(false);

  // 初始水合：晚加入/翻回本页时用重放出的最后一次快照（仅一次，之后以 op 流为准）
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (initialItems?.length) store.getState().replaceItems(initialItems);
    // initialItems 仅首帧使用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // op 流与绘制中增量：双向接 fx 通道
  useEffect(() => {
    if (!log) return;

    const unsubOutbox = store.subscribe((state, prev) => {
      if (state.outbox === prev.outbox || state.outbox.length === 0) return;
      for (const op of store.getState().drainOutbox()) {
        log.sendFx({ scope: "board", payload: { key: boardKey, op } });
      }
    });

    let active: { stroke: StrokeItem; sent: number } | null = null;
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
        };
        log.sendFx({ scope: "board", payload: { key: boardKey, progress: chunk } });
        active.sent = stroke.points.length;
      }
    };
    const offStart = bus.on("local-progress-start", (stroke) => {
      if (!editable) return;
      active = { stroke, sent: 0 };
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
      const payload = fx.payload as { key?: unknown; op?: BoardOp; progress?: ProgressChunk };
      if (payload.key !== boardKey) return;
      if (payload.op) {
        store.getState().applyRemote(payload.op);
        if (payload.op.t === "commit") {
          const item = payload.op.item;
          bus.emit("remote-progress", { id: item.id, mode: item.mode, color: item.color, wNorm: item.wNorm, points: [], done: true });
        }
      } else if (payload.progress) {
        bus.emit("remote-progress", payload.progress);
      }
    });

    // 教师的持久快照到达（含晚到的 T2 重放）：跟随端整块对齐兜底
    const offEv = log.subscribe((ev, local) => {
      if (local || editable || ev.type !== "board_snapshot") return;
      const payload = ev.payload as { pageKey?: unknown; items?: unknown };
      if (payload.pageKey !== boardKey || !Array.isArray(payload.items)) return;
      store.getState().replaceItems(payload.items as StrokeItem[]);
    });

    return () => {
      unsubOutbox();
      offStart();
      offEnd();
      offFx();
      offEv();
      if (progressTimer) clearInterval(progressTimer);
    };
  }, [log, boardKey, editable, store, bus]);

  // 快照持久化（仅书写端）：防抖落 board_snapshot；翻页卸载时立即补一发，不丢尾巴
  useEffect(() => {
    if (!log || !editable) return;
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
  }, [log, boardKey, editable, store]);

  return { store, bus };
}
