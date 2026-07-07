"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { renameWhiteboard, saveSnapshot } from "./actions";
import { CanvasSurface } from "./CanvasSurface";
import { Toolbar } from "./Toolbar";
import { useWhiteboardStore } from "./store";
import type { WhiteboardRecord } from "./types";

const SAVE_DEBOUNCE_MS = 1500;
const SAVE_INTERVAL_MS = 30_000;
const RENAME_DEBOUNCE_MS = 800;

export function BoardClient({ board }: { board: WhiteboardRecord }) {
  const t = useTranslations("whiteboard.board");
  const [title, setTitle] = useState(board.title);
  const saveState = useWhiteboardStore((state) => state.saveState);
  const revision = useWhiteboardStore((state) => state.revision);
  const savingRef = useRef(false);
  const renameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    useWhiteboardStore.getState().hydrate(board.id, board.snapshot);
  }, [board.id, board.snapshot]);

  /* 快照保存：防抖 + 定时兜底 + 页面隐藏即时（08-§3.2 持久化纪律）。 */
  const flush = useCallback(async () => {
    const state = useWhiteboardStore.getState();
    if (state.boardId !== board.id || savingRef.current) return;
    if (state.revision === state.savedRevision) return;
    savingRef.current = true;
    const revisionAtStart = state.revision;
    state.setSaveState("saving");
    try {
      await saveSnapshot(board.id, state.items);
      useWhiteboardStore.getState().markSaved(revisionAtStart);
    } catch {
      useWhiteboardStore.getState().setSaveState("error");
    } finally {
      savingRef.current = false;
      const latest = useWhiteboardStore.getState();
      // 保存期间又有新改动：立即续一轮，避免停在脏状态等 30s 兜底。
      if (latest.saveState !== "error" && latest.revision !== latest.savedRevision) void flush();
    }
  }, [board.id]);

  useEffect(() => {
    if (!board.canEdit) return;
    const state = useWhiteboardStore.getState();
    if (state.revision === state.savedRevision) return;
    const timer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [revision, board.canEdit, flush]);

  useEffect(() => {
    if (!board.canEdit) return;
    const interval = setInterval(() => void flush(), SAVE_INTERVAL_MS);
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
      void flush();
    };
  }, [board.canEdit, flush]);

  const onTitleChange = (value: string) => {
    setTitle(value);
    if (renameTimer.current) clearTimeout(renameTimer.current);
    renameTimer.current = setTimeout(() => {
      renameWhiteboard(board.id, value).catch(() => {});
    }, RENAME_DEBOUNCE_MS);
  };

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-4">
        <Link href="/whiteboard" aria-label={t("back")} className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink">
          <ArrowLeft size={18} />
        </Link>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={t("titlePlaceholder")}
          aria-label={t("titlePlaceholder")}
          disabled={!board.canEdit}
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted"
        />
        {!board.canEdit && (
          <span className="shrink-0 rounded-full bg-line/60 px-2.5 py-1 text-xs text-muted">{t("readOnly")}</span>
        )}
        <span
          role="status"
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-xs",
            saveState === "error" ? "text-rose" : "text-muted",
          )}
        >
          {saveState === "saving"
            ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" />
            : saveState === "saved"
              ? <Check size={13} />
              : <AlertCircle size={13} />}
          <span className="hidden sm:inline">{t(`save.${saveState}`)}</span>
        </span>
      </header>
      <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 md:p-5">
        <div
          className="relative max-h-full w-full rounded-2xl border border-line shadow-sm"
          style={{ width: "min(100%, calc((100dvh - 8.5rem) * 16 / 9))", aspectRatio: "16 / 9" }}
        >
          <CanvasSurface editable={board.canEdit} />
        </div>
        {board.canEdit && (
          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 md:bottom-6">
            <Toolbar title={title} />
          </div>
        )}
      </main>
    </div>
  );
}
