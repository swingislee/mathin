"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  Dices,
  Film,
  Gamepad2,
  Image as ImageIcon,
  LoaderCircle,
  PenLine,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { games } from "@/features/games/registry";
import type { Difficulty } from "@/features/games/types";
import { newId } from "@/lib/uuid";
import { updateLectureTemplate } from "./actions";
import type { CoursewareTemplatePage } from "./courseware-overlay";
import { templateAssetKind, uploadTemplateAsset } from "./courseware-template-upload";

type SaveState = "saved" | "saving" | "dirty" | "error";

const PAGE_ICONS = { image: ImageIcon, video: Film, game: Gamepad2, board: PenLine } as const;

export function CoursewareTemplateEditor({
  courseId,
  lectureId,
  initialPages,
}: {
  courseId: string;
  lectureId: string;
  initialPages: CoursewareTemplatePage[];
}) {
  const t = useTranslations("school.courseware");
  const tGames = useTranslations("games");
  const [pages, setPages] = useState<CoursewareTemplatePage[]>(initialPages);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [uploading, setUploading] = useState(false);
  const [gameDialog, setGameDialog] = useState(false);
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [seed, setSeed] = useState(() => newId().slice(0, 8));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const persist = useCallback(async () => {
    setSaveState("saving");
    try {
      await updateLectureTemplate(lectureId, pagesRef.current);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [lectureId]);

  const mutate = useCallback((updater: (prev: CoursewareTemplatePage[]) => CoursewareTemplatePage[]) => {
    setPages(updater);
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 1200);
  }, [persist]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const kind = templateAssetKind(file);
        if (!kind) continue;
        const path = await uploadTemplateAsset(courseId, file);
        const title = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
        mutate((prev) => [...prev, { id: newId(), type: kind, path, title }]);
      }
    } catch {
      setSaveState("error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const move = (index: number, delta: number) => {
    mutate((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveLabel = {
    saved: t("saved"),
    saving: t("saving"),
    dirty: t("unsaved"),
    error: t("saveFailed"),
  }[saveState];

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-muted">{t("templateTitle", { count: pages.length })}</h3>
        <span className={`text-xs ${saveState === "error" ? "text-rose" : "text-muted"}`}>{saveLabel}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(event) => void addFiles(event.target.files)}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink disabled:opacity-50"
          >
            {uploading ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Plus size={14} />}
            {t("addMedia")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSeed(newId().slice(0, 8));
              setGameDialog(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink"
          >
            <Gamepad2 size={14} />
            {t("addGame")}
          </button>
          <button
            type="button"
            onClick={() => mutate((prev) => [...prev, { id: newId(), type: "board", title: t("boardPageTitle") }])}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink"
          >
            <PenLine size={14} />
            {t("addBoard")}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">{t("templateHint")}</p>

      {pages.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
          {t("empty")}
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {pages.map((page, index) => {
            const Icon = PAGE_ICONS[page.type];
            return (
              <li key={page.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-6 shrink-0 text-right font-mono text-xs text-muted">{index + 1}</span>
                <Icon size={15} className="shrink-0 text-muted" aria-hidden />
                <input
                  value={page.title}
                  maxLength={100}
                  placeholder={t("pageTitlePlaceholder")}
                  onChange={(event) =>
                    mutate((prev) => prev.map((item) => (item.id === page.id ? { ...item, title: event.target.value } : item)))
                  }
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/60"
                />
                <span className="shrink-0 rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">
                  {page.type === "game"
                    ? `${tGames(`items.${page.gameId}.name`)} · ${tGames(`difficulty.${page.difficulty}`)}`
                    : t(`type_${page.type}`)}
                </span>
                <div className="flex shrink-0 items-center">
                  <button type="button" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)} className="rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink disabled:opacity-30">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" aria-label={t("moveDown")} disabled={index === pages.length - 1} onClick={() => move(index, 1)} className="rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink disabled:opacity-30">
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" aria-label={t("removePage")} onClick={() => mutate((prev) => prev.filter((item) => item.id !== page.id))} className="rounded-full p-1.5 text-muted transition-colors hover:bg-rose/10 hover:text-rose">
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={gameDialog} onOpenChange={setGameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("gameDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted">{t("gameLabel")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {games.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => setGameId(game.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      gameId === game.id ? "border-ink/60 bg-moon/40" : "border-line text-muted hover:bg-moon/20"
                    }`}
                  >
                    {tGames(`items.${game.id}.name`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted">{tGames("difficultyLabel")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["easy", "medium", "hard"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDifficulty(level)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      difficulty === level ? "border-ink/60 bg-moon/40" : "border-line text-muted hover:bg-moon/20"
                    }`}
                  >
                    {tGames(`difficulty.${level}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted">{t("seedLabel")}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded-lg bg-line/40 px-3 py-1.5 font-mono text-sm">{seed}</code>
                <button
                  type="button"
                  aria-label={t("rollSeed")}
                  title={t("rollSeed")}
                  onClick={() => setSeed(newId().slice(0, 8))}
                  className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                >
                  <Dices size={15} />
                </button>
                <p className="text-xs text-muted">{t("seedHint")}</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setGameDialog(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              onClick={() => {
                const game = games.find((item) => item.id === gameId);
                if (!game) return;
                const title = tGames(`items.${game.id}.name`);
                mutate((prev) => [...prev, { id: newId(), type: "game", gameId: game.id, difficulty, seed, title }]);
                setGameDialog(false);
              }}
            >
              {t("insertPage")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
