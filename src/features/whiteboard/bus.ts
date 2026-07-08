"use client";

import type { CursorPayload, ProgressChunk, StrokeItem } from "./types";

/**
 * 画布 ↔ 同步层的进程内事件总线：CanvasSurface 只发/收本地事件，
 * 传输层（P4-2 Realtime；P4 课堂换事件层）在 useBoardSync 挂接，二者互不引用。
 */
interface BusEvents {
  "local-progress-start": StrokeItem;
  "local-progress-end": { id: string };
  "local-cursor": { x: number; y: number };
  "remote-progress": ProgressChunk;
  "remote-cursor": CursorPayload;
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

class BoardBus {
  private listeners = new Map<keyof BusEvents, Set<Handler<never>>>();

  on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    this.listeners.set(event, set);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    this.listeners.get(event)?.forEach((handler) => (handler as Handler<K>)(payload));
  }
}

export const boardBus = new BoardBus();
