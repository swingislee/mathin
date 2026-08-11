"use client";

import { AlertCircle, Check, Copy, Globe2, LoaderCircle, Menu, Palette, PanelLeftClose, Unlink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  getPublicPublishingEnabled,
  getPublishStatus,
  submitNoteForReview,
  withdrawNotebookPostAction,
  type NotebookPublicationActionCode,
  type NotebookPublicationStatus,
} from "../actions";
import { SearchCommand } from "./SearchCommand";
import type { WorkspaceTone } from "../types";
import { useNotebookStore } from "../store";

type PublicationFeedback =
  | { kind: "success"; key: "submitted" | "withdrawn" }
  | { kind: "error"; code: NotebookPublicationActionCode };

type LoadedPublication = {
  noteId: string;
  enabled: boolean;
  status: NotebookPublicationStatus | null;
};

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
  const [loadedPublication, setLoadedPublication] = useState<LoadedPublication | null>(null);
  const [loadedFeedback, setLoadedFeedback] = useState<{ noteId: string; value: PublicationFeedback } | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishing, startPublishing] = useTransition();

  const publicationState = loadedPublication?.noteId === activeId ? loadedPublication : null;
  const publication = publicationState?.status ?? null;
  const publishEnabled = publicationState?.enabled ?? false;
  const feedback = loadedFeedback?.noteId === activeId ? loadedFeedback.value : null;

  useEffect(() => {
    let cancelled = false;
    if (!activeId) return;
    const refreshPublication = () => {
      void Promise.all([getPublishStatus(activeId), getPublicPublishingEnabled()])
        .then(([status, enabled]) => {
          if (cancelled) return;
          setLoadedPublication({ noteId: activeId, enabled, status });
        })
        .catch(() => {
          if (!cancelled) setLoadedFeedback({ noteId: activeId, value: { kind: "error", code: "SERVER" } });
        });
    };
    refreshPublication();
    window.addEventListener("focus", refreshPublication);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshPublication);
    };
  }, [activeId]);

  const publicLinkAvailable = publication?.lifecycleStatus === "published"
    && publication.reviewStatus === "approved"
    && publication.moderationStatus === "active";
  const awaitingReview = publication?.lifecycleStatus === "review";
  const moderationLocked = publication?.moderationStatus === "hidden";
  const submitLabel = publication?.lifecycleStatus === "published"
    ? "submitRevision"
    : publication
      ? "resubmitForReview"
      : "submitForReview";

  const submit = () => {
    if (!activeId) return;
    startPublishing(async () => {
      const result = await submitNoteForReview(activeId);
      if (result.ok) {
        setLoadedPublication({ noteId: activeId, enabled: publishEnabled, status: result.data });
        setLoadedFeedback({ noteId: activeId, value: { kind: "success", key: "submitted" } });
      } else {
        setLoadedFeedback({ noteId: activeId, value: { kind: "error", code: result.code } });
      }
    });
  };

  const withdraw = () => {
    if (!activeId || !publication) return;
    startPublishing(async () => {
      const result = await withdrawNotebookPostAction(publication.postId);
      if (result.ok) {
        setLoadedPublication({ noteId: activeId, enabled: publishEnabled, status: result.data });
        setLoadedFeedback({ noteId: activeId, value: { kind: "success", key: "withdrawn" } });
      } else {
        setLoadedFeedback({ noteId: activeId, value: { kind: "error", code: result.code } });
      }
    });
  };

  return (
    <header className="flex min-h-14 shrink-0 items-center gap-3 px-4 text-[var(--ws-panel-ink)]">
      <button type="button" onClick={onMenu} aria-label={t("openSidebar")} className="rounded-full p-2 hover:bg-[var(--ws-sheet)]/10 lg:hidden"><Menu size={18} /></button>
      <PanelLeftClose size={17} className="hidden opacity-50 lg:block" />
      <div className="min-w-0 flex-1 truncate text-sm font-medium">
        {note ? <><span className="mr-2">{note.icon}</span>{note.title || t("untitled")}</> : t("workspaceName")}
      </div>
      {note?.isArchived && <Badge variant="danger">{t("inTrash")}</Badge>}
      {activeId && !note?.isArchived && saveState && (
        <span
          aria-live="polite"
          className={`inline-flex items-center gap-1 text-xs ${saveState === "error" || saveState === "conflict" ? "text-rose" : "text-[var(--ws-panel-ink)]/65"}`}
        >
          {saveState === "saving" ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" /> : saveState === "saved" ? <Check size={13} /> : <AlertCircle size={13} />}
          <span className="hidden sm:inline">{t(`save.${saveState}`)}</span>
        </span>
      )}
      {publication && <Badge variant={publication.lifecycleStatus === "published" && !moderationLocked ? "secondary" : "outline"}>{t(`publicationStatus.${moderationLocked ? "moderationHidden" : publication.lifecycleStatus}`)}</Badge>}
      {feedback && (
        <span
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`max-w-52 text-xs ${feedback.kind === "error" ? "text-rose" : "text-leaf"}`}
        >
          {feedback.kind === "error" ? t(`publicationErrors.${feedback.code}`) : t(`publicationSuccess.${feedback.key}`)}
        </span>
      )}
      <SearchCommand />
      {activeId && !note?.isArchived && (
        <div className="flex items-center gap-1">
          {!awaitingReview && !moderationLocked && (
            <button
              type="button"
              disabled={publishing || saveState === "saving" || !publishEnabled}
              onClick={submit}
              aria-label={t(submitLabel)}
              title={!publishEnabled ? t("publishDisabled") : undefined}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--ws-panel-ink)]/25 p-2 text-xs hover:bg-[var(--ws-sheet)]/10 disabled:opacity-50 sm:px-3 sm:py-1.5"
            >
              {publishing ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" /> : <Globe2 size={13} />}
              <span className="hidden sm:inline">{t(submitLabel)}</span>
            </button>
          )}
          {publicLinkAvailable && publication && <>
            <button
              type="button"
              aria-label={copied ? t("copied") : t("copyPublicLink")}
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/${locale}/notebook/${publication.postId}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-full p-2 hover:bg-[var(--ws-sheet)]/10"
            >{copied ? <Check size={13} className="text-leaf" /> : <Copy size={13} />}</button>
            <button type="button" aria-label={t("withdraw")} disabled={publishing} onClick={withdraw} className="rounded-full p-2 hover:bg-[var(--ws-sheet)]/10 disabled:opacity-50"><Unlink size={13} /></button>
          </>}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs">
        <Palette size={15} />
        <span className="sr-only">{t("tone")}</span>
        <select
          value={tone}
          onChange={(event) => onToneChange(event.target.value as WorkspaceTone)}
          className="rounded-full border border-[var(--ws-panel-ink)]/25 bg-transparent px-2 py-1 text-[var(--ws-panel-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ws-panel-ink)]"
        >
          {(["night", "leaf", "rose", "crater"] as const).map((value) => <option key={value} value={value} className="bg-paper text-ink">{t(`tones.${value}`)}</option>)}
        </select>
      </label>
    </header>
  );
}
