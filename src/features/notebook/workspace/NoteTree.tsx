"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { createNote } from "../actions";
import { useNotebookStore } from "../store";
import { useNotebookSync } from "./NotebookSync";
import { TreeItemConnected } from "./TreeItem";

export function NoteTree({ activeId, onNavigate }: { activeId: string | null; onNavigate: () => void }) {
  const t = useTranslations("notebook.workspace");
  const noteMap = useNotebookStore((state) => state.notes);
  const notes = Object.values(noteMap);
  const upsert = useNotebookStore((state) => state.upsert);
  const broadcast = useNotebookSync();
  const roots = notes.filter((note) => !note.isArchived && note.parentId === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  async function addRoot() {
    const created = await createNote(null, t("untitled"));
    upsert(created);
    broadcast({ type: "meta", note: created });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--ws-panel-ink)]/60">{t("myNotes")}</span>
        <button type="button" onClick={() => void addRoot()} aria-label={t("newNote")} className="rounded-full p-1 text-[var(--ws-panel-ink)] hover:bg-[var(--ws-sheet)]/10"><Plus size={16} /></button>
      </div>
      {roots.length ? (
        <ul>{roots.map((note) => <TreeItemConnected key={note.id} note={note} activeId={activeId} depth={0} onNavigate={onNavigate} />)}</ul>
      ) : (
        <button type="button" onClick={() => void addRoot()} className="w-full rounded-xl border border-dashed border-[var(--ws-panel-ink)]/25 px-3 py-5 text-sm text-[var(--ws-panel-ink)]/65">{t("emptyNotes")}</button>
      )}
    </div>
  );
}
