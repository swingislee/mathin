"use client";

import { create, type StateCreator } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { newId } from "@/lib/uuid";
import { cloneBoardItem } from "./geometry";
import {
  isShapeItem,
  isStrokeItem,
  type BoardItem,
  type BoardOp,
  type ColorToken,
  type FormulaItem,
  type InstrumentItem,
  type InstrumentKind,
  type ShapeItem,
  type ShapeKind,
  type Tool,
} from "./types";

/** 撤销只记录本次本地动作的逆操作，不回滚协作者的并发增量。 */
type UndoEntry =
  | { kind: "erase"; ids: string[] }
  | { kind: "restore"; items: BoardItem[]; indexes: number[] }
  | { kind: "replace"; items: BoardItem[] }
  | { kind: "group"; removeIds: string[]; restore: BoardItem[]; indexes: number[] };

export type SaveState = "saved" | "saving" | "error";

interface WhiteboardState {
  boardId: string | null;
  items: BoardItem[];
  /** 本地内容变更 +1；savedRevision 落后即为脏。远端 op 不计（远端由绘制者负责落盘）。 */
  revision: number;
  savedRevision: number;
  saveState: SaveState;
  tool: Tool;
  color: ColorToken;
  fill: ColorToken | null;
  sizeNorm: number;
  shapeKind: ShapeKind;
  selectedIds: string[];
  instruments: InstrumentItem[];
  undoStack: UndoEntry[];
  /** 待广播的本地 op；useBoardSync 经 drainOutbox 取走发送。 */
  outbox: BoardOp[];
  hydrate: (boardId: string, items: BoardItem[]) => void;
  setTool: (tool: Tool) => void;
  setColor: (color: ColorToken) => void;
  setFill: (fill: ColorToken | null) => void;
  setSizeNorm: (sizeNorm: number) => void;
  setShapeKind: (shapeKind: ShapeKind) => void;
  setSelectedIds: (ids: string[]) => void;
  commitItem: (item: BoardItem) => void;
  updateItem: (item: BoardItem) => void;
  eraseLine: (id: string) => void;
  removeItems: (ids: string[]) => void;
  duplicateSelected: () => void;
  styleSelected: (style: { color?: ColorToken; fill?: ColorToken | null }) => void;
  replaceItemsWithFormula: (ids: string[], formula: FormulaItem) => void;
  clear: () => void;
  undo: () => void;
  /** 应用远端 op：不进撤销栈、不置脏（八股见 08-§3.2）。 */
  applyRemote: (op: BoardOp) => void;
  /** 整体替换（课堂快照对齐用）：不进撤销栈、不置脏、不广播。 */
  replaceItems: (items: BoardItem[]) => void;
  addInstrument: (kind: InstrumentKind) => void;
  updateInstrument: (item: InstrumentItem) => void;
  removeInstrument: (id: string) => void;
  drainOutbox: () => BoardOp[];
  setSaveState: (saveState: SaveState) => void;
  markSaved: (revision: number) => void;
}

export const SIZE_PRESETS = { thin: 0.003, medium: 0.006, thick: 0.012 } as const;

function appendMissing(items: BoardItem[], incoming: BoardItem[]): BoardItem[] {
  const known = new Set(items.map((item) => item.id));
  const fresh = incoming.filter((item) => !known.has(item.id));
  return fresh.length ? [...items, ...fresh] : items;
}

function restoreAt(items: BoardItem[], restored: BoardItem[], indexes: number[]): BoardItem[] {
  const next = [...items];
  restored.forEach((item, position) => {
    if (next.some((existing) => existing.id === item.id)) return;
    next.splice(Math.min(indexes[position] ?? next.length, next.length), 0, item);
  });
  return next;
}

function defaultInstrument(kind: InstrumentKind): InstrumentItem {
  if (kind === "compass") {
    return { id: newId(), kind, x: 0.5, y: 0.5, width: 0.24, height: 0.3, rotation: 0, radius: 0.12, armAngle: -25 };
  }
  if (kind === "protractor") {
    return { id: newId(), kind, x: 0.5, y: 0.55, width: 0.34, height: 0.18, rotation: 0 };
  }
  return { id: newId(), kind, x: 0.5, y: 0.55, width: 0.46, height: 0.1, rotation: 0 };
}

const stateCreator: StateCreator<WhiteboardState> = (set, get) => ({
  boardId: null,
  items: [],
  revision: 0,
  savedRevision: 0,
  saveState: "saved",
  tool: "pen",
  color: "ink",
  fill: null,
  sizeNorm: SIZE_PRESETS.medium,
  shapeKind: "rectangle",
  selectedIds: [],
  instruments: [],
  undoStack: [],
  outbox: [],
  hydrate: (boardId, items) => set((state) =>
    state.boardId === boardId
      ? state
      : {
          boardId,
          items,
          revision: 0,
          savedRevision: 0,
          saveState: "saved",
          selectedIds: [],
          instruments: [],
          undoStack: [],
          outbox: [],
        },
  ),
  setTool: (tool) => set({ tool, selectedIds: tool === "pointer" ? get().selectedIds : [] }),
  setColor: (color) => set({ color }),
  setFill: (fill) => set({ fill }),
  setSizeNorm: (sizeNorm) => set({ sizeNorm }),
  setShapeKind: (shapeKind) => set({ shapeKind, tool: "shape", selectedIds: [] }),
  setSelectedIds: (selectedIds) => set({ selectedIds }),
  commitItem: (item) => set((state) => ({
    items: [...state.items, item],
    revision: state.revision + 1,
    selectedIds: isStrokeItem(item) ? state.selectedIds : [item.id],
    undoStack: [...state.undoStack, { kind: "erase", ids: [item.id] }],
    outbox: [...state.outbox, { t: "commit", item }],
  })),
  updateItem: (item) => set((state) => {
    const index = state.items.findIndex((existing) => existing.id === item.id);
    if (index < 0) return state;
    const previous = state.items[index];
    const items = [...state.items];
    items[index] = item;
    return {
      items,
      revision: state.revision + 1,
      undoStack: [...state.undoStack, { kind: "replace", items: [previous] }],
      outbox: [...state.outbox, { t: "replace", item }],
    };
  }),
  eraseLine: (id) => get().removeItems([id]),
  removeItems: (ids) => set((state) => {
    const idSet = new Set(ids);
    const restored: BoardItem[] = [];
    const indexes: number[] = [];
    state.items.forEach((item, index) => {
      if (idSet.has(item.id)) {
        restored.push(item);
        indexes.push(index);
      }
    });
    if (restored.length === 0) return state;
    return {
      items: state.items.filter((item) => !idSet.has(item.id)),
      revision: state.revision + 1,
      selectedIds: state.selectedIds.filter((id) => !idSet.has(id)),
      undoStack: [...state.undoStack, { kind: "restore", items: restored, indexes }],
      outbox: [...state.outbox, ...restored.map((item): BoardOp => ({ t: "erase", id: item.id }))],
    };
  }),
  duplicateSelected: () => set((state) => {
    const selected = new Set(state.selectedIds);
    const copies = state.items.filter((item) => selected.has(item.id)).map((item) => cloneBoardItem(item, newId()));
    if (copies.length === 0) return state;
    return {
      items: [...state.items, ...copies],
      revision: state.revision + 1,
      selectedIds: copies.map((item) => item.id),
      undoStack: [...state.undoStack, { kind: "erase", ids: copies.map((item) => item.id) }],
      outbox: [...state.outbox, ...copies.map((item): BoardOp => ({ t: "commit", item }))],
    };
  }),
  styleSelected: (style) => set((state) => {
    const selected = new Set(state.selectedIds);
    const previous: BoardItem[] = [];
    const replacements: BoardItem[] = [];
    const items = state.items.map((item) => {
      if (!selected.has(item.id)) return item;
      previous.push(item);
      if (isStrokeItem(item)) {
        const replacement = style.color ? { ...item, color: style.color } : item;
        replacements.push(replacement);
        return replacement;
      }
      if (isShapeItem(item)) {
        const replacement: ShapeItem = {
          ...item,
          ...(style.color ? { color: style.color } : {}),
          ...(style.fill !== undefined ? { fill: style.fill } : {}),
        };
        replacements.push(replacement);
        return replacement;
      }
      const replacement = style.color ? { ...item, color: style.color } : item;
      replacements.push(replacement);
      return replacement;
    });
    if (previous.length === 0) return state;
    return {
      items,
      revision: state.revision + 1,
      undoStack: [...state.undoStack, { kind: "replace", items: previous }],
      outbox: [...state.outbox, ...replacements.map((item): BoardOp => ({ t: "replace", item }))],
    };
  }),
  replaceItemsWithFormula: (ids, formula) => set((state) => {
    const idSet = new Set(ids);
    const restored: BoardItem[] = [];
    const indexes: number[] = [];
    state.items.forEach((item, index) => {
      if (idSet.has(item.id)) {
        restored.push(item);
        indexes.push(index);
      }
    });
    if (restored.length === 0) return state;
    return {
      items: [...state.items.filter((item) => !idSet.has(item.id)), formula],
      revision: state.revision + 1,
      tool: "pointer",
      selectedIds: [formula.id],
      undoStack: [...state.undoStack, { kind: "group", removeIds: [formula.id], restore: restored, indexes }],
      outbox: [
        ...state.outbox,
        ...restored.map((item): BoardOp => ({ t: "erase", id: item.id })),
        { t: "commit", item: formula },
      ],
    };
  }),
  clear: () => set((state) => state.items.length === 0 ? state : ({
    items: [],
    revision: state.revision + 1,
    selectedIds: [],
    undoStack: [...state.undoStack, {
      kind: "restore",
      items: state.items,
      indexes: state.items.map((_, index) => index),
    }],
    outbox: [...state.outbox, { t: "clear" }],
  })),
  undo: () => set((state) => {
    const entry = state.undoStack[state.undoStack.length - 1];
    if (!entry) return state;
    const undoStack = state.undoStack.slice(0, -1);
    if (entry.kind === "erase") {
      const ids = new Set(entry.ids);
      return {
        items: state.items.filter((item) => !ids.has(item.id)),
        revision: state.revision + 1,
        selectedIds: [],
        undoStack,
        outbox: [...state.outbox, ...entry.ids.map((id): BoardOp => ({ t: "erase", id }))],
      };
    }
    if (entry.kind === "restore") {
      return {
        items: restoreAt(state.items, entry.items, entry.indexes),
        revision: state.revision + 1,
        undoStack,
        outbox: [...state.outbox, { t: "restore", items: entry.items }],
      };
    }
    if (entry.kind === "replace") {
      const previousById = new Map(entry.items.map((item) => [item.id, item]));
      return {
        items: state.items.map((item) => previousById.get(item.id) ?? item),
        revision: state.revision + 1,
        undoStack,
        outbox: [...state.outbox, ...entry.items.map((item): BoardOp => ({ t: "replace", item }))],
      };
    }
    const removeIds = new Set(entry.removeIds);
    return {
      items: restoreAt(state.items.filter((item) => !removeIds.has(item.id)), entry.restore, entry.indexes),
      revision: state.revision + 1,
      selectedIds: [],
      undoStack,
      outbox: [
        ...state.outbox,
        ...entry.removeIds.map((id): BoardOp => ({ t: "erase", id })),
        { t: "restore", items: entry.restore },
      ],
    };
  }),
  replaceItems: (items) => set({ items, selectedIds: [] }),
  applyRemote: (op) => set((state) => {
    if (op.t === "commit") {
      return state.items.some((item) => item.id === op.item.id)
        ? state
        : { items: [...state.items, op.item] };
    }
    if (op.t === "replace") {
      return state.items.some((item) => item.id === op.item.id)
        ? { items: state.items.map((item) => item.id === op.item.id ? op.item : item) }
        : { items: [...state.items, op.item] };
    }
    if (op.t === "erase") {
      return state.items.some((item) => item.id === op.id)
        ? { items: state.items.filter((item) => item.id !== op.id) }
        : state;
    }
    if (op.t === "clear") {
      return state.items.length ? { items: [], selectedIds: [] } : state;
    }
    const items = appendMissing(state.items, op.items);
    return items === state.items ? state : { items };
  }),
  addInstrument: (kind) => set((state) => ({ instruments: [...state.instruments, defaultInstrument(kind)] })),
  updateInstrument: (item) => set((state) => ({
    instruments: state.instruments.map((existing) => existing.id === item.id ? item : existing),
  })),
  removeInstrument: (id) => set((state) => ({ instruments: state.instruments.filter((item) => item.id !== id) })),
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
