"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoursewareEditorAdapterSurface } from "@/features/courseware-doc/CoursewareEditorAdapterSurface";
import {
  CoursewareEditorSaveControls,
  CoursewareFormalInspectorTabs,
  type CoursewareEditorSaveState,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { CoursewarePageEditorToolbar } from "@/features/courseware-doc/CoursewarePageEditorToolbar";
import {
  CoursewareLayerPanel,
  CoursewarePageElementInspector,
  type CoursewareLayerItem,
} from "@/features/courseware-doc/CoursewarePageElementEditor";
import {
  coursewareTextValue,
  isCoursewareTextElement,
  setCoursewareTextValue,
} from "@/features/courseware-doc/CoursewareTextElementEditor";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { DocNode } from "@/features/courseware-doc/schema";
import {
  createCoursewareInsertedH5Node,
  createCoursewareInsertedImageNode,
  createCoursewareInsertedNode,
  type CoursewareInsertedNodeKind,
} from "@/features/courseware-doc/courseware-inserted-node";
import {
  appendSourceRuntimeEditorNode,
  nextSourceRuntimeResourceId,
  patchSourceRuntimeEditorNode,
  sourceRuntimeEditorBridgeNodes,
  sourceRuntimeEditorCanvas,
  sourceRuntimeEditorNodes,
  sourceRuntimeEditorSupported,
} from "@/features/courseware-doc/source-runtime-editor";
import type { SourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import {
  sourceRuntimeCourseware43Session,
  withSourceRuntimeCourseware43Session,
} from "@/features/courseware-doc/source-runtime-four-by-three";
import {
  defaultCourseware43Session,
  type Courseware43SessionState,
} from "@/features/courseware-doc/courseware-4x3-strategy";
import {
  useCoursewareEditHistory,
  useCoursewareHistoryShortcuts,
} from "@/features/courseware-doc/useCoursewareEditHistory";
import { saveCoursewareDraftAction } from "./actions";
import type { CoursewareTrack } from "./data";
import {
  CoursewarePageH5InsertionControl,
  CoursewarePageImageInsertionControl,
  type InsertedCoursewareAsset,
} from "./CoursewarePageAssetInsertionControls";
import {
  CoursewareFourByThreeComparison,
  CoursewareFourByThreePanel,
  useCoursewareFourByThreeAdapter,
} from "./CoursewareFourByThreeAdapter";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function layerItems(nodes: DocNode[]): CoursewareLayerItem[] {
  return nodes.map((node) => ({
    id: node.nodePath,
    label: node.name?.trim() || node.id,
    kind: node.sourceType.replaceAll("_", " "),
    layer: node.zIndex,
    visible: node.visible,
  }));
}

export function SourceRuntimeFourByThreeEditor({
  pageDocId,
  track,
  initialDoc,
  baseRevisionNo,
  bindingUrls,
  fourByThreeSource,
  fourByThreeDraft,
  view,
}: {
  pageDocId: string;
  track: CoursewareTrack;
  initialDoc: SourceRuntimePageDoc;
  baseRevisionNo: number;
  bindingUrls: ResolvedBindingUrls;
  fourByThreeSource: {
    doc: SourceRuntimePageDoc;
    bindingUrls: ResolvedBindingUrls;
  };
  fourByThreeDraft: {
    doc: SourceRuntimePageDoc;
    baseRevisionNo: number;
    materialized: boolean;
  };
  view: "compare" | "native-16x9" | "adapted-4x3";
}) {
  const t = useTranslations("coursewareWorkspace");
  const elementEditorT = useTranslations("coursewareElementEditor");
  const [doc, setDoc] = useState<SourceRuntimePageDoc>(() => clone(initialDoc));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [insertedBindingUrls, setInsertedBindingUrls] = useState<ResolvedBindingUrls>({});
  const docRef = useRef(clone(initialDoc));
  const coarseLayout = view === "compare";
  const canPersistFourByThree = coarseLayout;
  const [fourByThreeMaterialized, setFourByThreeMaterialized] = useState(fourByThreeDraft.materialized);
  const [saveState, setSaveState] = useState<CoursewareEditorSaveState>(
    () => coarseLayout && !fourByThreeDraft.materialized ? "dirty" : "saved",
  );
  const revisionRef = useRef(baseRevisionNo);
  const fourByThreeRevisionRef = useRef(fourByThreeDraft.baseRevisionNo);
  const fourByThreeMaterializedRef = useRef(fourByThreeDraft.materialized);
  const sequenceRef = useRef(coarseLayout && !fourByThreeDraft.materialized ? 1 : 0);
  const savedSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const supported = sourceRuntimeEditorSupported(doc);

  const markDirty = useCallback(() => {
    sequenceRef.current += 1;
    setSaveState("dirty");
    setMessage("");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
  }, []);

  const restore = useCallback((value: SourceRuntimePageDoc) => {
    const restored = clone(value);
    restored.bindings.resources = {
      ...restored.bindings.resources,
      ...docRef.current.bindings.resources,
    };
    docRef.current = restored;
    setDoc(restored);
    setSelectedPath(null);
    setRevision((current) => current + 1);
    markDirty();
  }, [markDirty]);
  const editHistory = useCoursewareEditHistory({
    currentRef: docRef,
    restore,
    keyboardShortcuts: false,
  });

  const patchNode = useCallback((nodePath: string, mutate: (node: DocNode) => void) => {
    const previous = docRef.current;
    const next = patchSourceRuntimeEditorNode(previous, nodePath, mutate);
    if (!next) return;
    editHistory.record(previous, `source-node:${nodePath}`);
    docRef.current = next;
    setDoc(next);
    setRevision((current) => current + 1);
    markDirty();
  }, [editHistory, markDirty]);

  const nodes = useMemo(() => sourceRuntimeEditorNodes(doc), [doc]);
  const activeBindingUrls = useMemo(
    () => ({ ...bindingUrls, ...insertedBindingUrls }),
    [bindingUrls, insertedBindingUrls],
  );
  const selected = useMemo(
    () => nodes.find((node) => node.nodePath === selectedPath) ?? null,
    [nodes, selectedPath],
  );
  const layers = useMemo(() => layerItems(nodes), [nodes]);
  const bridgeNodes = useMemo(() => sourceRuntimeEditorBridgeNodes(doc), [doc]);
  const bridgeCanvas = useMemo(() => sourceRuntimeEditorCanvas(doc), [doc]);
  const initialFourByThreeState = useMemo(
    () => sourceRuntimeCourseware43Session(fourByThreeDraft.doc)
      ?? defaultCourseware43Session("source-runtime"),
    [fourByThreeDraft.doc],
  );
  const fourByThreeStateRef = useRef<Courseware43SessionState>(initialFourByThreeState);
  const handleFourByThreeStateChange = useCallback((state: Courseware43SessionState) => {
    fourByThreeStateRef.current = state;
    if (canPersistFourByThree) markDirty();
  }, [canPersistFourByThree, markDirty]);

  const fourByThree = useCoursewareFourByThreeAdapter({
    kind: "source-runtime",
    doc: coarseLayout ? fourByThreeSource.doc : doc,
    bindingUrls: coarseLayout ? fourByThreeSource.bindingUrls : activeBindingUrls,
  }, initialFourByThreeState, handleFourByThreeStateChange);
  const activeHistory = coarseLayout ? fourByThree : editHistory;
  useCoursewareHistoryShortcuts(activeHistory);

  const flush = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      const previousSaved = await savingRef.current;
      if (!previousSaved) return false;
    }
    if (savedSequenceRef.current === sequenceRef.current) {
      setSaveState("saved");
      return true;
    }
    if (canPersistFourByThree && fourByThreeMaterializedRef.current && !fourByThree.changed) {
      savedSequenceRef.current = sequenceRef.current;
      setSaveState("saved");
      return true;
    }

    if (timerRef.current) window.clearTimeout(timerRef.current);
    const sequence = sequenceRef.current;
    const savingFourByThree = canPersistFourByThree;
    const docSnapshot = savingFourByThree
      ? withSourceRuntimeCourseware43Session(fourByThreeDraft.doc, fourByThreeStateRef.current)
      : clone(docRef.current);
    const saveTrack: CoursewareTrack = savingFourByThree ? "adapted-4x3" : track;
    const saveBaseRevisionNo = savingFourByThree
      ? fourByThreeRevisionRef.current
      : revisionRef.current;
    setSaveState("saving");
    const request = saveCoursewareDraftAction({
      pageDocId,
      track: saveTrack,
      doc: docSnapshot,
      baseRevisionNo: saveBaseRevisionNo,
      note: t("verticalSliceSaveNote"),
    }).then((result) => {
      if (!result.ok) {
        setSaveState("error");
        setMessage(t("verticalSliceSaveFailed", { code: result.code }));
        return false;
      }
      if (savingFourByThree) {
        fourByThreeRevisionRef.current = result.data.revisionNo;
        fourByThreeMaterializedRef.current = true;
        setFourByThreeMaterialized(true);
        fourByThree.markSaved();
      } else {
        revisionRef.current = result.data.revisionNo;
      }
      savedSequenceRef.current = sequence;
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
  }, [
    canPersistFourByThree,
    fourByThree,
    fourByThreeDraft.doc,
    pageDocId,
    t,
    track,
  ]);

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

  const selectNode = useCallback((nodePath: string) => setSelectedPath(nodePath), []);
  const handleTransform = useCallback((
    nodePath: string,
    patch: Partial<Pick<DocNode["transform"], "x" | "y" | "width" | "height">>,
  ) => {
    patchNode(nodePath, (node) => Object.assign(node.transform, patch));
  }, [patchNode]);
  const handleText = useCallback((nodePath: string, value: string) => {
    const current = sourceRuntimeEditorNodes(docRef.current)
      .find((node) => node.nodePath === nodePath);
    if (!current || !isCoursewareTextElement(current) || coursewareTextValue(current) === value) return;
    patchNode(nodePath, (node) => setCoursewareTextValue(node, value));
  }, [patchNode]);

  const appendNode = useCallback((node: DocNode, resourceId?: string) => {
    const previous = docRef.current;
    const next = appendSourceRuntimeEditorNode(previous, node, resourceId);
    if (!next) return;
    editHistory.record(previous, `insert:${node.id}`);
    docRef.current = next;
    setDoc(next);
    setSelectedPath(node.nodePath);
    setRevision((current) => current + 1);
    markDirty();
  }, [editHistory, markDirty]);

  const insertNode = useCallback((kind: CoursewareInsertedNodeKind) => {
    appendNode(createCoursewareInsertedNode(kind, nodes.length + 1, bridgeCanvas));
  }, [appendNode, bridgeCanvas, nodes.length]);

  const insertImage = useCallback((asset: InsertedCoursewareAsset) => {
    const resourceId = nextSourceRuntimeResourceId(docRef.current);
    setInsertedBindingUrls((current) => ({ ...current, [asset.bindingKey]: asset.url }));
    appendNode(createCoursewareInsertedImageNode(
      asset.bindingKey,
      sourceRuntimeEditorNodes(docRef.current).length + 1,
      sourceRuntimeEditorCanvas(docRef.current),
    ), resourceId);
  }, [appendNode]);

  const insertH5 = useCallback((asset: InsertedCoursewareAsset) => {
    const resourceId = nextSourceRuntimeResourceId(docRef.current);
    setInsertedBindingUrls((current) => ({ ...current, [asset.bindingKey]: asset.url }));
    appendNode(createCoursewareInsertedH5Node(
      asset.bindingKey,
      sourceRuntimeEditorNodes(docRef.current).length + 1,
      sourceRuntimeEditorCanvas(docRef.current),
    ), resourceId);
  }, [appendNode]);

  const sourceRuntimeEditor = useMemo(() => ({
    enabled: !coarseLayout && supported,
    revision,
    selectedNodePath: selectedPath,
    snapToGrid,
    canvas: bridgeCanvas,
    nodes: bridgeNodes,
    moveLabel: elementEditorT("moveElement"),
    resizeLabel: elementEditorT("resizeElement"),
    onNodeSelect: selectNode,
    onNodeTransformChange: handleTransform,
    onNodeTextChange: handleText,
  }), [
    bridgeCanvas,
    bridgeNodes,
    coarseLayout,
    elementEditorT,
    handleText,
    handleTransform,
    revision,
    selectNode,
    selectedPath,
    snapToGrid,
    supported,
  ]);

  const toolbar = (
    <CoursewarePageEditorToolbar
      canUndo={activeHistory.canUndo}
      canRedo={activeHistory.canRedo}
      onUndo={activeHistory.undo}
      onRedo={activeHistory.redo}
      snapToGrid={snapToGrid}
      onSnapToGridChange={setSnapToGrid}
      insertions={coarseLayout ? undefined : {
        text: () => insertNode("text"),
        formula: () => insertNode("formula"),
        shape: () => insertNode("shape"),
        image: (
          <CoursewarePageImageInsertionControl
            pageDocId={pageDocId}
            track={track}
            onInserted={insertImage}
            onError={(code) => setMessage(t("verticalSliceSaveFailed", { code }))}
          />
        ),
        h5: (
          <CoursewarePageH5InsertionControl
            pageDocId={pageDocId}
            track={track}
            onInserted={insertH5}
          />
        ),
      }}
    />
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
      statusTestId="courseware-source-runtime-autosave-status"
      className="w-auto"
    />
  );

  const inspectorHeader = (
    <CoursewareFormalInspectorTabs
      value={coarseLayout ? "layout" : "adjust"}
      onValueChange={() => undefined}
      tabs={coarseLayout ? ["layout"] : ["adjust"]}
      labels={{
        adjust: t("prototypeTabAdjust"),
        layout: t("prototypeTabLayout"),
        replace: t("prototypeTabReplace"),
      }}
    />
  );

  const inspector = coarseLayout ? (
    <ScrollArea className="size-full min-h-0">
      <div className="px-4 py-4">
        <CoursewareFourByThreePanel
          adapter={fourByThree}
          persistence="draft"
          draftReady={fourByThreeMaterialized}
        />
      </div>
    </ScrollArea>
  ) : (
    <ScrollArea className="size-full min-h-0">
      <div className="space-y-4 px-4 py-4">
        <CoursewareLayerPanel
          items={layers}
          selectedId={selectedPath}
          onSelect={selectNode}
          onLayerChange={(nodePath, layer) => patchNode(nodePath, (node) => { node.zIndex = layer; })}
          onVisibilityChange={(nodePath, visible) => patchNode(nodePath, (node) => { node.visible = visible; })}
        />
        <CoursewarePageElementInspector
          node={selected}
          onPatch={(mutate) => {
            if (selectedPath) patchNode(selectedPath, mutate);
          }}
          onTransformChange={(patch) => {
            if (selectedPath) handleTransform(selectedPath, patch);
          }}
        />
        <div className="border-t border-line pt-4">
          {message ? <p className="mt-3 text-xs leading-5 text-destructive" role="alert">{message}</p> : null}
          <p className="mt-3 text-xs leading-5 text-muted" role="status">
            {supported ? t("sourceEditorDraftDescription") : t("sourceEditorUnsupportedDescription")}
          </p>
        </div>
      </div>
    </ScrollArea>
  );

  return (
    <CoursewareEditorAdapterSurface
      toolbar={toolbar}
      saveControls={saveControls}
      inspectorHeader={inspectorHeader}
      inspector={inspector}
      aspect={coarseLayout ? 16 / 9 : view === "adapted-4x3" ? 4 / 3 : doc.viewport.width / doc.viewport.height}
      hostProps={{ "data-courseware-editor-adapter": "source-runtime-page-v1" }}
      stageProps={{ "data-fitted-courseware-stage": true }}
    >
      <CoursewareFourByThreeComparison
        adapter={fourByThree}
        view={view}
        sourceRuntimeEditor={sourceRuntimeEditor}
      />
    </CoursewareEditorAdapterSurface>
  );
}
