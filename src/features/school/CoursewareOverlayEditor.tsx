"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  BookOpen,
  Cloud,
  CloudAlert,
  Check,
  Dices,
  Film,
  Gamepad2,
  Image as ImageIcon,
  Lock,
  LoaderCircle,
  PenLine,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { games } from "@/features/games/registry";
import { CoursewareWorkbench } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { SUDOKU_BOX_ELIMINATION_SEED } from "@/features/games/sudoku/presets";
import { SudokuVariantSelector } from "@/features/games/sudoku/SudokuVariantSelector";
import {
  DEFAULT_SUDOKU_VARIANT_ID,
  getSudokuVariant,
  sudokuSeedForVariant,
  type SudokuVariantId,
} from "@/features/games/sudoku/variant";
import { type CoursewarePreviewListItem } from "@/features/courseware-preview/CoursewarePreviewWorkspace";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { Difficulty } from "@/features/games/types";
import { newId } from "@/lib/uuid";
import { saveCoursewareOverlay } from "./actions/courseware";
import { healOverlay, isOverlayRef, resolveCourseware, type CoursewareTemplatePage, type OverlaySlot } from "./courseware-overlay";
import { overlayAssetKind, uploadOverlayAsset } from "./courseware-overlay-upload";
import { downloadCoursewareAsset } from "@/features/classroom/courseware/upload";
import { CoursewareAnnotationBoard } from "./CoursewareAnnotationBoard";
import type {
  CoursewareAnnotation,
  SolutionRecord,
} from "./teacher-preparation-contract";
import { replaceSessionLearningChecksAction } from "./session-learning-actions";
import type { CoursewareLearningCheckPage } from "./session-learning";
import type { SessionLearningCheck } from "./session-learning-contract";

type SaveState = "saved" | "saving" | "dirty" | "error";
type LearningCheckSaveState = "saved" | "saving" | "error";
type LearningCheckItem = { title: string; sourcePageId: string | null };

const PAGE_ICONS = { image: ImageIcon, video: Film, game: Gamepad2, board: PenLine, doc: BookOpen } as const;

function defaultGameSeed(gameId: string) {
  return gameId === "sudoku" ? SUDOKU_BOX_ELIMINATION_SEED : newId().slice(0, 8);
}

function initialLearningCheckItems(
  checks: SessionLearningCheck[],
  pages: CoursewareLearningCheckPage[],
  locked: boolean,
  configured: boolean,
): LearningCheckItem[] {
  const currentPageIds = new Set(pages.map((page) => page.pageDocId));
  if (configured || checks.length > 0 || locked) {
    return checks
      .filter((check) => check.sourcePageId === null || currentPageIds.has(check.sourcePageId))
      .map((check) => ({ title: check.title, sourcePageId: check.sourcePageId }));
  }
  return pages.filter((page) => page.learningCheckEnabled)
    .map((page) => ({ title: page.title, sourcePageId: page.pageDocId }));
}

export function CoursewareOverlayEditor({
  classroomId,
  sessionId,
  template,
  initialOverlay,
  annotations,
  solutionRecords,
  docPreviews,
  learningCheckPages,
  initialLearningChecks,
  learningChecksLocked,
  learningChecksConfigured,
  initialPageId,
  readOnly = false,
  structureReadOnly = readOnly,
  customOnly = false,
}: {
  classroomId: string;
  sessionId: string;
  template: CoursewareTemplatePage[];
  initialOverlay: OverlaySlot[];
  docPreviews: Array<{ pageDocId: string; doc: CoursewareDoc; bindingUrls: ResolvedBindingUrls }>;
  annotations: CoursewareAnnotation[];
  solutionRecords: SolutionRecord[];
  learningCheckPages: CoursewareLearningCheckPage[];
  initialLearningChecks: SessionLearningCheck[];
  learningChecksLocked: boolean;
  learningChecksConfigured: boolean;
  initialPageId?: string;
  readOnly?: boolean;
  structureReadOnly?: boolean;
  /** 自由课次没有所选方案时，全部页面都由本课教师创建。 */
  customOnly?: boolean;
}) {
  const t = useTranslations("school.overlay");
  const ts = useTranslations("school.session");
  const tGames = useTranslations("games");
  const generatedToolbarId = useId();
  const toolbarTargetId = `courseware-annotation-toolbar-${generatedToolbarId.replaceAll(":", "")}`;
  const [overlay, setOverlay] = useState<OverlaySlot[]>(() => healOverlay(template, initialOverlay));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [uploading, setUploading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (!initialPageId) return 0;
    const index = resolveCourseware(template, initialOverlay).findIndex((page) =>
      (page.type === "doc" ? page.docId : page.id) === initialPageId);
    return Math.max(0, index);
  });
  const [previewAsset, setPreviewAsset] = useState<{ path: string; url: string } | null>(null);
  const [gameDialog, setGameDialog] = useState(false);
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [sudokuVariantId, setSudokuVariantId] = useState<SudokuVariantId>(DEFAULT_SUDOKU_VARIANT_ID);
  const [seed, setSeed] = useState(() => defaultGameSeed(games[0]?.id ?? ""));
  const [learningChecks, setLearningChecks] = useState<LearningCheckItem[]>(() =>
    initialLearningCheckItems(initialLearningChecks, learningCheckPages, learningChecksLocked, learningChecksConfigured));
  const coursewareDefaultLearningChecks = useMemo(
    () => learningCheckPages.filter((page) => page.learningCheckEnabled)
      .map((page) => ({ title: page.title, sourcePageId: page.pageDocId })),
    [learningCheckPages],
  );
  const [learningCheckSaveState, setLearningCheckSaveState] = useState<LearningCheckSaveState>("saved");
  const learningChecksRef = useRef(learningChecks);
  const savedLearningChecksRef = useRef(learningChecks);
  const learningCheckRevision = useRef(0);
  const learningCheckSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const restoreUndoRef = useRef<LearningCheckItem[] | null>(null);
  const [restoreUndoAvailable, setRestoreUndoAvailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef = useRef(overlay);
  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);

  const templateById = useMemo(() => new Map(template.map((page) => [page.id, page])), [template]);
  const resolvedPages = useMemo(
    () => overlay.map((slot) => isOverlayRef(slot) ? templateById.get(slot.ref) : slot.page)
      .filter((page): page is CoursewareTemplatePage => Boolean(page)),
    [overlay, templateById],
  );
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, resolvedPages.length - 1));
  const selectedPage = resolvedPages[safeSelectedIndex] ?? null;
  const previewUrl = selectedPage && (selectedPage.type === "image" || selectedPage.type === "video") && previewAsset?.path === selectedPage.path ? previewAsset.url : null;
  const selectedDoc = selectedPage?.type === "doc"
    ? docPreviews.find((preview) => preview.pageDocId === selectedPage.docId) ?? null
    : null;
  const selectedAnnotation = selectedDoc
    ? annotations.find((annotation) => annotation.pageDocId === selectedDoc.pageDocId) ?? null
    : null;
  const selectedBoardGenerated = selectedDoc ? solutionRecords.some((record) => record.source === "board" && record.pageDocId === selectedDoc.pageDocId) : false;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!selectedPage || (selectedPage.type !== "image" && selectedPage.type !== "video")) return;
    void downloadCoursewareAsset(selectedPage.path).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setPreviewAsset({ path: selectedPage.path, url: objectUrl });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedPage]);

  const persist = useCallback(async () => {
    if (structureReadOnly) return;
    setSaveState("saving");
    try {
      await saveCoursewareOverlay(sessionId, overlayRef.current);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [sessionId, structureReadOnly]);

  const mutate = useCallback((updater: (prev: OverlaySlot[]) => OverlaySlot[]) => {
    if (structureReadOnly) return;
    setOverlay(updater);
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 1200);
  }, [persist, structureReadOnly]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const addFiles = async (files: FileList | null) => {
    if (structureReadOnly) return;
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
    if (structureReadOnly) return;
    mutate((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveLearningChecks = (
    next: LearningCheckItem[],
    callbacks?: { onFailure?: () => void },
  ) => {
    learningChecksRef.current = next;
    setLearningChecks(next);
    const revision = ++learningCheckRevision.current;
    setLearningCheckSaveState("saving");
    learningCheckSaveQueue.current = learningCheckSaveQueue.current.then(async () => {
      try {
        const result = await replaceSessionLearningChecksAction({ sessionId, items: next });
        if (!result.ok) throw new Error(result.code);
        savedLearningChecksRef.current = next;
        if (revision === learningCheckRevision.current) setLearningCheckSaveState("saved");
      } catch {
        if (revision === learningCheckRevision.current) {
          learningChecksRef.current = savedLearningChecksRef.current;
          setLearningChecks(savedLearningChecksRef.current);
          setLearningCheckSaveState("error");
          callbacks?.onFailure?.();
          toast.error(ts("actionFailed"));
        }
      }
    });
  };

  const toggleLearningCheck = (page: Extract<CoursewareTemplatePage, { type: "doc" }>) => {
    if (readOnly || learningChecksLocked) return;
    restoreUndoRef.current = null;
    setRestoreUndoAvailable(false);
    const current = learningChecksRef.current;
    const selected = current.some((item) => item.sourcePageId === page.docId);
    saveLearningChecks(selected
      ? current.filter((item) => item.sourcePageId !== page.docId)
      : [...current, { title: page.title, sourcePageId: page.docId }]);
  };

  const restoreLearningCheckDefaults = () => {
    if (readOnly || learningChecksLocked || learningCheckDefaultsActive) return;
    const previous = [...learningChecksRef.current];
    restoreUndoRef.current = previous;
    setRestoreUndoAvailable(true);
    saveLearningChecks(coursewareDefaultLearningChecks, {
      onFailure: () => {
        restoreUndoRef.current = null;
        setRestoreUndoAvailable(false);
      },
    });
  };

  const undoRestoreLearningCheckDefaults = () => {
    if (readOnly || learningChecksLocked || !restoreUndoRef.current) return;
    const previous = restoreUndoRef.current;
    restoreUndoRef.current = null;
    setRestoreUndoAvailable(false);
    saveLearningChecks(previous, {
      onFailure: () => {
        restoreUndoRef.current = previous;
        setRestoreUndoAvailable(true);
      },
    });
  };

  const saveLabel = {
    saved: t("saved"),
    saving: t("saving"),
    dirty: t("unsaved"),
    error: t("saveFailed"),
  }[saveState];
  const usingSudokuTeachingPreset = gameId === "sudoku" && seed === SUDOKU_BOX_ELIMINATION_SEED;
  const learningCheckSaveLabel = {
    saved: ts("learningChecksAutoSaved"),
    saving: ts("learningChecksSaving"),
    error: ts("learningChecksSaveFailed"),
  }[learningCheckSaveState];
  const learningCheckDefaultsActive = learningChecks.length === coursewareDefaultLearningChecks.length
    && coursewareDefaultLearningChecks.every((expected, index) =>
      learningChecks[index]?.sourcePageId === expected.sourcePageId);

  const checkMarker = (page: Extract<CoursewareTemplatePage, { type: "doc" }>) => {
    const selectedForCheck = learningChecks.some((item) => item.sourcePageId === page.docId);
    return (
      <button
        type="button"
        aria-pressed={selectedForCheck}
        aria-label={ts(selectedForCheck ? "learningCheckQuickRemove" : "learningCheckQuickAdd")}
        title={ts(selectedForCheck ? "learningCheckQuickRemove" : "learningCheckQuickAdd")}
        disabled={readOnly || learningChecksLocked}
        onClick={(event) => {
          event.stopPropagation();
          toggleLearningCheck(page);
        }}
        className={"grid size-7 shrink-0 place-items-center rounded-full transition " + (selectedForCheck
          ? "bg-leaf/30 text-leaf-deep"
          : "text-muted hover:bg-moon/40 hover:text-ink")}
      >
        {selectedForCheck ? <BadgeCheck size={16} /> : <BookOpen size={15} />}
      </button>
    );
  };

  const previewItems: CoursewarePreviewListItem[] = overlay.map((slot, index) => {
    if (isOverlayRef(slot)) {
      const page = templateById.get(slot.ref);
      const Icon = page ? PAGE_ICONS[page.type] : Lock;
      return {
        id: "ref-" + slot.ref,
        title: page?.title || t("templatePage"),
        leading: page?.type === "doc"
          ? checkMarker(page)
          : <span className="grid size-7 shrink-0 place-items-center text-muted"><Icon size={15} aria-hidden /></span>,
        trailing: structureReadOnly ? undefined : (
          <div className="flex shrink-0 items-center opacity-40 transition group-hover:opacity-100">
            <button type="button" aria-label={t("moveUp")} disabled={index === 0} onClick={(event) => { event.stopPropagation(); move(index, -1); }} className="rounded-full p-1 text-muted hover:bg-moon/30 hover:text-ink disabled:opacity-20">
              <ArrowUp size={12} />
            </button>
            <button type="button" aria-label={t("moveDown")} disabled={index === overlay.length - 1} onClick={(event) => { event.stopPropagation(); move(index, 1); }} className="rounded-full p-1 text-muted hover:bg-moon/30 hover:text-ink disabled:opacity-20">
              <ArrowDown size={12} />
            </button>
          </div>
        ),
      };
    }
    const page = slot.page;
    const templatePage = templateById.get(page.id);
    const displayPage = templatePage ?? page;
    const Icon = PAGE_ICONS[displayPage.type];
    return {
      id: displayPage.id,
      title: displayPage.title,
      leading: displayPage.type === "doc"
        ? checkMarker(displayPage)
        : <span className="grid size-7 shrink-0 place-items-center text-muted"><Icon size={15} aria-hidden /></span>,
      titleContent: structureReadOnly || templatePage ? (
        <span className="min-w-0 flex-1 truncate px-1 text-xs">{displayPage.title}</span>
      ) : (
        <Input
          value={page.title}
          maxLength={100}
          placeholder={t("pageTitlePlaceholder")}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            mutate((prev) =>
              prev.map((item) =>
                !isOverlayRef(item) && item.page.id === page.id
                  ? { page: { ...item.page, title: event.target.value } }
                  : item,
              ),
            )
          }
          className="h-8 min-w-0 border-0 bg-transparent px-1 text-xs shadow-none"
        />
      ),
      trailing: structureReadOnly ? undefined : (
        <div className="flex shrink-0 items-center opacity-40 transition group-hover:opacity-100">
          <button type="button" aria-label={t("moveUp")} disabled={index === 0} onClick={(event) => { event.stopPropagation(); move(index, -1); }} className="rounded-full p-1 text-muted hover:bg-moon/30 hover:text-ink disabled:opacity-20">
            <ArrowUp size={12} />
          </button>
          <button type="button" aria-label={t("moveDown")} disabled={index === overlay.length - 1} onClick={(event) => { event.stopPropagation(); move(index, 1); }} className="rounded-full p-1 text-muted hover:bg-moon/30 hover:text-ink disabled:opacity-20">
            <ArrowDown size={12} />
          </button>
          <button type="button" aria-label={t("removeInserted")} onClick={(event) => { event.stopPropagation(); mutate((prev) => prev.filter((item) => isOverlayRef(item) || item.page.id !== page.id)); }} className="rounded-full p-1 text-muted hover:bg-rose/10 hover:text-rose">
            <Trash2 size={12} />
          </button>
        </div>
      ),
    };
  });

  const previewContent = !selectedPage ? (
    <p className="grid size-full place-items-center text-sm text-muted">{t("previewEmpty")}</p>
  ) : selectedPage.type === "doc" ? (
    selectedDoc ? (
      <CoursewareAnnotationBoard
        key={`${selectedDoc.pageDocId}:${selectedAnnotation?.version ?? 0}`}
        sessionId={sessionId}
        pageDocId={selectedDoc.pageDocId}
        initialContent={selectedAnnotation?.content ?? []}
        initialVersion={selectedAnnotation?.version ?? 0}
        generated={selectedBoardGenerated}
        readOnly={readOnly}
        toolbarTargetId={toolbarTargetId}
      >
        <StagePreview doc={selectedDoc.doc} bindingUrls={selectedDoc.bindingUrls} stageMode="board43" interactive={false} className="size-full" />
      </CoursewareAnnotationBoard>
    ) : (
      <p className="grid size-full place-items-center text-sm text-muted">{t("previewLoading")}</p>
    )
  ) : selectedPage.type === "image" ? (
    previewUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- private courseware blob preview
      <img src={previewUrl} alt={selectedPage.title} className="size-full object-contain" />
    ) : (
      <p className="grid size-full place-items-center text-sm text-muted">{t("previewLoading")}</p>
    )
  ) : selectedPage.type === "video" ? (
    previewUrl ? (
      <video src={previewUrl} controls playsInline className="size-full object-contain" />
    ) : (
      <p className="grid size-full place-items-center text-sm text-muted">{t("previewLoading")}</p>
    )
  ) : (
    <div className="grid size-full place-items-center bg-paper-lines p-8 text-center">
      <div>
        <p className="font-display text-xl text-ink">{selectedPage.title}</p>
        <p className="mt-2 text-sm text-muted">
          {selectedPage.type === "game" ? t("previewGame") : t("previewBoard")}
        </p>
      </div>
    </div>
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium text-muted">{t("title", { count: overlay.length })}</h3>
        {!structureReadOnly ? (
          <span
            className={saveState === "error" ? "text-rose" : "text-muted"}
            title={saveLabel}
            aria-label={saveLabel}
            data-courseware-save-state={saveState}
          >
            {saveState === "saved" ? <Check size={15} aria-hidden />
              : saveState === "error" ? <CloudAlert size={15} aria-hidden />
                : saveState === "saving" ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
                  : <Cloud size={15} aria-hidden />}
            <span className="sr-only">{saveLabel}</span>
          </span>
        ) : null}
        {!structureReadOnly ? <div className="ml-auto flex flex-wrap items-center gap-2">
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
              setSeed(defaultGameSeed(gameId));
              if (gameId === "sudoku") {
                setDifficulty("hard");
                setSudokuVariantId(DEFAULT_SUDOKU_VARIANT_ID);
              }
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
        </div> : null}
      </div>
      <p className="mt-2 text-xs text-muted">
        {structureReadOnly
          ? ts(readOnly ? "prepArchiveCoursewareHint" : "prepArchiveUnlockedCoursewareHint")
          : t(customOnly ? "freeHint" : "hint")}
      </p>

      <CoursewareWorkbench
        mode="preview"
        className="mt-3 flex-1"
        railWidth="wide"
        items={previewItems}
        selectedIndex={safeSelectedIndex}
        onSelectedIndexChange={setSelectedIndex}
        directoryLabel={structureReadOnly ? ts("coursewareArchivePageRailTitle") : ts("coursewarePageRailTitle")}
        previewLabel={t("visualPreview")}
        previousLabel={ts("coursewarePreviousPage")}
        nextLabel={ts("coursewareNextPage")}
        toolbarTargetId={!readOnly && selectedPage?.type === "doc" ? toolbarTargetId : undefined}
        selectedPageLabel={selectedPage ? safeSelectedIndex + 1 + " / " + resolvedPages.length + " · " + selectedPage.title : t("previewEmpty")}
        railStatus={(
          <>
            {!readOnly ? <span className={"shrink-0 text-[11px] " + (learningCheckSaveState === "error" ? "text-rose" : "text-muted")}>{learningCheckSaveLabel}</span> : null}
            <span className="shrink-0 text-xs tabular-nums text-muted">{learningChecks.filter((item) => item.sourcePageId).length} / {resolvedPages.length}</span>
          </>
        )}
        railFooter={!readOnly && !learningChecksLocked ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 min-w-0 flex-1 justify-start px-2 text-xs text-muted"
              disabled={learningCheckDefaultsActive}
              onClick={restoreLearningCheckDefaults}
            >
              <RotateCcw size={13} />
              <span className="truncate">{ts("learningChecksRestoreCourseware")}</span>
            </Button>
            {restoreUndoAvailable ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={undoRestoreLearningCheckDefaults}
              >
                <Undo2 size={13} />
                {ts("learningChecksUndoRestore")}
              </Button>
            ) : null}
          </div>
        ) : undefined}
        preview={previewContent}
      />
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
                    onClick={() => {
                      setGameId(game.id);
                      setSeed(defaultGameSeed(game.id));
                      setDifficulty(game.id === "sudoku" ? "hard" : "easy");
                      setSudokuVariantId(DEFAULT_SUDOKU_VARIANT_ID);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      gameId === game.id ? "border-ink/60 bg-moon/40" : "border-line text-muted hover:bg-moon/20"
                    }`}
                  >
                    {tGames(`items.${game.id}.name`)}
                  </button>
                ))}
              </div>
            </div>
            {gameId === "sudoku" ? (
              <div>
                <p className="text-xs text-muted">{tGames("sudokuVariantLabel")}</p>
                <SudokuVariantSelector
                  value={sudokuVariantId}
                  surface="courseware"
                  className="mt-2 w-fit"
                  onValueChange={(variantId) => {
                    setSudokuVariantId(variantId);
                    setSeed((current) => sudokuSeedForVariant(current, variantId));
                  }}
                />
              </div>
            ) : null}
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
                  onClick={() => {
                    const nextSeed = newId().slice(0, 8);
                    setSeed(gameId === "sudoku" ? sudokuSeedForVariant(nextSeed, sudokuVariantId) : nextSeed);
                  }}
                  className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
                >
                  <Dices size={15} />
                </button>
                <p className="text-xs text-muted">
                  {t(usingSudokuTeachingPreset ? "sudokuTeachingPresetHint" : "seedHint")}
                </p>
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
                const title = usingSudokuTeachingPreset
                  ? t("sudokuBoxEliminationTitle")
                  : game.id === "sudoku"
                    ? tGames("sudokuVariantTitle", {
                        size: tGames(getSudokuVariant(sudokuVariantId)?.messageKey ?? "sudokuVariants.classic-9x9"),
                      })
                  : tGames(`items.${game.id}.name`);
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
