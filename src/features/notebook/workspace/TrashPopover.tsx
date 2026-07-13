"use client";

import { RotateCcw, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { deleteNoteForever, setNoteArchived } from "../actions";
import { useNotebookStore } from "../store";
import { useNotebookSync } from "./NotebookSync";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function TrashPopover() {
  const t = useTranslations("notebook.workspace");
  const router = useRouter();
  const params = useParams<{ noteId?: string }>();
  const activeId = params.noteId ?? null;
  const noteMap = useNotebookStore((state) => state.notes);
  const notes = Object.values(noteMap);
  const upsert = useNotebookStore((state) => state.upsert);
  const remove = useNotebookStore((state) => state.remove);
  const broadcast = useNotebookSync();
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId,setPendingDeleteId]=useState<string|null>(null);
  const archived = notes.filter((note) => note.isArchived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  async function restore(id: string) {
    try {
      const updated = await setNoteArchived(id, false);
      updated.forEach((meta) => {
        upsert(meta);
        broadcast({ type: "meta", note: meta });
      });
      setError(null);
      // 正在预览这篇（或其子孙）时刷新，让只读横幅退场、编辑器解锁。
      if (activeId && updated.some((meta) => meta.id === activeId)) router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function destroy(id: string) {
    setPendingDeleteId(null);
    try {
      const { removedIds } = await deleteNoteForever(id);
      remove(id);
      broadcast({ type: "removed", id });
      setError(null);
      // 被删除的正是打开中的笔记（或其子孙）时回到工作区首页。
      if (activeId && removedIds.includes(activeId)) router.push("/notebook/me");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <details className="relative mx-3 mb-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--ws-panel-ink)]/70 hover:bg-[var(--ws-sheet)]/10">
        <Trash2 size={15} /> {t("trash")} {archived.length > 0 && <span className="ml-auto text-xs">{archived.length}</span>}
      </summary>
      <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(320px,80vw)] rounded-2xl border bg-card p-3 text-ink shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <strong className="text-sm">{t("trash")}</strong>
          <button type="button" aria-label={t("closeTrash")} onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")} className="rounded-full p-1 hover:bg-paper"><X size={14} /></button>
        </div>
        {error && <p className="mb-2 rounded-xl bg-cheek/25 px-3 py-2 text-xs text-rose-deep">{t("actionFailed", { message: error })}</p>}
        {archived.length === 0 ? <p className="py-4 text-center text-sm text-muted">{t("emptyTrash")}</p> : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {archived.map((note) => (
              <li key={note.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-paper">
                <Link href={`/notebook/me/${note.id}`} title={t("preview")} className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline">{note.icon} {note.title || t("untitled")}</Link>
                <button type="button" onClick={() => void restore(note.id)} aria-label={t("restore")} className="rounded-full p-1 hover:bg-moon/50"><RotateCcw size={14} /></button>
                <button type="button" onClick={() => setPendingDeleteId(note.id)} aria-label={t("deleteForever")} className="rounded-full p-1 text-rose hover:bg-cheek/30"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog open={pendingDeleteId!==null} onOpenChange={(open)=>{if(!open)setPendingDeleteId(null)}} title={t("deleteForever")} description={t("deleteConfirm")} confirmLabel={t("deleteForever")} cancelLabel={t("cancel")} onConfirm={()=>{if(pendingDeleteId)void destroy(pendingDeleteId)}}/>
    </details>
  );
}
