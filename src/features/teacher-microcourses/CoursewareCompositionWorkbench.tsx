"use client";

import {
  Gamepad2,
  ImagePlus,
  LoaderCircle,
  Trash2,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoursewareCompositionGridEditor } from "@/features/courseware-doc/CoursewareCompositionGridEditor";
import { CoursewareEditorAdapterSurface } from "@/features/courseware-doc/CoursewareEditorAdapterSurface";
import {
  coursewareTextValue,
  isCoursewareTextElement,
  setCoursewareTextValue,
} from "@/features/courseware-doc/CoursewareTextElementEditor";
import {
  CoursewareLayerPanel,
  CoursewarePageElementInspector,
  type CoursewareLayerItem,
} from "@/features/courseware-doc/CoursewarePageElementEditor";
import {
  CoursewareEditorSaveControls,
  CoursewareEditorToolbarButton,
  CoursewareEditorToolbarLabel,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { CoursewarePageEditorToolbar } from "@/features/courseware-doc/CoursewarePageEditorToolbar";
import { CoursewareH5AuthoringDialog } from "@/features/courseware-doc/CoursewareH5AuthoringDialog";
import {
  createCoursewareInsertedImageNode,
  createCoursewareInsertedNode,
} from "@/features/courseware-doc/courseware-inserted-node";
import { useCoursewareEditHistory } from "@/features/courseware-doc/useCoursewareEditHistory";
import {
  addCoursewareCompositionGame,
  addCoursewareCompositionH5,
  addCoursewareCompositionNode,
  addCoursewareCompositionTool,
  removeCoursewareCompositionBlock,
  updateCoursewareCompositionNodeTransform,
} from "@/features/courseware-doc/composition-page-layout";
import {
  coursewareCompositionPageSchema,
  type CoursewareCompositionBlock,
  type CoursewareCompositionH5,
  type CoursewareCompositionPage,
  type CoursewareCompositionTool,
} from "@/features/courseware-doc/composition-page-schema";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import type { DocNode } from "@/features/courseware-doc/schema";
import type { DocNodeTransformPatch } from "@/features/courseware-doc/DocStage";
import { GamePageEditor } from "@/features/games/courseware/GamePageEditor";
import { gameCoursewareContractsForSurface } from "@/features/games/courseware/registry";
import { getGame } from "@/features/games/registry";
import { toolCoursewareContractsForSurface } from "@/features/tools/courseware/registry";
import { getTool } from "@/features/tools/registry";
import { cn } from "@/lib/utils";
import {
  createTeacherGameComponentAction,
  createTeacherH5ComponentArtifactAction,
  loadTeacherMicrocourseH5HtmlAction,
  saveTeacherMicrocoursePageAction,
  uploadTeacherMicrocourseImageAction,
} from "./actions";

export interface CoursewareCompositionWorkbenchHandle {
  flush: () => Promise<boolean>;
  rename?: (title: string) => void;
}

interface PersistedCompositionPage {
  pageDocId: string;
  title: string;
  doc: CoursewareCompositionPage;
  revisionNo: number;
}

function blockLabel(
  block: CoursewareCompositionBlock,
  doc: CoursewareCompositionPage,
  t: ReturnType<typeof useTranslations<"teacherMicrocourses">>,
) {
  if (block.type === "game") return t("componentGame");
  if (block.type === "h5") return t("componentH5");
  if (block.type === "tool") return t("componentTool");
  const node = doc.overlay.nodes.find((item) => item.id === block.nodeId);
  if (node?.adapter === "image") return t("componentImage");
  if (node?.adapter === "rich_text") return t("componentFormula");
  if (node?.adapter === "shape") return t("componentShape");
  return t("componentText");
}

export const CoursewareCompositionWorkbench = forwardRef<CoursewareCompositionWorkbenchHandle, {
  microcourseId: string;
  page: {
    pageDocId: string;
    title: string;
    revisionNo: number;
    doc: CoursewareCompositionPage;
    bindingUrls: Record<string, string>;
  };
  onPersisted: (draft: PersistedCompositionPage) => void;
  onStatus: (message: string) => void;
}>(function CoursewareCompositionWorkbench({
  microcourseId,
  page,
  onPersisted,
  onStatus,
}, ref) {
  const t = useTranslations("teacherMicrocourses");
  const elementEditorT = useTranslations("coursewareElementEditor");
  const [doc, setDoc] = useState(() => structuredClone(page.doc));
  const [bindingUrls, setBindingUrls] = useState({ ...page.bindingUrls });
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(page.doc.layout.blocks[0]?.id ?? null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [pending, startTransition] = useTransition();
  const titleRef = useRef(page.title);
  const docRef = useRef(structuredClone(page.doc));
  const revisionRef = useRef(page.revisionNo);
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const flush = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      const previousSaved = await savingRef.current;
      if (!previousSaved) return false;
    }
    if (savedSequenceRef.current === sequenceRef.current) return true;
    if (!titleRef.current.trim()) {
      setSaveState("error");
      setMessage(t("pageAutosaveFailed"));
      onStatus(t("pageAutosaveFailed"));
      return false;
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const sequence = sequenceRef.current;
    const titleSnapshot = titleRef.current;
    const docSnapshot = coursewareCompositionPageSchema.parse(structuredClone(docRef.current));
    setSaveState("saving");
    const request = saveTeacherMicrocoursePageAction({
      pageDocId: page.pageDocId,
      doc: docSnapshot,
      baseRevisionNo: revisionRef.current,
      title: titleSnapshot,
      note: "",
    }).then((result) => {
      if (!result.ok || result.data.doc.docVersion !== "courseware-composition-v1") {
        setSaveState("error");
        setMessage(t("actionFailed", { code: result.ok ? "INVALID_PAGE_DOC" : result.code }));
        onStatus(t("pageAutosaveFailed"));
        return false;
      }
      revisionRef.current = result.data.revisionNo;
      savedSequenceRef.current = sequence;
      docRef.current = structuredClone(result.data.doc);
      setDoc(result.data.doc);
      setMessage("");
      onPersisted({
        pageDocId: page.pageDocId,
        title: titleSnapshot,
        doc: result.data.doc,
        revisionNo: result.data.revisionNo,
      });
      if (sequenceRef.current === sequence) setSaveState("saved");
      else {
        setSaveState("dirty");
        timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
      }
      return true;
    }).catch(() => {
      setSaveState("error");
      setMessage(t("pageAutosaveFailed"));
      onStatus(t("pageAutosaveFailed"));
      return false;
    }).finally(() => {
      savingRef.current = null;
    });
    savingRef.current = request;
    return request;
  }, [onPersisted, onStatus, page.pageDocId, t]);

  const markDirty = useCallback(() => {
    sequenceRef.current += 1;
    setSaveState("dirty");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
  }, []);

  const restoreFromHistory = useCallback((value: CoursewareCompositionPage) => {
    docRef.current = value;
    setDoc(value);
    setSelectedBlockId(null);
    markDirty();
  }, [markDirty]);
  const editHistory = useCoursewareEditHistory({
    currentRef: docRef,
    restore: restoreFromHistory,
  });

  const rename = useCallback((value: string) => {
    titleRef.current = value;
    markDirty();
  }, [markDirty]);

  useEffect(() => { flushRef.current = flush; }, [flush]);
  useImperativeHandle(ref, () => ({ flush, rename }), [flush, rename]);

  const updateDoc = useCallback((next: CoursewareCompositionPage | ((current: CoursewareCompositionPage) => CoursewareCompositionPage), historyGroup = "document") => {
    const previous = docRef.current;
    const value = typeof next === "function" ? next(previous) : next;
    if (value === previous) return;
    editHistory.record(previous, historyGroup);
    docRef.current = value;
    setDoc(value);
    markDirty();
  }, [editHistory, markDirty]);

  useEffect(() => {
    const visibility = () => { if (document.visibilityState === "hidden") void flushRef.current(); };
    const beforeUnload = () => void flushRef.current();
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", visibility);
      void flushRef.current();
    };
  }, []);

  const addNode = (kind: "text" | "formula" | "shape") => {
    const node = createCoursewareInsertedNode(
      kind,
      docRef.current.overlay.nodes.length + 1,
      docRef.current.canvas,
    );
    const next = addCoursewareCompositionNode(docRef.current, node, {
      columnSpan: kind === "shape" ? 4 : 6,
      rowSpan: 3,
    });
    if (next === docRef.current) {
      setMessage(t("componentNoSpace"));
      return;
    }
    updateDoc(next);
    setSelectedBlockId(`node-${node.id}`);
  };

  const uploadImage = (file: File | null) => {
    if (!file) return;
    startTransition(async () => {
      const result = await uploadTeacherMicrocourseImageAction({
        microcourseId,
        pageDocId: page.pageDocId,
        file,
      });
      if (!result.ok) {
        setMessage(t("actionFailed", { code: result.code }));
        return;
      }
      setBindingUrls((current) => ({ ...current, [result.data.bindingKey]: result.data.url }));
      const node = createCoursewareInsertedImageNode(
        result.data.bindingKey,
        docRef.current.overlay.nodes.length + 1,
        docRef.current.canvas,
      );
      const next = addCoursewareCompositionNode(docRef.current, node, { columnSpan: 4, rowSpan: 4 });
      if (next === docRef.current) {
        setMessage(t("componentNoSpace"));
        return;
      }
      updateDoc(next);
      setSelectedBlockId(`node-${node.id}`);
    });
  };

  const selected = doc.layout.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedNode = selected?.type === "node"
    ? doc.overlay.nodes.find((item) => item.id === selected.nodeId) ?? null
    : null;
  const layerItems = useMemo<CoursewareLayerItem[]>(() => doc.layout.blocks.map((block, index) => {
    const node = block.type === "node"
      ? doc.overlay.nodes.find((item) => item.id === block.nodeId) ?? null
      : null;
    const kind = blockLabel(block, doc, t);
    return {
      id: block.id,
      label: node?.name?.trim() || `${kind} ${index + 1}`,
      kind,
      layer: node?.zIndex ?? index,
      visible: node?.visible,
    };
  }), [doc, t]);
  const patchSelectedNode = (updater: (node: DocNode) => void) => updateDoc((current) => {
    if (!selected || selected.type !== "node") return current;
    const next = structuredClone(current);
    const node = next.overlay.nodes.find((item) => item.id === selected.nodeId);
    if (!node) return current;
    updater(node);
    return coursewareCompositionPageSchema.parse(next);
  });
  const handleNodeTransformChange = useCallback((nodePath: string, patch: DocNodeTransformPatch) => {
    updateDoc((current) => updateCoursewareCompositionNodeTransform(current, nodePath, patch, snapToGrid));
  }, [snapToGrid, updateDoc]);
  const handleNodeTextChange = useCallback((nodePath: string, value: string) => {
    updateDoc((current) => {
      const currentNode = current.overlay.nodes.find((node) => node.nodePath === nodePath);
      if (!currentNode || !isCoursewareTextElement(currentNode) || coursewareTextValue(currentNode) === value) return current;
      const next = structuredClone(current);
      const node = next.overlay.nodes.find((item) => item.nodePath === nodePath);
      if (!node) return current;
      setCoursewareTextValue(node, value);
      return coursewareCompositionPageSchema.parse(next);
    });
  }, [updateDoc]);
  const patchBlockLayer = (blockId: string, layer: number) => updateDoc((current) => {
    const block = current.layout.blocks.find((item) => item.id === blockId);
    if (!block) return current;
    if (block.type === "node") {
      const next = structuredClone(current);
      const node = next.overlay.nodes.find((item) => item.id === block.nodeId);
      if (!node || node.zIndex === layer) return current;
      node.zIndex = layer;
      return coursewareCompositionPageSchema.parse(next);
    }
    const from = current.layout.blocks.findIndex((item) => item.id === blockId);
    const to = Math.max(0, Math.min(current.layout.blocks.length - 1, layer));
    if (from === to) return current;
    const next = structuredClone(current);
    const [moved] = next.layout.blocks.splice(from, 1);
    next.layout.blocks.splice(to, 0, moved);
    return coursewareCompositionPageSchema.parse(next);
  });
  const patchBlockVisibility = (blockId: string, visible: boolean) => updateDoc((current) => {
    const block = current.layout.blocks.find((item) => item.id === blockId);
    if (!block || block.type !== "node") return current;
    const next = structuredClone(current);
    const node = next.overlay.nodes.find((item) => item.id === block.nodeId);
    if (!node || node.visible === visible) return current;
    node.visible = visible;
    return coursewareCompositionPageSchema.parse(next);
  });
  const patchSelectedGame = (game: GamePageDoc) => updateDoc((current) => {
    if (!selected || selected.type !== "game") return current;
    const next = structuredClone(current);
    const block = next.layout.blocks.find((item) => item.id === selected.id);
    if (!block || block.type !== "game") return current;
    const embedded = structuredClone(game);
    delete embedded.layout;
    block.game = embedded;
    return coursewareCompositionPageSchema.parse(next);
  });
  const replaceSelectedH5 = (h5: CoursewareCompositionH5) => updateDoc((current) => {
    if (!selected || selected.type !== "h5") return current;
    const next = structuredClone(current);
    const block = next.layout.blocks.find((item) => item.id === selected.id);
    if (!block || block.type !== "h5") return current;
    block.h5 = h5;
    return coursewareCompositionPageSchema.parse(next);
  });
  const removeSelected = () => {
    if (!selected) return;
    updateDoc(removeCoursewareCompositionBlock(docRef.current, selected.id));
    setSelectedBlockId(null);
  };

  const insertToolbar = (
    <CoursewarePageEditorToolbar
      canUndo={editHistory.canUndo}
      canRedo={editHistory.canRedo}
      onUndo={editHistory.undo}
      onRedo={editHistory.redo}
      snapToGrid={snapToGrid}
      onSnapToGridChange={setSnapToGrid}
      insertions={{
        text: () => addNode("text"),
        formula: () => addNode("formula"),
        shape: () => addNode("shape"),
        image: (
          <CoursewareEditorToolbarLabel aria-label={t("componentImage")} title={t("componentImage")}>
              <Input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={pending} onChange={(event) => uploadImage(event.target.files?.[0] ?? null)} />
              <ImagePlus className="size-4" />
          </CoursewareEditorToolbarLabel>
        ),
        game: (
          <GameComponentDialog microcourseId={microcourseId} disabled={pending} iconOnly onCreated={(game) => {
              const previousIds = new Set(docRef.current.layout.blocks.map((block) => block.id));
              const next = addCoursewareCompositionGame(docRef.current, game);
              updateDoc(next);
              setSelectedBlockId(next.layout.blocks.find((block) => !previousIds.has(block.id))?.id ?? null);
          }} />
        ),
        h5: (
          <H5ComponentDialog microcourseId={microcourseId} disabled={pending} iconOnly onSaved={(h5) => {
              const previousIds = new Set(docRef.current.layout.blocks.map((block) => block.id));
              const next = addCoursewareCompositionH5(docRef.current, h5);
              updateDoc(next);
              setSelectedBlockId(next.layout.blocks.find((block) => !previousIds.has(block.id))?.id ?? null);
          }} />
        ),
        tool: (
          <ToolComponentDialog disabled={pending} onCreated={(tool) => {
              const previousIds = new Set(docRef.current.layout.blocks.map((block) => block.id));
              const next = addCoursewareCompositionTool(docRef.current, tool);
              if (next === docRef.current) {
                setMessage(t("componentNoSpace"));
                return;
              }
              updateDoc(next);
              setSelectedBlockId(next.layout.blocks.find((block) => !previousIds.has(block.id))?.id ?? null);
          }} />
        ),
      }}
    />
  );

  const saveControls = (
    <CoursewareEditorSaveControls
      state={saveState}
      labels={{
        saved: t("pageAutosaved"),
        saving: t("pageAutosaving"),
        dirty: t("pageUnsaved"),
        error: t("pageAutosaveFailed"),
        saveNow: t("saveNow"),
      }}
      onSave={() => void flush()}
      disabled={pending}
      statusTestId="microcourse-autosave-status"
      className="w-auto"
    />
  );

  const inspectorHeader = (
    <h2 className="text-sm font-medium text-ink">{elementEditorT("panelTitle")}</h2>
  );

  const inspectorContent = (
    <ScrollArea className="size-full min-h-0">
      <div className="space-y-4 p-3">
        {message && <p role="alert" className="text-xs text-rose">{message}</p>}
            <CoursewareLayerPanel
              items={layerItems}
              selectedId={selectedBlockId}
              onSelect={setSelectedBlockId}
              onLayerChange={patchBlockLayer}
              onVisibilityChange={patchBlockVisibility}
            />

            {selectedNode ? (
              <CoursewarePageElementInspector
                node={selectedNode}
                onPatch={patchSelectedNode}
                onTransformChange={(patch) => handleNodeTransformChange(selectedNode.nodePath, patch)}
              />
            ) : null}
            {selected?.type === "game" ? (
              <div className="border-t border-line pt-3">
                <GamePageEditor doc={selected.game} onChange={patchSelectedGame} embedded />
              </div>
            ) : null}
            {selected?.type === "h5" ? (
              <div className="space-y-2 border-t border-line pt-3">
                <H5ComponentDialog microcourseId={microcourseId} existing={selected.h5} onSaved={replaceSelectedH5} />
                <p className="text-xs text-muted">{t("componentH5ClassroomReadOnly")}</p>
              </div>
            ) : null}
            {selected?.type === "tool" ? (
              <div className="space-y-2 border-t border-line pt-3">
                <p className="text-sm font-medium text-ink">{selected.tool.toolId}</p>
                <p className="text-xs text-muted">{t("componentToolClassroomReadOnly")}</p>
              </div>
            ) : null}
            {selected ? (
              <Button type="button" size="sm" variant="ghost" className="w-full text-rose" onClick={removeSelected}>
                <Trash2 className="size-4" />{t("gridDeleteComponent")}
              </Button>
            ) : null}
      </div>
    </ScrollArea>
  );

  return (
    <CoursewareEditorAdapterSurface
      toolbar={insertToolbar}
      saveControls={saveControls}
      inspectorHeader={inspectorHeader}
      inspector={inspectorContent}
      aspect={4 / 3}
      className="p-3"
      stageClassName="rounded-xl border border-line bg-white shadow-sm"
      hostProps={{ "data-courseware-editor-adapter": "courseware-composition-v1" }}
    >
      <CoursewareCompositionGridEditor
        doc={doc}
        bindingUrls={bindingUrls}
        selectedBlockId={selectedBlockId}
        onSelectBlock={setSelectedBlockId}
        onChange={updateDoc}
        onNodeTransformChange={handleNodeTransformChange}
        onNodeTextChange={handleNodeTextChange}
        snapToGrid={snapToGrid}
      />
    </CoursewareEditorAdapterSurface>
  );
});

function GameComponentDialog({ microcourseId, disabled = false, iconOnly = false, onCreated }: {
  microcourseId: string;
  disabled?: boolean;
  iconOnly?: boolean;
  onCreated: (game: GamePageDoc) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const tGames = useTranslations("games");
  const contracts = gameCoursewareContractsForSurface("microcourse");
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(contracts[0] ? `${contracts[0].gameId}:${contracts[0].contentVersion}` : "");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const selected = contracts.find((contract) => `${contract.gameId}:${contract.contentVersion}` === selectedKey);
  const create = () => startTransition(async () => {
    if (!selected) return;
    const result = await createTeacherGameComponentAction({ microcourseId, gameId: selected.gameId, contentVersion: selected.contentVersion });
    if (!result.ok) {
      setMessage(t("actionFailed", { code: result.code }));
      return;
    }
    onCreated(result.data.game);
    setOpen(false);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{iconOnly
        ? <CoursewareEditorToolbarButton aria-label={t("componentGame")} title={t("componentGame")} disabled={disabled || contracts.length === 0}><Gamepad2 className="size-4" /></CoursewareEditorToolbarButton>
        : <Button type="button" size="sm" variant="secondary" aria-label={t("componentGame")} title={t("componentGame")} disabled={disabled || contracts.length === 0}><Gamepad2 className="size-4" />{t("componentGame")}</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t("insertGameComponentTitle")}</DialogTitle><DialogDescription>{t("gameAuthoringHint")}</DialogDescription></DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {contracts.map((contract) => {
            const game = getGame(contract.gameId);
            const Icon = game?.icon ?? Gamepad2;
            const key = `${contract.gameId}:${contract.contentVersion}`;
            return <Button key={key} type="button" variant="secondary" aria-pressed={selectedKey === key} className={cn("h-auto justify-start rounded-xl px-4 py-3", selectedKey === key && "border-crater bg-moon/30")} onClick={() => setSelectedKey(key)}><Icon className="size-4" />{tGames(`items.${contract.gameId}.name`)}</Button>;
          })}
        </div>
        {message && <p role="alert" className="text-sm text-rose">{message}</p>}
        <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={pending || !selected} onClick={create}>{pending && <LoaderCircle className="size-4 animate-spin" />}{t("insertComponent")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToolComponentDialog({ disabled = false, onCreated }: {
  disabled?: boolean;
  onCreated: (tool: CoursewareCompositionTool) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const tTools = useTranslations("tools");
  const contracts = toolCoursewareContractsForSurface("microcourse");
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(
    contracts[0] ? `${contracts[0].toolId}:${contracts[0].contentVersion}` : "",
  );
  const selected = contracts.find((contract) => (
    `${contract.toolId}:${contract.contentVersion}` === selectedKey
  ));
  const insert = () => {
    if (!selected) return;
    onCreated({ toolId: selected.toolId, contentVersion: selected.contentVersion });
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <CoursewareEditorToolbarButton aria-label={t("componentTool")} title={t("componentTool")} disabled={disabled || contracts.length === 0}>
          <Wrench className="size-4" />
        </CoursewareEditorToolbarButton>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("insertToolComponentTitle")}</DialogTitle>
          <DialogDescription>{t("toolAuthoringHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {contracts.map((contract) => {
            const tool = getTool(contract.toolId);
            const Icon = tool?.icon ?? Wrench;
            const key = `${contract.toolId}:${contract.contentVersion}`;
            return (
              <Button key={key} type="button" variant="secondary" aria-pressed={selectedKey === key} className={cn("h-auto justify-start rounded-xl px-4 py-3", selectedKey === key && "border-crater bg-moon/30")} onClick={() => setSelectedKey(key)}>
                <Icon className="size-4" />
                {tTools(`items.${contract.toolId}.name`)}
              </Button>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <Button type="button" disabled={!selected} onClick={insert}>{t("insertComponent")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function H5ComponentDialog({ microcourseId, disabled = false, iconOnly = false, existing, onSaved }: {
  microcourseId: string;
  disabled?: boolean;
  iconOnly?: boolean;
  existing?: CoursewareCompositionH5;
  onSaved: (h5: CoursewareCompositionH5) => void;
}) {
  return (
    <CoursewareH5AuthoringDialog
      disabled={disabled}
      iconOnly={iconOnly}
      existing={Boolean(existing)}
      loadHtml={existing ? () => loadTeacherMicrocourseH5HtmlAction(existing.artifactId) : undefined}
      submit={async (html) => {
        const result = await createTeacherH5ComponentArtifactAction({ microcourseId, html });
        return result.ok
          ? { ok: true, data: result.data.h5 }
          : { ok: false, code: result.code };
      }}
      onSaved={onSaved}
    />
  );
}
