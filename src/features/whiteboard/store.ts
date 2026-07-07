"use client";

import { create } from "zustand";
import type { ColorToken, StrokeItem, Tool } from "./types";

/** 撤销条目只记录本人操作的逆操作（08-§3.2：不做全局历史）。 */
type UndoEntry =
  | { kind: "draw"; id: string }
  | { kind: "eraseLine"; item: StrokeItem; index: number }
  | { kind: "clear"; items: StrokeItem[] };

export type SaveState = "saved" | "saving" | "error";

interface WhiteboardState {
  boardId: string | null;
  items: StrokeItem[];
  /** 每次内容变更 +1；savedRevision 落后即为脏，保存管线据此防抖。 */
  revision: number;
  savedRevision: number;
  saveState: SaveState;
  tool: Tool;
  color: ColorToken;
  sizeNorm: number;
  undoStack: UndoEntry[];
  hydrate: (boardId: string, items: StrokeItem[]) => void;
  setTool: (tool: Tool) => void;
  setColor: (color: ColorToken) => void;
  setSizeNorm: (sizeNorm: number) => void;
  commitItem: (item: StrokeItem) => void;
  eraseLine: (id: string) => void;
  clear: () => void;
  undo: () => void;
  setSaveState: (saveState: SaveState) => void;
  markSaved: (revision: number) => void;
}

export const SIZE_PRESETS = { thin: 0.003, medium: 0.006, thick: 0.012 } as const;

export const useWhiteboardStore = create<WhiteboardState>((set) => ({
  boardId: null,
  items: [],
  revision: 0,
  savedRevision: 0,
  saveState: "saved",
  tool: "pen",
  color: "ink",
  sizeNorm: SIZE_PRESETS.medium,
  undoStack: [],
  hydrate: (boardId, items) => set((state) =>
    state.boardId === boardId
      ? state
      : { boardId, items, revision: 0, savedRevision: 0, saveState: "saved", undoStack: [] },
  ),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setSizeNorm: (sizeNorm) => set({ sizeNorm }),
  commitItem: (item) => set((state) => ({
    items: [...state.items, item],
    revision: state.revision + 1,
    undoStack: item.mode === "ink" || item.mode === "erase"
      ? [...state.undoStack, { kind: "draw", id: item.id }]
      : state.undoStack,
  })),
  eraseLine: (id) => set((state) => {
    const index = state.items.findIndex((item) => item.id === id);
    if (index < 0) return state;
    const item = state.items[index];
    return {
      items: state.items.filter((existing) => existing.id !== id),
      revision: state.revision + 1,
      undoStack: [...state.undoStack, { kind: "eraseLine", item, index }],
    };
  }),
  clear: () => set((state) => state.items.length === 0 ? state : ({
    items: [],
    revision: state.revision + 1,
    undoStack: [...state.undoStack, { kind: "clear", items: state.items }],
  })),
  undo: () => set((state) => {
    const entry = state.undoStack[state.undoStack.length - 1];
    if (!entry) return state;
    const undoStack = state.undoStack.slice(0, -1);
    if (entry.kind === "draw") {
      return { items: state.items.filter((item) => item.id !== entry.id), revision: state.revision + 1, undoStack };
    }
    if (entry.kind === "eraseLine") {
      const items = [...state.items];
      items.splice(Math.min(entry.index, items.length), 0, entry.item);
      return { items, revision: state.revision + 1, undoStack };
    }
    return { items: entry.items, revision: state.revision + 1, undoStack };
  }),
  setSaveState: (saveState) => set({ saveState }),
  markSaved: (revision) => set({ savedRevision: revision, saveState: "saved" }),
}));
