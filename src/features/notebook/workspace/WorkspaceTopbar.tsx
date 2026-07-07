"use client";

import { AlertCircle, Check, LoaderCircle, Menu, Palette, PanelLeftClose } from "lucide-react";
import { useTranslations } from "next-intl";
import type { WorkspaceTone } from "../types";
import { useNotebookStore } from "../store";

export function WorkspaceTopbar({ activeId, tone, onToneChange, onMenu }: {
  activeId: string | null;
  tone: WorkspaceTone;
  onToneChange: (tone: WorkspaceTone) => void;
  onMenu: () => void;
}) {
  const t = useTranslations("notebook.workspace");
  const note = useNotebookStore((state) => activeId ? state.notes[activeId] : undefined);
  const saveState = useNotebookStore((state) => activeId ? state.saveStates[activeId] : undefined);
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
