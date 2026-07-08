"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { boardBus } from "./bus";
import { newStrokeId } from "./strokes";
import { useWhiteboardStore } from "./store";
import type { BoardOp, CursorPayload, PeerInfo, ProgressChunk, StrokeItem } from "./types";

const PROGRESS_INTERVAL_MS = 50;
const CURSOR_MIN_INTERVAL_MS = 90;
const SYNC_RES_CHUNK = 200;

/**
 * 白板 T2 传输层：wb:<id> 私有频道（RLS：读=成员、写=可编辑成员）。
 * 广播的坐标一律 0–1 归一化，各端按自己的画布尺寸重放 —— 不同分辨率
 * 同步一致性的硬约定，禁止在任何一层引入像素坐标（08-§3.2 坐标契约）。
 */
export function useBoardSync(boardId: string, canEdit: boolean, selfName: string) {
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const selfKeyRef = useRef(newStrokeId());

  useEffect(() => {
    const supabase = createClient();
    const store = useWhiteboardStore;
    let cancelled = false;

    // 私有频道必须先把用户 token 注入 Realtime，否则以 anon 身份鉴权被 RLS 拒
    // （auth.uid() 为空）。supabase-js 不保证在订阅前自动完成这件事。
    const channel = supabase.channel(`wb:${boardId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    const send = (event: string, payload: unknown) => {
      void channel.send({ type: "broadcast", event, payload });
    };

    // 长课/长会话：token 刷新后同步续期 Realtime 鉴权（08-§7）。
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) void supabase.realtime.setAuth(session.access_token);
    });

    channel
      .on("broadcast", { event: "op" }, ({ payload }) => {
        const op = payload as BoardOp;
        store.getState().applyRemote(op);
        if (op.t === "commit") {
          // 清掉对应的绘制中预览（若 progress 尾包晚于 commit 到达，items 判重兜底）
          boardBus.emit("remote-progress", { id: op.item.id, mode: op.item.mode, color: op.item.color, wNorm: op.item.wNorm, points: [], done: true });
        }
      })
      .on("broadcast", { event: "progress" }, ({ payload }) => {
        boardBus.emit("remote-progress", payload as ProgressChunk);
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        boardBus.emit("remote-cursor", payload as CursorPayload);
      })
      .on("broadcast", { event: "sync-req" }, () => {
        const items = store.getState().items;
        for (let start = 0; start < items.length; start += SYNC_RES_CHUNK) {
          send("sync-res", { items: items.slice(start, start + SYNC_RES_CHUNK) });
        }
      })
      .on("broadcast", { event: "sync-res" }, ({ payload }) => {
        store.getState().applyRemote({ t: "restore", items: (payload as { items: StrokeItem[] }).items });
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string }>();
        setPeers(Object.entries(state).map(([key, metas]) => ({ key, name: metas[0]?.name ?? "?" })));
      });

    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(session?.access_token ?? null);
      if (cancelled) return;
      channel.subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          void channel.track({ name: selfName });
          // 晚加入：向在线同伴要一次全量（快照可能落后于最近笔迹）
          send("sync-req", {});
        }
      });
    })();

    // 本地 op → 广播（只读成员没有本地 op；RLS 双保险拒写）
    const unsubscribeOutbox = store.subscribe((state, prev) => {
      if (state.outbox === prev.outbox || state.outbox.length === 0) return;
      for (const op of store.getState().drainOutbox()) send("op", op);
    });

    // 绘制中增量流：共享 stroke 对象引用，定时把新增点发出去
    let active: { stroke: StrokeItem; sent: number } | null = null;
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    const flushProgress = () => {
      if (!active) return;
      const { stroke } = active;
      if (stroke.points.length > active.sent) {
        send("progress", {
          id: stroke.id,
          mode: stroke.mode,
          color: stroke.color,
          wNorm: stroke.wNorm,
          points: stroke.points.slice(active.sent),
        } satisfies ProgressChunk);
        active.sent = stroke.points.length;
      }
    };
    const offStart = boardBus.on("local-progress-start", (stroke) => {
      if (!canEdit) return;
      active = { stroke, sent: 0 };
      flushProgress();
      progressTimer = setInterval(flushProgress, PROGRESS_INTERVAL_MS);
    });
    const offEnd = boardBus.on("local-progress-end", () => {
      flushProgress();
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = null;
      active = null;
    });

    // 协作光标（节流；只读成员被 RLS 拒写，客户端直接不发）
    let lastCursorAt = 0;
    const offCursor = boardBus.on("local-cursor", ({ x, y }) => {
      if (!canEdit) return;
      const now = Date.now();
      if (now - lastCursorAt < CURSOR_MIN_INTERVAL_MS) return;
      lastCursorAt = now;
      send("cursor", { key: selfKeyRef.current, name: selfName, x, y } satisfies CursorPayload);
    });

    return () => {
      cancelled = true;
      offStart();
      offEnd();
      offCursor();
      unsubscribeOutbox();
      authListener.subscription.unsubscribe();
      if (progressTimer) clearInterval(progressTimer);
      void supabase.removeChannel(channel);
    };
  }, [boardId, canEdit, selfName]);

  return { peers, connected };
}
