"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { deleteNoteForever, setNoteArchived } from "../actions";
import { useNotebookStore } from "../store";
import { useNotebookSync } from "./NotebookSync";

/** 回收站笔记预览页顶部的醒目提示条：只读说明 + 恢复 / 彻底删除。 */
export function ArchivedBanner({ noteId }: { noteId: string }) {
  const t = useTranslations("notebook.workspace");
  const router = useRouter();
  const upsert = useNotebookStore((state) => state.upsert);
  const remove = useNotebookStore((state) => state.remove);
  const broadcast = useNotebookSync();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const restore = () => startTransition(async () => {
    try {
      const updated = await setNoteArchived(noteId, false);
      updated.forEach((meta) => {
        upsert(meta);
        broadcast({ type: "meta", note: meta });
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  });

  const destroy = () => {
    if (!window.confirm(t("deleteConfirm"))) return;
    startTransition(async () => {
      try {
        await deleteNoteForever(noteId);
        remove(noteId);
        broadcast({ type: "removed", id: noteId });
        router.push("/notebook/me");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  return (
    <div className="sticky top-0 z-20 bg-rose px-6 py-3 text-sm text-[var(--paper)] md:px-10">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
        <span className="flex-1 font-medium">{t("archivedBanner")}</span>
        <button type="button" disabled={pending} onClick={restore} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--paper)]/60 px-3 py-1.5 hover:bg-[var(--paper)]/15 disabled:opacity-50"><RotateCcw size={13} />{t("restore")}</button>
        <button type="button" disabled={pending} onClick={destroy} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--paper)] px-3 py-1.5 text-rose-deep hover:opacity-90 disabled:opacity-50"><Trash2 size={13} />{t("deleteForever")}</button>
        {error && <p className="w-full text-xs text-[var(--paper)]/90">{t("actionFailed", { message: error })}</p>}
      </div>
    </div>
  );
}
