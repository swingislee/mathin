"use client";

import { FileOutput, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { CanvasSurface } from "@/features/whiteboard/CanvasSurface";
import { createWhiteboardStore } from "@/features/whiteboard/store";
import { Toolbar } from "@/features/whiteboard/Toolbar";
import type { BoardItem } from "@/features/whiteboard/types";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  generateSolutionRecordFromBoardAction,
  saveCoursewareAnnotationAction,
} from "./teacher-preparation-actions";

type SaveState = "saved" | "saving" | "error";

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
  initialContent: BoardItem[];
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
  const revision = useStore(store, (state) => state.revision);
  const itemCount = useStore(store, (state) => state.items.length);
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
      <CanvasSurface editable={!readOnly} store={store} />
      {!readOnly ? (
        <>
          <div className="absolute right-2 top-2 z-30 flex items-center gap-2 rounded-xl border border-line bg-paper/90 p-1 shadow-sm backdrop-blur" data-courseware-annotation-actions>
            <span className={cn("px-1 text-[11px]", saveState === "error" ? "text-rose" : "text-muted")} aria-live="polite">
              {t(saveState === "saving" ? "annotationSaving" : saveState === "error" ? "annotationSaveFailed" : "annotationSaved")}
            </span>
            <Button type="button" size="sm" variant="secondary" className="h-8" disabled={itemCount === 0 || generating || saveState === "error"} onClick={() => void generate()}>
              {generating ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <FileOutput size={14} />}
              {generated ? t("annotationRegenerateSolution") : t("annotationGenerateSolution")}
            </Button>
          </div>
          <div className="absolute inset-x-2 bottom-2 z-30 flex justify-center" data-courseware-annotation-toolbar>
            <Toolbar title={`solution-${pageDocId}`} store={store} className="max-w-full shadow-sm" />
          </div>
        </>
      ) : null}
    </div>
  );
}

export interface SolutionRecordPagePreview {
  pageDocId: string;
  doc: CoursewareDoc;
  bindingUrls: ResolvedBindingUrls;
}

export function SolutionRecordPreview({
  items,
  label,
  previewId,
  pagePreview,
  unavailableLabel,
}: {
  items: BoardItem[];
  label: string;
  previewId: string;
  pagePreview: SolutionRecordPagePreview | null;
  unavailableLabel: string;
}) {
  const [store] = useState(() => {
    const created = createWhiteboardStore();
    created.getState().hydrate(`solution-preview:${label}`, items);
    return created;
  });
  return (
    <div
      id={previewId}
      className="relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-card"
      role="img"
      aria-label={label}
      data-solution-record-preview
      data-courseware-page-ready={pagePreview ? "true" : "false"}
    >
      {pagePreview ? (
        <StagePreview
          doc={pagePreview.doc}
          bindingUrls={pagePreview.bindingUrls}
          stageMode="board43"
          interactive={false}
          className="size-full"
        />
      ) : (
        <p className="grid size-full place-items-center px-6 text-center text-xs text-muted">
          {unavailableLabel}
        </p>
      )}
      <div className="pointer-events-none absolute inset-0 z-10">
        <CanvasSurface editable={false} store={store} />
      </div>
    </div>
  );
}
