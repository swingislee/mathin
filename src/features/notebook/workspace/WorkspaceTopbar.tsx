"use client";

import { AlertCircle, Check, Copy, Globe2, LoaderCircle, Menu, Palette, PanelLeftClose, Unlink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { getPublishStatus, publishNote, unpublishNote } from "../actions";
import type { WorkspaceTone } from "../types";
import { useNotebookStore } from "../store";

export function WorkspaceTopbar({ activeId, tone, onToneChange, onMenu }: {
  activeId: string | null;
  tone: WorkspaceTone;
  onToneChange: (tone: WorkspaceTone) => void;
  onMenu: () => void;
}) {
  const t = useTranslations("notebook.workspace");
  const locale = useLocale();
  const note = useNotebookStore((state) => activeId ? state.notes[activeId] : undefined);
  const saveState = useNotebookStore((state) => activeId ? state.saveStates[activeId] : undefined);
  const [postId, setPostId] = useState<string | null>(null);
  const [publishing, startPublishing] = useTransition();
  useEffect(() => {
    let cancelled = false;
    if (!activeId) return;
    void getPublishStatus(activeId).then((id) => { if (!cancelled) setPostId(id); });
    return () => { cancelled = true; };
  }, [activeId]);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4 text-[var(--ws-panel-ink)]">
      <button type="button" onClick={onMenu} aria-label={t("openSidebar")} className="rounded-full p-2 hover:bg-[var(--ws-sheet)]/10 lg:hidden"><Menu size={18} /></button>
      <PanelLeftClose size={17} className="hidden opacity-50 lg:block" />
      <div className="min-w-0 flex-1 truncate text-sm font-medium">
        {note ? <><span className="mr-2">{note.icon}</span>{note.title || t("untitled")}</> : t("workspaceName")}
      </div>
      {activeId && saveState && (
        <span className={`hidden items-center gap-1 text-xs sm:inline-flex ${saveState === "error" || saveState === "conflict" ? "text-rose" : "text-[var(--ws-panel-ink)]/65"}`}>
          {saveState === "saving" ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" /> : saveState === "saved" ? <Check size={13} /> : <AlertCircle size={13} />}
          {t(`save.${saveState}`)}
        </span>
      )}
      {activeId && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={publishing || saveState === "saving"}
            onClick={() => startPublishing(async () => setPostId((await publishNote(activeId)).postId))}
            aria-label={postId ? t("updatePublish") : t("publish")}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--ws-panel-ink)]/25 p-2 text-xs hover:bg-[var(--ws-sheet)]/10 disabled:opacity-50 sm:px-3 sm:py-1.5"
          ><Globe2 size={13} /><span className="hidden sm:inline">{postId ? t("updatePublish") : t("publish")}</span></button>
          {postId && <>
            <button type="button" aria-label={t("copyPublicLink")} onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/${locale}/notebook/${postId}`)} className="rounded-full p-2 hover:bg-[var(--ws-sheet)]/10"><Copy size={13} /></button>
            <button type="button" aria-label={t("unpublish")} onClick={() => startPublishing(async () => { await unpublishNote(activeId); setPostId(null); })} className="rounded-full p-2 hover:bg-[var(--ws-sheet)]/10"><Unlink size={13} /></button>
          </>}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs">
        <Palette size={15} />
        <span className="sr-only">{t("tone")}</span>
        <select
          value={tone}
          onChange={(event) => onToneChange(event.target.value as WorkspaceTone)}
          className="rounded-full border border-[var(--ws-panel-ink)]/25 bg-transparent px-2 py-1 text-[var(--ws-panel-ink)] outline-none"
        >
          {(["night", "leaf", "rose", "crater"] as const).map((value) => <option key={value} value={value} className="bg-paper text-ink">{t(`tones.${value}`)}</option>)}
        </select>
      </label>
    </header>
  );
}
