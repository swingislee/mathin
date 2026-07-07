"use client";

import { RotateCcw, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { deleteNoteForever, setNoteArchived } from "../actions";
import { useNotebookStore } from "../store";
import { useNotebookSync } from "./NotebookSync";

export function TrashPopover() {
  const t = useTranslations("notebook.workspace");
  const noteMap = useNotebookStore((state) => state.notes);
  const notes = Object.values(noteMap);
  const upsert = useNotebookStore((state) => state.upsert);
  const remove = useNotebookStore((state) => state.remove);
  const broadcast = useNotebookSync();
  const archived = notes.filter((note) => note.isArchived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  async function restore(id: string) {
    const updated = await setNoteArchived(id, false);
    upsert(updated);
    broadcast({ type: "meta", note: updated });
  }

  async function destroy(id: string) {
    if (!window.confirm(t("deleteConfirm"))) return;
    await deleteNoteForever(id);
    remove(id);
    broadcast({ type: "removed", id });
  }

  return (
    <details className="relative mx-3 mb-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--ws-panel-ink)]/70 hover:bg-[var(--ws-sheet)]/10">
        <Trash2 size={15} /> {t("trash")} {archived.length > 0 && <span className="ml-auto text-xs">{archived.length}</span>}
      </summary>
      <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(320px,80vw)] rounded-2xl border bg-card p-3 text-ink shadow-sm">
        <div className="mb-2 flex items-center justify-between"><strong className="text-sm">{t("trash")}</strong><X size={14} /></div>
        {archived.length === 0 ? <p className="py-4 text-center text-sm text-muted">{t("emptyTrash")}</p> : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {archived.map((note) => (
              <li key={note.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-paper">
                <span className="min-w-0 flex-1 truncate text-sm">{note.icon} {note.title || t("untitled")}</span>
                <button type="button" onClick={() => void restore(note.id)} aria-label={t("restore")} className="rounded-full p-1 hover:bg-moon/50"><RotateCcw size={14} /></button>
                <button type="button" onClick={() => void destroy(note.id)} aria-label={t("deleteForever")} className="rounded-full p-1 text-rose hover:bg-cheek/30"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
