"use client";

import { create, type StateCreator } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { BoardOp, ColorToken, StrokeItem, Tool } from "./types";

/** 撤销条目只记录本人操作的逆操作（08-§3.2：不做全局历史）。 */
type UndoEntry =
  | { kind: "draw"; id: string }
  | { kind: "eraseLine"; item: StrokeItem; index: number }
  | { kind: "clear"; items: StrokeItem[] };

export type SaveState = "saved" | "saving" | "error";

interface WhiteboardState {
  boardId: string | null;
  items: StrokeItem[];
  /** 本地内容变更 +1；savedRevision 落后即为脏。远端 op 不计（远端由绘制者负责落盘）。 */
  revision: number;
  savedRevision: number;
  saveState: SaveState;
  tool: Tool;
  color: ColorToken;
  sizeNorm: number;
  undoStack: UndoEntry[];
  /** 待广播的本地 op；useBoardSync 经 drainOutbox 取走发送。 */
  outbox: BoardOp[];
  hydrate: (boardId: string, items: StrokeItem[]) => void;
  setTool: (tool: Tool) => void;
  setColor: (color: ColorToken) => void;
  setSizeNorm: (sizeNorm: number) => void;
  commitItem: (item: StrokeItem) => void;
  eraseLine: (id: string) => void;
  clear: () => void;
  undo: () => void;
  /** 应用远端 op：不进撤销栈、不置脏（八股见 08-§3.2）。 */
  applyRemote: (op: BoardOp) => void;
  /** 整体替换（课堂快照对齐用）：不进撤销栈、不置脏、不广播。 */
  replaceItems: (items: StrokeItem[]) => void;
  drainOutbox: () => BoardOp[];
  setSaveState: (saveState: SaveState) => void;
  markSaved: (revision: number) => void;
}

export const SIZE_PRESETS = { thin: 0.003, medium: 0.006, thick: 0.012 } as const;

function appendMissing(items: StrokeItem[], incoming: StrokeItem[]): StrokeItem[] {
  const known = new Set(items.map((item) => item.id));
  const fresh = incoming.filter((item) => !known.has(item.id));
  return fresh.length ? [...items, ...fresh] : items;
}

const stateCreator: StateCreator<WhiteboardState> = (set, get) => ({
  boardId: null,
  items: [],
  revision: 0,
  savedRevision: 0,
  saveState: "saved",
  tool: "pen",
  color: "ink",
  sizeNorm: SIZE_PRESETS.medium,
  undoStack: [],
  outbox: [],
  hydrate: (boardId, items) => set((state) =>
    state.boardId === boardId
      ? state
      : { boardId, items, revision: 0, savedRevision: 0, saveState: "saved", undoStack: [], outbox: [] },
  ),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setSizeNorm: (sizeNorm) => set({ sizeNorm }),
  commitItem: (item) => set((state) => ({
    items: [...state.items, item],
    revision: state.revision + 1,
    undoStack: [...state.undoStack, { kind: "draw", id: item.id }],
    outbox: [...state.outbox, { t: "commit", item }],
  })),
  eraseLine: (id) => set((state) => {
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) return state;
    const item = state.items[index];
    return {
      items: state.items.filter((existing) => existing.id !== id),
      revision: state.revision + 1,
      undoStack: [...state.undoStack, { kind: "eraseLine", item, index }],
      outbox: [...state.outbox, { t: "erase", id }],
    };
  }),
  clear: () => set((state) => state.items.length === 0 ? state : ({
    items: [],
    revision: state.revision + 1,
    undoStack: [...state.undoStack, { kind: "clear", items: state.items }],
    outbox: [...state.outbox, { t: "clear" }],
  })),
  undo: () => set((state) => {
    const entry = state.undoStack[state.undoStack.length - 1];
    if (!entry) return state;
    const undoStack = state.undoStack.slice(0, -1);
    if (entry.kind === "draw") {
      return {
        items: state.items.filter((item) => item.id !== entry.id),
        revision: state.revision + 1,
        undoStack,
        outbox: [...state.outbox, { t: "erase", id: entry.id }],
      };
    }
    if (entry.kind === "eraseLine") {
      const items = [...state.items];
      items.splice(Math.min(entry.index, items.length), 0, entry.item);
      return {
        items,
        revision: state.revision + 1,
        undoStack,
        outbox: [...state.outbox, { t: "restore", items: [entry.item] }],
      };
    }
    return {
      items: entry.items,
      revision: state.revision + 1,
      undoStack,
      outbox: [...state.outbox, { t: "restore", items: entry.items }],
    };
  }),
  replaceItems: (items) => set({ items }),
  applyRemote: (op) => set((state) => {
    if (op.t === "commit") {
      return state.items.some((item) => item.id === op.item.id)
        ? state
        : { items: [...state.items, op.item] };
    }
    if (op.t === "erase") {
      return state.items.some((item) => item.id === op.id)
        ? { items: state.items.filter((item) => item.id !== op.id) }
        : state;
    }
    if (op.t === "clear") {
      return state.items.length ? { items: [] } : state;
    }
    const items = appendMissing(state.items, op.items);
    return items === state.items ? state : { items };
  }),
  drainOutbox: () => {
    const ops = get().outbox;
    if (ops.length) set({ outbox: [] });
    return ops;
  },
  setSaveState: (saveState) => set({ saveState }),
  markSaved: (revision) => set({ savedRevision: revision, saveState: "saved" }),
});

/** 独立白板用的全局单例（一页只有一块板）。 */
export const useWhiteboardStore = create<WhiteboardState>(stateCreator);

export type WhiteboardStore = StoreApi<WhiteboardState>;

/** 课堂用工厂：主/副板书同屏各持一个实例（08-§5 上课页板书）。 */
export function createWhiteboardStore(): WhiteboardStore {
  return createStore<WhiteboardState>(stateCreator);
}
