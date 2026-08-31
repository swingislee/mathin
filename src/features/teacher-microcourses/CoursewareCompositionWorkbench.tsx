"use client";

import {
  FileCode2,
  Gamepad2,
  ImagePlus,
  LoaderCircle,
  Save,
  Shapes,
  Sigma,
  Trash2,
  Type,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { CoursewareCompositionGridEditor } from "@/features/courseware-doc/CoursewareCompositionGridEditor";
import {
  CoursewareEditorBody,
  CoursewareEditorCanvasFrame,
  CoursewareEditorHeader,
  CoursewareEditorToolbar,
  CoursewareEditorToolbarButton,
  CoursewareEditorToolbarLabel,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import {
  addCoursewareCompositionGame,
  addCoursewareCompositionH5,
  addCoursewareCompositionNode,
  addCoursewareCompositionTool,
  removeCoursewareCompositionBlock,
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
import { microcourseH5Bytes, normalizeMicrocourseH5 } from "./h5";
import { MICROCOURSE_H5_CSP } from "@/features/courseware-doc/h5-shim";
import styles from "./CoursewareCompositionWorkbench.module.css";

const DEFAULT_H5 = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>课堂互动</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui; background: #fffaf1; color: #2d2a26; }
    button { padding: .75rem 1.25rem; border: 0; border-radius: 999px; background: #dd765c; color: white; font: inherit; }
  </style>
</head>
<body>
  <main><h1>课堂互动</h1><button id="start">开始</button></main>
  <script>document.querySelector('#start').addEventListener('click', () => alert('开始探索！'))</script>
</body>
</html>`;

function h5PreviewDocument(html: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${MICROCOURSE_H5_CSP}">`;
  return /<head[\s>]/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${csp}`)
    : `${csp}${html}`;
}

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

function nodeId(index: number) {
  return `teacher-${Date.now()}-${index}`;
}

function manualNode(kind: "text" | "formula" | "shape", index: number): DocNode {
  const formula = kind === "formula";
  const shape = kind === "shape";
  const id = nodeId(index);
  return {
    id,
    nodePath: id,
    sourceType: `teacher:${kind}`,
    sourceResourceId: null,
    adapter: shape ? "shape" : formula ? "rich_text" : "text",
    name: kind,
    supported: true,
    visible: true,
    interactive: false,
    zIndex: 1_000 + index,
    order: 1_000 + index,
    crop: null,
    transform: { x: 0, y: 0, width: 320, height: 240, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: true },
    style: { objectFit: "contain", backgroundColor: shape ? "#fff4dc" : null, color: "#2d2a26", borderColor: shape ? "#dd765c" : null, borderWidth: shape ? 2 : 0, borderRadius: shape ? 18 : 0, fontFamily: null, fontSize: formula ? 34 : 32, fontWeight: formula ? 600 : 500, lineHeight: 1.4, letterSpacing: null, whiteSpace: "pre-wrap", textAlign: "left", overflow: "hidden" },
    content: shape
      ? { kind: "shape", shapeType: "rectangle", svg: "" }
      : formula
        ? { kind: "rich_text", html: '<p><span class="math-tex">\\(x^2+y^2=z^2\\)</span></p>', sanitized: true }
        : { kind: "text", text: "新文本" },
    resources: [],
    children: [],
  };
}

function imageNode(bindingKey: string, index: number): DocNode {
  const id = nodeId(index);
  return {
    id,
    nodePath: id,
    sourceType: "teacher:image",
    sourceResourceId: null,
    adapter: "image",
    name: "image",
    supported: true,
    visible: true,
    interactive: false,
    zIndex: 1_000 + index,
    order: 1_000 + index,
    crop: null,
    transform: { x: 0, y: 0, width: 320, height: 320, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: true },
    style: { objectFit: "contain", backgroundColor: null, color: null, borderColor: null, borderWidth: 0, borderRadius: 0, fontFamily: null, fontSize: null, fontWeight: null, lineHeight: null, letterSpacing: null, whiteSpace: null, textAlign: null, overflow: "hidden" },
    content: null,
    resources: [{ bindingKey, bindingPath: "$.src", role: "image", kind: "image" }],
    children: [],
  };
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
}>(function CoursewareCompositionWorkbench({ microcourseId, page, onPersisted, onStatus }, ref) {
  const t = useTranslations("teacherMicrocourses");
  const [doc, setDoc] = useState(() => structuredClone(page.doc));
  const [bindingUrls, setBindingUrls] = useState({ ...page.bindingUrls });
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(page.doc.layout.blocks[0]?.id ?? null);
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

  const rename = useCallback((value: string) => {
    titleRef.current = value;
    markDirty();
  }, [markDirty]);

  useEffect(() => { flushRef.current = flush; }, [flush]);
  useImperativeHandle(ref, () => ({ flush, rename }), [flush, rename]);

  const updateDoc = useCallback((next: CoursewareCompositionPage | ((current: CoursewareCompositionPage) => CoursewareCompositionPage)) => {
    const value = typeof next === "function" ? next(docRef.current) : next;
    docRef.current = value;
    setDoc(value);
    markDirty();
  }, [markDirty]);

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
    const node = manualNode(kind, docRef.current.overlay.nodes.length + 1);
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
      const node = imageNode(result.data.bindingKey, docRef.current.overlay.nodes.length + 1);
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
  const patchSelectedNode = (updater: (node: DocNode) => void) => updateDoc((current) => {
    if (!selected || selected.type !== "node") return current;
    const next = structuredClone(current);
    const node = next.overlay.nodes.find((item) => item.id === selected.nodeId);
    if (!node) return current;
    updater(node);
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

  const saveLabel = saveState === "saving" ? t("pageAutosaving")
    : saveState === "dirty" ? t("pageUnsaved")
      : saveState === "error" ? t("pageAutosaveFailed")
        : t("pageAutosaved");

  return (
    <div
      data-courseware-editor-adapter="courseware-composition-v1"
      className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", styles.workbench)}
    >
      <CoursewareEditorHeader className="px-3 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <CoursewareEditorToolbar aria-label={t("componentPanelTitle")}>
            <CoursewareEditorToolbarButton aria-label={t("componentText")} title={t("componentText")} onClick={() => addNode("text")}><Type className="size-4" /></CoursewareEditorToolbarButton>
            <CoursewareEditorToolbarButton aria-label={t("componentFormula")} title={t("componentFormula")} onClick={() => addNode("formula")}><Sigma className="size-4" /></CoursewareEditorToolbarButton>
            <CoursewareEditorToolbarButton aria-label={t("componentShape")} title={t("componentShape")} onClick={() => addNode("shape")}><Shapes className="size-4" /></CoursewareEditorToolbarButton>
            <CoursewareEditorToolbarLabel aria-label={t("componentImage")} title={t("componentImage")}>
              <Input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={pending} onChange={(event) => uploadImage(event.target.files?.[0] ?? null)} />
              <ImagePlus className="size-4" />
            </CoursewareEditorToolbarLabel>
            <GameComponentDialog microcourseId={microcourseId} disabled={pending} iconOnly onCreated={(game) => {
              const previousIds = new Set(docRef.current.layout.blocks.map((block) => block.id));
              const next = addCoursewareCompositionGame(docRef.current, game);
              updateDoc(next);
              setSelectedBlockId(next.layout.blocks.find((block) => !previousIds.has(block.id))?.id ?? null);
            }} />
            <H5ComponentDialog microcourseId={microcourseId} disabled={pending} iconOnly onSaved={(h5) => {
              const previousIds = new Set(docRef.current.layout.blocks.map((block) => block.id));
              const next = addCoursewareCompositionH5(docRef.current, h5);
              updateDoc(next);
              setSelectedBlockId(next.layout.blocks.find((block) => !previousIds.has(block.id))?.id ?? null);
            }} />
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
          </CoursewareEditorToolbar>
          <div className="flex shrink-0 items-center gap-2">
            <span data-testid="microcourse-autosave-status" role="status" aria-live="polite" className={cn("inline-flex items-center gap-1 text-xs", saveState === "error" ? "text-rose" : "text-muted")}>
              {saveState === "saving" && <LoaderCircle className="size-3.5 animate-spin" />}{saveLabel}
            </span>
            <Button type="button" size="sm" variant="secondary" className="size-9 p-0" aria-label={t("saveNow")} title={t("saveNow")} disabled={pending || saveState === "saving"} onClick={() => void flush()}>
              <Save className="size-4" />
            </Button>
          </div>
        </div>
        {message && <p role="alert" className="mt-2 text-xs text-rose">{message}</p>}
      </CoursewareEditorHeader>
      <CoursewareEditorBody className={cn("gap-3 p-3", styles.body)}>
        <div className={cn("flex min-h-0 min-w-0 items-center justify-center", styles.stageSlot)}>
          <CoursewareEditorCanvasFrame className={styles.stageFrame}>
            <CoursewareCompositionGridEditor
              doc={doc}
              bindingUrls={bindingUrls}
              selectedBlockId={selectedBlockId}
              onSelectBlock={setSelectedBlockId}
              onChange={updateDoc}
            />
          </CoursewareEditorCanvasFrame>
        </div>
        <ScrollArea className="min-h-0 rounded-xl border border-line">
          <div className="space-y-4 p-3">
            <div>
              <p className="text-xs font-medium text-muted">{t("gridComponentList")}</p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {doc.layout.blocks.map((block) => (
                  <Button key={block.id} type="button" size="sm" variant={selectedBlockId === block.id ? "primary" : "ghost"} className="justify-start truncate" onClick={() => setSelectedBlockId(block.id)}>
                    {blockLabel(block, doc, t)}
                  </Button>
                ))}
              </div>
              {doc.layout.blocks.length === 0 && <p className="mt-2 text-xs text-muted">{t("componentEmpty")}</p>}
            </div>

            {selected?.type === "node" ? (
              <NodeControls doc={doc} block={selected} patch={patchSelectedNode} />
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
      </CoursewareEditorBody>
    </div>
  );
});

function NodeControls({ doc, block, patch }: {
  doc: CoursewareCompositionPage;
  block: Extract<CoursewareCompositionBlock, { type: "node" }>;
  patch: (updater: (node: DocNode) => void) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const node = doc.overlay.nodes.find((item) => item.id === block.nodeId);
  if (!node) return null;
  return (
    <div className="space-y-3 border-t border-line pt-3">
      {node.content?.kind === "text" && (
        <Label className="grid gap-1"><span>{t("gridTextContent")}</span><Textarea value={node.content.text ?? ""} rows={5} onChange={(event) => patch((item) => { if (item.content?.kind === "text") item.content.text = event.target.value; })} /></Label>
      )}
      {node.content?.kind === "rich_text" && (
        <Label className="grid gap-1"><span>{t("richTextFormula")}</span><Textarea value={node.content.html ?? ""} rows={6} className="font-mono text-xs" onChange={(event) => patch((item) => { if (item.content?.kind === "rich_text") item.content.html = event.target.value; })} /><span className="text-xs font-normal text-muted">{t("formulaHint")}</span></Label>
      )}
      {(node.content?.kind === "text" || node.content?.kind === "rich_text") && (
        <Label className="grid gap-1"><span>{t("fontSize")}</span><Input type="number" min={12} max={96} value={node.style.fontSize ?? 28} onChange={(event) => patch((item) => { item.style.fontSize = Number(event.target.value); })} /></Label>
      )}
      <Label className="grid gap-1"><span>{t("color")}</span><Input type="color" value={node.style.color ?? "#2d2a26"} onChange={(event) => patch((item) => { item.style.color = event.target.value; })} /></Label>
    </div>
  );
}

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
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState(DEFAULT_H5);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!open || !existing) return;
    let active = true;
    loadTeacherMicrocourseH5HtmlAction(existing.artifactId).then((value) => {
      if (active) setHtml(value);
    }).catch(() => {
      if (active) setMessage(t("h5LoadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [existing, open, t]);
  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    setMessage("");
    setLoading(Boolean(nextOpen && existing));
  };
  const save = () => startTransition(async () => {
    const result = await createTeacherH5ComponentArtifactAction({ microcourseId, html });
    if (!result.ok) {
      setMessage(t("actionFailed", { code: result.code }));
      return;
    }
    onSaved(result.data.h5);
    setOpen(false);
  });
  const bytes = microcourseH5Bytes(normalizeMicrocourseH5(html)).byteLength;
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>{iconOnly
        ? <CoursewareEditorToolbarButton aria-label={existing ? t("editH5Component") : t("componentH5")} title={existing ? t("editH5Component") : t("componentH5")} disabled={disabled}><FileCode2 className="size-4" /></CoursewareEditorToolbarButton>
        : <Button type="button" size="sm" variant="secondary" className={cn(existing && "w-full")} aria-label={existing ? t("editH5Component") : t("componentH5")} title={existing ? t("editH5Component") : t("componentH5")} disabled={disabled}><FileCode2 className="size-4" />{existing ? t("editH5Component") : t("componentH5")}</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>{existing ? t("editH5Component") : t("insertH5ComponentTitle")}</DialogTitle><DialogDescription>{t("h5SecurityHint")}</DialogDescription></DialogHeader>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Label className="grid gap-1"><span>{t("html")}</span><Textarea value={html} onChange={(event) => setHtml(event.target.value)} rows={20} className="font-mono text-xs" disabled={loading} /></Label>
          <div className="overflow-hidden rounded-lg border border-line bg-white"><iframe title={t("h5LivePreview")} sandbox="allow-scripts" srcDoc={h5PreviewDocument(html)} className="aspect-[4/3] w-full border-0" /></div>
        </div>
        <p className="text-xs text-muted">{bytes} / 5 MiB</p>
        {message && <p role="alert" className="text-sm text-rose">{message}</p>}
        <DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={pending || loading || !html.trim()} onClick={save}>{pending && <LoaderCircle className="size-4 animate-spin" />}{existing ? t("saveNow") : t("insertComponent")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
