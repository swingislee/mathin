"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  FileCode2,
  Gamepad2,
  Grid3X3,
  ImagePlus,
  RotateCcw,
  Shapes,
  Sigma,
  Type,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  CoursewareEditorSaveControls,
  CoursewareFormalInspectorTabs,
  CoursewareInsertionToolbar,
  type CoursewareEditorSaveState,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { CoursewareEditorAdapterSurface } from "@/features/courseware-doc/CoursewareEditorAdapterSurface";
import {
  CoursewareGridSnapToggle,
  coursewareTextValue,
  isCoursewareTextElement,
  setCoursewareTextValue,
} from "@/features/courseware-doc/CoursewareTextElementEditor";
import {
  CoursewareLayerPanel,
  CoursewarePageElementInspector,
  type CoursewareLayerItem,
} from "@/features/courseware-doc/CoursewarePageElementEditor";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { DocNode, PageDoc } from "@/features/courseware-doc/schema";
import { saveCoursewareDraftAction } from "./actions";
import type { CoursewareTrack } from "./data";
import { StagePreview } from "./StagePreview";
import {
  CoursewareFourByThreeComparison,
  CoursewareFourByThreePanel,
  useCoursewareFourByThreeAdapter,
} from "./CoursewareFourByThreeAdapter";

type EditorTab = "adjust" | "layout" | "replace";
type ChangeKind = "content" | "layout";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function visit(nodes: DocNode[], nodePath: string): DocNode | null {
  for (const node of nodes) {
    if (node.nodePath === nodePath) return node;
    const nested = visit(node.children, nodePath);
    if (nested) return nested;
  }
  return null;
}

function collectLayerItems(nodes: DocNode[], depth = 0): CoursewareLayerItem[] {
  return nodes.flatMap((node) => [
    {
      id: node.nodePath,
      label: node.name?.trim() || node.id,
      kind: node.adapter.replaceAll("_", " "),
      layer: node.zIndex,
      visible: node.visible,
      depth,
    },
    ...collectLayerItems(node.children, depth + 1),
  ]);
}

function collectNodeSnapshots(nodes: DocNode[]) {
  const content: unknown[] = [];
  const layout: unknown[] = [];
  const walk = (node: DocNode) => {
    content.push({
      nodePath: node.nodePath,
      content: node.content,
      fontFamily: node.style.fontFamily,
      fontSize: node.style.fontSize,
      fontWeight: node.style.fontWeight,
      lineHeight: node.style.lineHeight,
      letterSpacing: node.style.letterSpacing,
      textAlign: node.style.textAlign,
      color: node.style.color,
    });
    layout.push({
      nodePath: node.nodePath,
      transform: node.transform,
      crop: node.crop,
      zIndex: node.zIndex,
      visible: node.visible,
      objectFit: node.style.objectFit,
      overflow: node.style.overflow,
    });
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return { content, layout };
}

function changeSnapshot(doc: PageDoc, kind: ChangeKind) {
  const snapshots = collectNodeSnapshots(doc.nodes);
  return JSON.stringify(kind === "content" ? snapshots.content : snapshots.layout);
}

export interface PageDocVerticalSliceEditorProps {
  pageDocId: string;
  track: CoursewareTrack;
  view: "compare" | "native-16x9" | "adapted-4x3";
  initialDoc: PageDoc;
  baseRevisionNo: number;
  bindingUrls: ResolvedBindingUrls;
}

export function PageDocVerticalSliceEditor({
  pageDocId,
  track,
  view,
  initialDoc,
  baseRevisionNo,
  bindingUrls,
}: PageDocVerticalSliceEditorProps) {
  const t = useTranslations("coursewareWorkspace");
  const textEditorT = useTranslations("coursewareTextEditor");
  const adaptationT = useTranslations("coursewareFourByThree");
  const [doc, setDoc] = useState<PageDoc>(() => clone(initialDoc));
  const [savedDoc, setSavedDoc] = useState<PageDoc>(() => clone(initialDoc));
  const [currentBaseRevisionNo, setCurrentBaseRevisionNo] = useState(baseRevisionNo);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>("adjust");
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState<CoursewareEditorSaveState>("saved");
  const fourByThree = useCoursewareFourByThreeAdapter({ kind: "page-doc", doc, bindingUrls });
  const coarseLayout = view === "compare";
  const sessionAdapted = view === "adapted-4x3" && track !== "adapted-4x3";
  const displayedTab: EditorTab = coarseLayout ? "layout" : activeTab === "layout" ? "adjust" : activeTab;
  const docRef = useRef(clone(initialDoc));
  const savedDocRef = useRef(clone(initialDoc));
  const revisionRef = useRef(baseRevisionNo);
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  const selected = useMemo(() => selectedPath ? visit(doc.nodes, selectedPath) : null, [doc, selectedPath]);
  const layerItems = useMemo(() => collectLayerItems(doc.nodes), [doc.nodes]);
  const contentChanged = changeSnapshot(doc, "content") !== changeSnapshot(savedDoc, "content");
  const layoutChanged = changeSnapshot(doc, "layout") !== changeSnapshot(savedDoc, "layout");
  const isDirty = JSON.stringify(doc) !== JSON.stringify(savedDoc);

  const flush = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      const previousSaved = await savingRef.current;
      if (!previousSaved) return false;
    }
    if (savedSequenceRef.current === sequenceRef.current) {
      setSaveState("saved");
      return true;
    }

    if (timerRef.current) window.clearTimeout(timerRef.current);
    const sequence = sequenceRef.current;
    const docSnapshot = clone(docRef.current);
    setSaveState("saving");
    const request = saveCoursewareDraftAction({
      pageDocId,
      track,
      doc: docSnapshot,
      baseRevisionNo: revisionRef.current,
      note: t("verticalSliceSaveNote"),
    }).then((result) => {
      if (!result.ok) {
        setSaveState("error");
        setMessage(t("verticalSliceSaveFailed", { code: result.code }));
        return false;
      }
      revisionRef.current = result.data.revisionNo;
      savedSequenceRef.current = sequence;
      savedDocRef.current = clone(docSnapshot);
      setCurrentBaseRevisionNo(result.data.revisionNo);
      setSavedDoc(clone(docSnapshot));
      setMessage("");
      if (sequenceRef.current === sequence) setSaveState("saved");
      else {
        setSaveState("dirty");
        timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
      }
      return true;
    }).catch(() => {
      setSaveState("error");
      setMessage(t("verticalSliceSaveFailed", { code: "NETWORK" }));
      return false;
    }).finally(() => {
      savingRef.current = null;
    });
    savingRef.current = request;
    return request;
  }, [pageDocId, t, track]);

  const markDirty = useCallback(() => {
    sequenceRef.current += 1;
    setSaveState("dirty");
    setMessage("");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
  }, []);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (savedSequenceRef.current === sequenceRef.current) return;
      void flushRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visibility);
      void flushRef.current();
    };
  }, []);

  const patchNode = useCallback((nodePath: string, mutate: (node: DocNode) => void) => {
    const next = clone(docRef.current);
    const target = visit(next.nodes, nodePath);
    if (!target) return;
    mutate(target);
    docRef.current = next;
    setDoc(next);
    markDirty();
  }, [markDirty]);

  const patchSelected = (mutate: (node: DocNode) => void) => {
    if (!selectedPath) return;
    patchNode(selectedPath, mutate);
  };

  const handleNodeTransformChange = useCallback((
    nodePath: string,
    patch: Partial<Pick<DocNode["transform"], "x" | "y" | "width" | "height">>,
  ) => {
    patchNode(nodePath, (node) => Object.assign(node.transform, patch));
  }, [patchNode]);

  const handleNodeTextChange = useCallback((nodePath: string, value: string) => {
    const current = visit(docRef.current.nodes, nodePath);
    if (!current || !isCoursewareTextElement(current) || coursewareTextValue(current) === value) return;
    patchNode(nodePath, (node) => setCoursewareTextValue(node, value));
  }, [patchNode]);

  const insertToolbar = (
    <div className="flex min-w-0 items-center gap-2">
      <span id="courseware-step3-insert-hint" className="sr-only">{t("verticalSliceInsertDeferred")}</span>
      <CoursewareInsertionToolbar
        aria-label={t("contentInsertion")}
        aria-describedby="courseware-step3-insert-hint"
        actions={[
          ...[
            ["text", "prototypeInsertText", Type],
            ["formula", "prototypeInsertFormula", Sigma],
            ["shape", "prototypeInsertShape", Shapes],
            ["image", "prototypeInsertImage", ImagePlus],
            ["game", "prototypeInsertGame", Gamepad2],
            ["h5", "prototypeInsertH5", FileCode2],
            ["tool", "prototypeInsertTool", Wrench],
          ].map(([id, label, icon]) => ({
            id: id as string,
            label: t(label as "prototypeInsertText"),
            icon: icon as typeof Type,
            disabled: true,
          })),
          {
            id: "snap-to-grid",
            label: textEditorT("snapToGrid"),
            icon: Grid3X3,
            control: <CoursewareGridSnapToggle checked={snapToGrid} onCheckedChange={setSnapToGrid} />,
          },
        ]}
      />
    </div>
  );

  const saveControls = (
    <CoursewareEditorSaveControls
      state={saveState}
      labels={{
        saved: t("verticalSliceAutosaved"),
        saving: t("verticalSliceAutosaving"),
        dirty: t("verticalSliceAwaitingAutosave"),
        error: t("verticalSliceAutosaveFailed"),
        saveNow: t("verticalSliceSaveNow"),
      }}
      onSave={() => void flush()}
      statusTestId="courseware-page-doc-autosave-status"
      className="w-auto"
    />
  );

  const inspectorHeader = (
    <CoursewareFormalInspectorTabs
      value={displayedTab}
      onValueChange={(value) => {
        if (!coarseLayout) setActiveTab(value as EditorTab);
      }}
      tabs={coarseLayout ? ["layout"] : ["adjust", "replace"]}
      labels={{
        adjust: t("prototypeTabAdjust"),
        layout: t("prototypeTabLayout"),
        replace: t("prototypeTabReplace"),
      }}
    />
  );

  const inspector = (
    <ScrollArea className="size-full min-h-0">
      <div className="px-4">
        {sessionAdapted ? (
          <div className="space-y-2 py-4">
            <p className="text-sm font-medium text-ink">{adaptationT("generatedDefaultTitle")}</p>
            <p className="text-xs leading-5 text-muted">{adaptationT("generatedDefaultDescription")}</p>
          </div>
        ) : (
        <Tabs value={displayedTab} onValueChange={(value) => setActiveTab(value as EditorTab)}>
      <div
        data-courseware-step3-editor
        data-content-changed={contentChanged ? "true" : "false"}
        data-layout-changed={layoutChanged ? "true" : "false"}
        className="space-y-4 py-4"
      >
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">{t("verticalSliceDraftRevision", { revision: currentBaseRevisionNo })}</Badge>
          <span className="text-[11px] text-muted">{isDirty ? t("verticalSliceUnsaved") : t("verticalSliceSavedState")}</span>
        </div>

        {!coarseLayout ? <TabsContent value="adjust" className="space-y-4">
          <CoursewareLayerPanel
            items={layerItems}
            selectedId={selectedPath}
            onSelect={setSelectedPath}
            onLayerChange={(nodePath, layer) => patchNode(nodePath, (node) => { node.zIndex = layer; })}
            onVisibilityChange={(nodePath, visible) => patchNode(nodePath, (node) => { node.visible = visible; })}
          />
          <CoursewarePageElementInspector
            node={selected}
            onPatch={patchSelected}
            onTransformChange={(patch) => {
              if (selected) handleNodeTransformChange(selected.nodePath, patch);
            }}
          />
        </TabsContent> : null}

        {coarseLayout ? <TabsContent value="layout" className="space-y-3">
          <CoursewareFourByThreePanel adapter={fourByThree} />
        </TabsContent> : null}

        {!coarseLayout ? <TabsContent value="replace" className="space-y-3">
          <p className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{t("verticalSliceReplacementDeferred")}</span>
          </p>
        </TabsContent> : null}

        {displayedTab === "adjust" ? <div className="border-t border-line pt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={saveState === "saving" || !isDirty}
            onClick={() => {
              if (timerRef.current) window.clearTimeout(timerRef.current);
              const restored = clone(savedDocRef.current);
              docRef.current = restored;
              sequenceRef.current = savedSequenceRef.current;
              setDoc(restored);
              setSelectedPath(null);
              setSaveState("saved");
              setMessage("");
            }}
          >
            <RotateCcw className="size-4" />
            {t("verticalSliceReset")}
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted" role="status" aria-live="polite">
            {message || t("verticalSliceReleaseImmutable")}
          </p>
        </div> : null}
      </div>
        </Tabs>
        )}
      </div>
    </ScrollArea>
  );

  return (
    <CoursewareEditorAdapterSurface
      toolbar={coarseLayout || sessionAdapted ? null : insertToolbar}
      saveControls={coarseLayout || sessionAdapted ? <Badge variant="outline">{adaptationT("sessionOnly")}</Badge> : saveControls}
      inspectorHeader={sessionAdapted ? undefined : inspectorHeader}
      inspector={inspector}
      aspect={coarseLayout ? 16 / 9 : sessionAdapted ? 4 / 3 : doc.canvas.width / doc.canvas.height}
      className="p-3"
      hostProps={{ "data-courseware-editor-adapter": "page-doc-v1" }}
      stageProps={{ "data-fitted-courseware-stage": true }}
    >
      {coarseLayout || sessionAdapted ? (
        <CoursewareFourByThreeComparison
          adapter={fourByThree}
          view={sessionAdapted ? "adapted-4x3" : "compare"}
        />
      ) : <StagePreview
        doc={doc}
        bindingUrls={bindingUrls}
        stageMode="natural"
        className="size-full"
        interactive={false}
        playAutoInteractions={false}
        selectedNodePath={selectedPath}
        onNodeSelect={setSelectedPath}
        onNodeTransformChange={handleNodeTransformChange}
        onNodeTextChange={handleNodeTextChange}
        snapToGrid={snapToGrid}
        nodeMoveLabel={textEditorT("moveElement")}
        nodeResizeLabel={textEditorT("resizeElement")}
        onBackgroundSelect={() => {
          setSelectedPath(null);
          setMessage(t("verticalSliceBackgroundDeferred"));
        }}
      />}
    </CoursewareEditorAdapterSurface>
  );
}
