"use client";

import { Eraser, FileOutput, LoaderCircle, MousePointer2, PenLine, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { CanvasSurface } from "@/features/whiteboard/CanvasSurface";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import type { StrokeItem, Tool } from "@/features/whiteboard/types";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  generateSolutionRecordFromBoardAction,
  saveCoursewareAnnotationAction,
} from "./teacher-preparation-actions";

type SaveState = "saved" | "saving" | "error";

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="size-8 p-0"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function CoursewareAnnotationBoard({
  sessionId,
  pageDocId,
  initialContent,
  initialVersion,
  generated,
  readOnly,
  children,
}: {
  sessionId: string;
  pageDocId: string;
  initialContent: StrokeItem[];
  initialVersion: number;
  generated: boolean;
  readOnly: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [store] = useState(() => {
    const created = createWhiteboardStore();
    created.getState().hydrate(`${sessionId}:${pageDocId}`, initialContent);
    return created;
  });
  const tool = useStore(store, (state) => state.tool);
  const revision = useStore(store, (state) => state.revision);
  const itemCount = useStore(store, (state) => state.items.length);
  const canUndo = useStore(store, (state) => state.undoStack.length > 0);
  const [writing, setWriting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [generating, setGenerating] = useState(false);
  const serverVersionRef = useRef(initialVersion);
  const savedLocalRevisionRef = useRef(0);
  const pendingSaveRef = useRef<Promise<boolean> | null>(null);

  const persist = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
    if (pendingSaveRef.current) await pendingSaveRef.current;
    const state = store.getState();
    const targetRevision = state.revision;
    if (targetRevision === savedLocalRevisionRef.current) return true;
    setSaveState("saving");
    const request = saveCoursewareAnnotationAction({
      sessionId,
      pageDocId,
      content: state.items,
      baseVersion: serverVersionRef.current,
    }).then((result) => {
      if (!result.ok) {
        setSaveState("error");
        if (result.code === "VERSION_CONFLICT") router.refresh();
        return false;
      }
      serverVersionRef.current = result.data.version;
      savedLocalRevisionRef.current = targetRevision;
      setSaveState("saved");
      return true;
    }).catch(() => {
      setSaveState("error");
      return false;
    }).finally(() => {
      pendingSaveRef.current = null;
    });
    pendingSaveRef.current = request;
    return request;
  }, [pageDocId, readOnly, router, sessionId, store]);

  useEffect(() => {
    if (readOnly || revision === savedLocalRevisionRef.current) return;
    const timer = window.setTimeout(() => void persist(), 700);
    return () => window.clearTimeout(timer);
  }, [persist, readOnly, revision]);

  const chooseTool = (next: Tool) => {
    store.getState().setTool(next);
    setWriting(next !== "pointer");
  };

  const generate = async () => {
    setGenerating(true);
    const saved = await persist();
    if (!saved) {
      toast.error(t("annotationSaveFailed"));
      setGenerating(false);
      return;
    }
    const result = await generateSolutionRecordFromBoardAction({ sessionId, pageDocId });
    if (result.ok) {
      toast.success(t("annotationSolutionGenerated", { revision: result.data.revision }));
      router.refresh();
    } else {
      toast.error(t(result.code === "ANNOTATION_REQUIRED" ? "annotationRequired" : "actionFailed"));
    }
    setGenerating(false);
  };

  return (
    <div className="relative size-full overflow-hidden" data-courseware-annotation-board>
      {children}
      <CanvasSurface editable={!readOnly && writing} store={store} />
      {!readOnly ? (
        <div className="absolute inset-x-2 top-2 z-20 flex flex-wrap items-center gap-1 rounded-xl border border-line bg-paper/90 p-1 shadow-sm backdrop-blur">
          <ToolButton active={!writing || tool === "pointer"} label={t("annotationPointer")} onClick={() => chooseTool("pointer")}>
            <MousePointer2 size={15} />
          </ToolButton>
          <ToolButton active={writing && tool === "pen"} label={t("annotationWrite")} onClick={() => chooseTool("pen")}>
            <PenLine size={15} />
          </ToolButton>
          <ToolButton active={writing && tool === "strokeEraser"} label={t("annotationEraseStroke")} onClick={() => chooseTool("strokeEraser")}>
            <Eraser size={15} />
          </ToolButton>
          <Button type="button" size="sm" variant="ghost" className="size-8 p-0" disabled={!canUndo} aria-label={t("annotationUndo")} title={t("annotationUndo")} onClick={() => store.getState().undo()}>
            <Undo2 size={15} />
          </Button>
          <span className={cn("ml-1 text-[11px]", saveState === "error" ? "text-rose" : "text-muted")} aria-live="polite">
            {t(saveState === "saving" ? "annotationSaving" : saveState === "error" ? "annotationSaveFailed" : "annotationSaved")}
          </span>
          <Button type="button" size="sm" variant="secondary" className="ml-auto h-8" disabled={itemCount === 0 || generating || saveState === "error"} onClick={() => void generate()}>
            {generating ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <FileOutput size={14} />}
            {generated ? t("annotationRegenerateSolution") : t("annotationGenerateSolution")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function VectorStrokePreview({ items, label }: { items: StrokeItem[]; label: string }) {
  const [store] = useState(() => {
    const created = createWhiteboardStore();
    created.getState().hydrate(`solution-preview:${label}`, items);
    return created;
  });
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-card" role="img" aria-label={label}>
      <CanvasSurface editable={false} store={store} />
    </div>
  );
}
