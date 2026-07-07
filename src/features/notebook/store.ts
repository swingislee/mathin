"use client";

import { create } from "zustand";
import type { NoteMeta } from "./types";

interface NotebookState {
  notes: Record<string, NoteMeta>;
  saveStates: Record<string, "saved" | "saving" | "error" | "conflict">;
  hydratedFor: string | null;
  hydrate: (userId: string, notes: NoteMeta[]) => void;
  replaceAll: (notes: NoteMeta[]) => void;
  upsert: (note: NoteMeta) => void;
  patch: (id: string, patch: Partial<NoteMeta>) => void;
  remove: (id: string) => void;
  setSaveState: (id: string, status: "saved" | "saving" | "error" | "conflict") => void;
}

function byId(notes: NoteMeta[]) {
  return Object.fromEntries(notes.map((note) => [note.id, note]));
}

export const useNotebookStore = create<NotebookState>((set) => ({
  notes: {},
  saveStates: {},
  hydratedFor: null,
  hydrate: (userId, notes) => set((state) =>
    state.hydratedFor === userId ? state : { notes: byId(notes), hydratedFor: userId },
  ),
  replaceAll: (notes) => set({ notes: byId(notes) }),
  upsert: (note) => set((state) => ({ notes: { ...state.notes, [note.id]: note } })),
  patch: (id, patch) => set((state) => {
    const current = state.notes[id];
    return current ? { notes: { ...state.notes, [id]: { ...current, ...patch } } } : state;
  }),
  remove: (id) => set((state) => {
    const notes = { ...state.notes };
    const pending = [id];
    while (pending.length) {
      const current = pending.pop();
      if (!current) continue;
      delete notes[current];
      Object.values(notes).forEach((note) => {
        if (note.parentId === current) pending.push(note.id);
      });
    }
    return { notes };
  }),
  setSaveState: (id, status) => set((state) => ({ saveStates: { ...state.saveStates, [id]: status } })),
}));

export function selectNotes(state: NotebookState) {
  return Object.values(state.notes);
}
