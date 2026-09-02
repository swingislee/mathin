"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoursewareEditorAdapterSurface } from "@/features/courseware-doc/CoursewareEditorAdapterSurface";
import { CoursewareFormalInspectorTabs } from "@/features/courseware-doc/CoursewareEditorWorkbench";
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
  patchSourceRuntimeEditorNode,
  sourceRuntimeEditorBridgeNodes,
  sourceRuntimeEditorCanvas,
  sourceRuntimeEditorNodes,
  sourceRuntimeEditorSupported,
} from "@/features/courseware-doc/source-runtime-editor";
import type { SourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import { useCoursewareEditHistory } from "@/features/courseware-doc/useCoursewareEditHistory";
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
  doc: initialDoc,
  bindingUrls,
  view,
}: {
  doc: SourceRuntimePageDoc;
  bindingUrls: ResolvedBindingUrls;
  view: "compare" | "native-16x9" | "adapted-4x3";
}) {
  const t = useTranslations("coursewareWorkspace");
  const elementEditorT = useTranslations("coursewareElementEditor");
  const [doc, setDoc] = useState<SourceRuntimePageDoc>(() => clone(initialDoc));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [revision, setRevision] = useState(0);
  const docRef = useRef(clone(initialDoc));
  const initialRef = useRef(clone(initialDoc));
  const initialPayloadRef = useRef(JSON.stringify(initialDoc.payload.data));
  const coarseLayout = view === "compare";
  const supported = sourceRuntimeEditorSupported(doc);

  const restore = useCallback((value: SourceRuntimePageDoc) => {
    docRef.current = value;
    setDoc(value);
    setSelectedPath(null);
    setRevision((current) => current + 1);
  }, []);
  const editHistory = useCoursewareEditHistory({ currentRef: docRef, restore });

  const patchNode = useCallback((nodePath: string, mutate: (node: DocNode) => void) => {
    const previous = docRef.current;
    const next = patchSourceRuntimeEditorNode(previous, nodePath, mutate);
    if (!next) return;
    editHistory.record(previous, `source-node:${nodePath}`);
    docRef.current = next;
    setDoc(next);
    setRevision((current) => current + 1);
  }, [editHistory]);

  const nodes = useMemo(() => sourceRuntimeEditorNodes(doc), [doc]);
  const selected = useMemo(
    () => nodes.find((node) => node.nodePath === selectedPath) ?? null,
    [nodes, selectedPath],
  );
  const layers = useMemo(() => layerItems(nodes), [nodes]);
  const bridgeNodes = useMemo(() => sourceRuntimeEditorBridgeNodes(doc), [doc]);
  const bridgeCanvas = useMemo(() => sourceRuntimeEditorCanvas(doc), [doc]);
  const changed = JSON.stringify(doc.payload.data) !== initialPayloadRef.current;

  const fourByThree = useCoursewareFourByThreeAdapter({
    kind: "source-runtime",
    doc,
    bindingUrls,
  });

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
      canUndo={editHistory.canUndo}
      canRedo={editHistory.canRedo}
      onUndo={editHistory.undo}
      onRedo={editHistory.redo}
      snapToGrid={snapToGrid}
      onSnapToGridChange={setSnapToGrid}
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
        <CoursewareFourByThreePanel adapter={fourByThree} />
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={!changed}
            onClick={() => {
              const current = docRef.current;
              editHistory.record(current, "source-reset-session");
              restore(clone(initialRef.current));
            }}
          >
            <RotateCcw className="size-4" />
            {t("sourceEditorResetSession")}
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted" role="status">
            {supported ? t("sourceEditorSessionDescription") : t("sourceEditorUnsupportedDescription")}
          </p>
        </div>
      </div>
    </ScrollArea>
  );

  return (
    <CoursewareEditorAdapterSurface
      toolbar={toolbar}
      saveControls={<Badge variant="outline">{t(changed ? "sourceEditorSessionChanged" : "sourceEditorSessionOnly")}</Badge>}
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
