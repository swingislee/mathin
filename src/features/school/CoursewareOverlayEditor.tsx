"use client";

import { Input } from "@/components/ui/input";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Dices,
  Film,
  Gamepad2,
  Image as ImageIcon,
  Lock,
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
import { saveCoursewareOverlay } from "./actions/courseware";
import { healOverlay, isOverlayRef, type CoursewareTemplatePage, type OverlaySlot } from "./courseware-overlay";
import { overlayAssetKind, uploadOverlayAsset } from "./courseware-overlay-upload";

type SaveState = "saved" | "saving" | "dirty" | "error";

const PAGE_ICONS = { image: ImageIcon, video: Film, game: Gamepad2, board: PenLine, doc: BookOpen } as const;

export function CoursewareOverlayEditor({
  classroomId,
  sessionId,
  template,
  initialOverlay,
}: {
  classroomId: string;
  sessionId: string;
  template: CoursewareTemplatePage[];
  initialOverlay: OverlaySlot[];
}) {
  const t = useTranslations("school.overlay");
  const tGames = useTranslations("games");
  const [overlay, setOverlay] = useState<OverlaySlot[]>(() => healOverlay(template, initialOverlay));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [uploading, setUploading] = useState(false);
  const [gameDialog, setGameDialog] = useState(false);
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [seed, setSeed] = useState(() => newId().slice(0, 8));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef = useRef(overlay);
  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);

  const templateById = useMemo(() => new Map(template.map((page) => [page.id, page])), [template]);

  const persist = useCallback(async () => {
    setSaveState("saving");
    try {
      await saveCoursewareOverlay(sessionId, overlayRef.current);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [sessionId]);

  const mutate = useCallback((updater: (prev: OverlaySlot[]) => OverlaySlot[]) => {
    setOverlay(updater);
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
        const kind = overlayAssetKind(file);
        if (!kind) continue;
        const path = await uploadOverlayAsset(classroomId, file);
        const title = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
        mutate((prev) => [...prev, { page: { id: newId(), type: kind, path, title } }]);
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
        <h3 className="text-sm font-medium text-muted">{t("title", { count: overlay.length })}</h3>
        <span className={`text-xs ${saveState === "error" ? "text-rose" : "text-muted"}`}>{saveLabel}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
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
            onClick={() => mutate((prev) => [...prev, { page: { id: newId(), type: "board", title: t("boardPageTitle") } }])}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-moon/30 hover:text-ink"
          >
            <PenLine size={14} />
            {t("addBoard")}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">{t("hint")}</p>

      <ol className="mt-4 divide-y divide-line rounded-2xl border border-line">
        {overlay.map((slot, index) => {
          if (isOverlayRef(slot)) {
            const page = templateById.get(slot.ref);
            const Icon = page ? PAGE_ICONS[page.type] : Lock;
            return (
              <li key={`ref-${slot.ref}`} className="flex items-center gap-3 bg-line/20 px-4 py-2.5">
                <span className="w-6 shrink-0 text-right font-mono text-xs text-muted">{index + 1}</span>
                <Icon size={15} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{page?.title || t("templatePage")}</span>
                <span className="shrink-0 rounded-full bg-line/60 px-2 py-0.5 text-xs text-muted">{t("templatePage")}</span>
                <div className="flex shrink-0 items-center">
                  <button type="button" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)} className="rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink disabled:opacity-30">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" aria-label={t("moveDown")} disabled={index === overlay.length - 1} onClick={() => move(index, 1)} className="rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink disabled:opacity-30">
                    <ArrowDown size={14} />
                  </button>
                  <span className="w-7" />
                </div>
              </li>
            );
          }
          const page = slot.page;
          const Icon = PAGE_ICONS[page.type];
          return (
            <li key={page.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-6 shrink-0 text-right font-mono text-xs text-muted">{index + 1}</span>
              <Icon size={15} className="shrink-0 text-muted" aria-hidden />
              <Input
                value={page.title}
                maxLength={100}
                placeholder={t("pageTitlePlaceholder")}
                onChange={(event) =>
                  mutate((prev) =>
                    prev.map((item) =>
                      !isOverlayRef(item) && item.page.id === page.id
                        ? { page: { ...item.page, title: event.target.value } }
                        : item,
                    ),
                  )
                }
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/60"
              />
              <span className="shrink-0 rounded-full bg-crater/15 px-2 py-0.5 text-xs text-crater">
                {page.type === "game"
                  ? `${tGames(`items.${page.gameId}.name`)} · ${tGames(`difficulty.${page.difficulty}`)}`
                  : t(`type_${page.type}`)}
              </span>
              <div className="flex shrink-0 items-center">
                <button type="button" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)} className="rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink disabled:opacity-30">
                  <ArrowUp size={14} />
                </button>
                <button type="button" aria-label={t("moveDown")} disabled={index === overlay.length - 1} onClick={() => move(index, 1)} className="rounded-full p-1.5 text-muted transition-colors hover:bg-moon/30 hover:text-ink disabled:opacity-30">
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  aria-label={t("removeInserted")}
                  onClick={() => mutate((prev) => prev.filter((item) => isOverlayRef(item) || item.page.id !== page.id))}
                  className="rounded-full p-1.5 text-muted transition-colors hover:bg-rose/10 hover:text-rose"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>

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
                mutate((prev) => [...prev, { page: { id: newId(), type: "game", gameId: game.id, difficulty, seed, title } }]);
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
