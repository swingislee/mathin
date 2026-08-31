"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  CircleAlert,
  FileCode2,
  Gamepad2,
  ImagePlus,
  RotateCcw,
  Save,
  Shapes,
  Sigma,
  Type,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CoursewareInsertionToolbar } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { DocNode, PageDoc } from "@/features/courseware-doc/schema";
import { useRouter } from "@/i18n/navigation";
import { saveCoursewareDraftAction } from "./actions";
import { FittedCoursewareCanvas } from "./FittedCoursewareCanvas";
import { StagePreview } from "./StagePreview";

type EditorTab = "adjust" | "layout" | "replace";
type ChangeKind = "content" | "layout";
type NumericTransformKey = "x" | "y" | "width" | "height" | "rotation" | "scaleX" | "scaleY" | "anchorX" | "anchorY" | "opacity";

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

function firstEditableNodePath(nodes: DocNode[]): string | null {
  for (const node of nodes) {
    if (node.content) return node.nodePath;
    const nested = firstEditableNodePath(node.children);
    if (nested) return nested;
  }
  return null;
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
  track: "native-16x9";
  initialDoc: PageDoc;
  baseRevisionNo: number;
  bindingUrls: ResolvedBindingUrls;
  toolbarTargetId: string;
  tabsTargetId: string;
  inspectorTargetId: string;
}

export function PageDocVerticalSliceEditor({
  pageDocId,
  track,
  initialDoc,
  baseRevisionNo,
  bindingUrls,
  toolbarTargetId,
  tabsTargetId,
  inspectorTargetId,
}: PageDocVerticalSliceEditorProps) {
  const router = useRouter();
  const t = useTranslations("coursewareWorkspace");
  const [doc, setDoc] = useState<PageDoc>(() => clone(initialDoc));
  const [savedDoc, setSavedDoc] = useState<PageDoc>(() => clone(initialDoc));
  const [currentBaseRevisionNo, setCurrentBaseRevisionNo] = useState(baseRevisionNo);
  const [selectedPath, setSelectedPath] = useState<string | null>(() => firstEditableNodePath(initialDoc.nodes));
  const [activeTab, setActiveTab] = useState<EditorTab>("adjust");
  const [message, setMessage] = useState("");
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  const [tabsTarget, setTabsTarget] = useState<HTMLElement | null>(null);
  const [inspectorTarget, setInspectorTarget] = useState<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = useMemo(() => selectedPath ? visit(doc.nodes, selectedPath) : null, [doc, selectedPath]);
  const contentChanged = changeSnapshot(doc, "content") !== changeSnapshot(savedDoc, "content");
  const layoutChanged = changeSnapshot(doc, "layout") !== changeSnapshot(savedDoc, "layout");
  const isDirty = JSON.stringify(doc) !== JSON.stringify(savedDoc);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setToolbarTarget(document.getElementById(toolbarTargetId));
      setTabsTarget(document.getElementById(tabsTargetId));
      setInspectorTarget(document.getElementById(inspectorTargetId));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inspectorTargetId, tabsTargetId, toolbarTargetId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const patchSelected = (mutate: (node: DocNode) => void) => {
    if (!selectedPath) return;
    setDoc((current) => {
      const next = clone(current);
      const target = visit(next.nodes, selectedPath);
      if (target) mutate(target);
      return next;
    });
  };

  const patchNumber = (
    key: NumericTransformKey | "fontSize" | "lineHeight" | "zIndex",
    raw: string,
  ) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    patchSelected((node) => {
      if (key === "fontSize" || key === "lineHeight") node.style[key] = value;
      else if (key === "zIndex") node.zIndex = Math.round(value);
      else if (key === "opacity") node.transform.opacity = Math.min(1, Math.max(0, value));
      else node.transform[key] = value;
    });
  };

  const save = () => startTransition(async () => {
    const result = await saveCoursewareDraftAction({
      pageDocId,
      track,
      doc,
      baseRevisionNo: currentBaseRevisionNo,
      note: t("verticalSliceSaveNote"),
    });
    if (!result.ok) {
      setMessage(t("verticalSliceSaveFailed", { code: result.code }));
      return;
    }
    setCurrentBaseRevisionNo(result.data.revisionNo);
    setSavedDoc(clone(doc));
    setMessage(t("verticalSliceSaved", { revision: result.data.revisionNo }));
    router.refresh();
  });

  const insertToolbar = (
    <>
      <span id="courseware-step3-insert-hint" className="sr-only">{t("verticalSliceInsertDeferred")}</span>
      <CoursewareInsertionToolbar
        aria-label={t("contentInsertion")}
        aria-describedby="courseware-step3-insert-hint"
        actions={[
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
        }))}
      />
    </>
  );

  const inspector = (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)}>
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

        <TabsContent value="adjust" className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line px-3 py-2">
              <p className="text-xs font-medium text-ink">{t("verticalSliceSharedContent")}</p>
              <p className="mt-1 text-[11px] text-muted">{contentChanged ? t("verticalSliceChanged") : t("verticalSliceUnchanged")}</p>
            </div>
            <div className="rounded-lg border border-line px-3 py-2">
              <p className="text-xs font-medium text-ink">{t("verticalSliceTrackLayout")}</p>
              <p className="mt-1 text-[11px] text-muted">{layoutChanged ? t("verticalSliceChanged") : t("verticalSliceUnchanged")}</p>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted">{t("verticalSliceIsolationHint")}</p>

          {selected ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-ink">{selected.name || selected.adapter}</p>
                <p className="break-all text-[11px] text-muted">{selected.nodePath}</p>
              </div>
              {selected.content ? (
                <div className="space-y-1.5">
                  <Label htmlFor="courseware-step3-content">{t("verticalSliceTextOrHtml")}</Label>
                  <Textarea
                    id="courseware-step3-content"
                    className="min-h-28 resize-y"
                    value={selected.content.html ?? selected.content.text ?? ""}
                    onChange={(event) => patchSelected((node) => {
                      if (!node.content) return;
                      if ("html" in node.content && node.content.html !== undefined) node.content.html = event.target.value;
                      else node.content.text = event.target.value;
                    })}
                  />
                </div>
              ) : <p className="text-xs text-muted">{t("verticalSliceNodeHasNoContent")}</p>}

              <div className="grid grid-cols-2 gap-2">
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <label key={key} className="space-y-1 text-xs text-muted">
                    <span>{t(`verticalSlice${key[0].toUpperCase()}${key.slice(1)}` as "verticalSliceX")}</span>
                    <Input type="number" value={selected.transform[key]} onChange={(event) => patchNumber(key, event.target.value)} />
                  </label>
                ))}
                <label className="space-y-1 text-xs text-muted">
                  <span>{t("verticalSliceFontSize")}</span>
                  <Input type="number" value={selected.style.fontSize ?? ""} onChange={(event) => patchNumber("fontSize", event.target.value)} />
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span>{t("verticalSliceLineHeight")}</span>
                  <Input type="number" step="0.1" value={selected.style.lineHeight ?? ""} onChange={(event) => patchNumber("lineHeight", event.target.value)} />
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span>{t("verticalSliceOpacity")}</span>
                  <Input type="number" min="0" max="1" step="0.05" value={selected.transform.opacity} onChange={(event) => patchNumber("opacity", event.target.value)} />
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span>{t("verticalSliceLayer")}</span>
                  <Input type="number" value={selected.zIndex} onChange={(event) => patchNumber("zIndex", event.target.value)} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-ink">
                <Checkbox checked={selected.visible} onCheckedChange={(checked) => patchSelected((node) => { node.visible = checked === true; })} />
                {t("verticalSliceVisible")}
              </label>
            </div>
          ) : <p className="text-sm text-muted">{t("verticalSliceSelectNode")}</p>}
        </TabsContent>

        <TabsContent value="layout" className="space-y-3">
          <p className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{t("verticalSliceLayoutDeferred")}</span>
          </p>
        </TabsContent>

        <TabsContent value="replace" className="space-y-3">
          <p className="flex items-start gap-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{t("verticalSliceReplacementDeferred")}</span>
          </p>
        </TabsContent>

        <div className="border-t border-line pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending || !isDirty}
              onClick={() => {
                setDoc(clone(savedDoc));
                setSelectedPath(firstEditableNodePath(savedDoc.nodes));
                setMessage("");
              }}
            >
              <RotateCcw className="size-4" />
              {t("verticalSliceReset")}
            </Button>
            <Button type="button" size="sm" disabled={pending || !isDirty} onClick={save}>
              <Save className="size-4" />
              {pending ? t("verticalSliceSaving") : t("verticalSliceSave")}
            </Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted" role="status" aria-live="polite">
            {message || t("verticalSliceReleaseImmutable")}
          </p>
        </div>
      </div>
    </Tabs>
  );

  return (
    <>
      {toolbarTarget ? createPortal(insertToolbar, toolbarTarget) : null}
      {tabsTarget ? createPortal(
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)}>
          <TabsList className="grid h-8 w-full grid-cols-3">
            <TabsTrigger value="adjust" className="px-2 text-xs">{t("prototypeTabAdjust")}</TabsTrigger>
            <TabsTrigger value="layout" className="px-2 text-xs">{t("prototypeTabLayout")}</TabsTrigger>
            <TabsTrigger value="replace" className="px-2 text-xs">{t("prototypeTabReplace")}</TabsTrigger>
          </TabsList>
        </Tabs>,
        tabsTarget,
      ) : null}
      {inspectorTarget ? createPortal(inspector, inspectorTarget) : null}
      <FittedCoursewareCanvas aspect={doc.canvas.width / doc.canvas.height}>
        <StagePreview
          doc={doc}
          bindingUrls={bindingUrls}
          stageMode="natural"
          className="size-full"
          selectedNodePath={selectedPath}
          onNodeSelect={setSelectedPath}
          onBackgroundSelect={() => {
            setSelectedPath(null);
            setMessage(t("verticalSliceBackgroundDeferred"));
          }}
        />
      </FittedCoursewareCanvas>
    </>
  );
}
