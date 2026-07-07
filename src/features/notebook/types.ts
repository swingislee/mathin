export interface NoteMeta {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  isArchived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteRecord extends NoteMeta {
  document: unknown[] | null;
}

export type WorkspaceTone = "night" | "leaf" | "rose" | "crater";

export type NotebookEvent =
  | { type: "meta"; note: NoteMeta }
  | { type: "removed"; id: string }
  | { type: "doc"; id: string; version: number };
