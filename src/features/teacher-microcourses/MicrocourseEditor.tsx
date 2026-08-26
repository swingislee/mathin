"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileCode2,
  ImagePlus,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Send,
  Shapes,
  Sigma,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MicrocoursePageDoc } from "@/features/courseware-doc/microcourse-schema";
import type { DocNode, PageDoc } from "@/features/courseware-doc/schema";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { analyzeSudokuPuzzle } from "@/features/games/sudoku/logic";
import { useRouter } from "@/i18n/navigation";
import {
  createTeacherCompositionPageAction,
  createTeacherH5PageAction,
  createTeacherSudokuPageAction,
  deleteTeacherMicrocoursePageAction,
  freezeTeacherMicrocourseSourceSessionAction,
  loadTeacherMicrocourseH5HtmlAction,
  reorderTeacherMicrocoursePagesAction,
  saveTeacherMicrocourseMetadataAction,
  saveTeacherMicrocoursePageAction,
  submitTeacherMicrocourseReviewAction,
  updateTeacherH5PageAction,
  uploadTeacherMicrocourseImageAction,
  withdrawTeacherMicrocourseAction,
  withdrawTeacherMicrocourseReviewAction,
} from "./actions";
import type { TeacherMicrocourseEditor as EditorData, TeacherMicrocoursePage, TeacherMicrocourseSourcePage } from "./data";
import { MicrocourseSourcePicker } from "./MicrocourseSourcePicker";

const NONE = "__none__";
const DEFAULT_H5 = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>互动微课</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui; background: #fffaf1; color: #2d2a26; }
    button { padding: .75rem 1.25rem; border: 0; border-radius: 999px; background: #dd765c; color: white; font: inherit; }
  </style>
</head>
<body>
  <main><h1>我的互动微课</h1><button id="start">开始</button></main>
  <script>document.querySelector('#start').addEventListener('click', () => alert('开始探索！'))</script>
</body>
</html>`;

function clone<T>(value: T): T {
  return structuredClone(value);
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
    zIndex: 1000 + index,
    order: 1000 + index,
    crop: null,
    transform: { x: 90, y: 90, width: shape ? 260 : 520, height: shape ? 180 : 100, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: false },
    style: { objectFit: "contain", backgroundColor: shape ? "#fff4dc" : null, color: "#2d2a26", borderColor: shape ? "#dd765c" : null, borderWidth: shape ? 2 : 0, borderRadius: shape ? 18 : 0, fontFamily: null, fontSize: formula ? 34 : 32, fontWeight: formula ? 600 : 500, lineHeight: 1.4, letterSpacing: null, whiteSpace: "pre-wrap", textAlign: "left", overflow: "visible" },
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
    zIndex: 1000 + index,
    order: 1000 + index,
    crop: null,
    transform: { x: 120, y: 120, width: 420, height: 300, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0, opacity: 1, flipX: false, flipY: false, clip: false },
    style: { objectFit: "contain", backgroundColor: null, color: null, borderColor: null, borderWidth: 0, borderRadius: 0, fontFamily: null, fontSize: null, fontWeight: null, lineHeight: null, letterSpacing: null, whiteSpace: null, textAlign: null, overflow: "hidden" },
    content: null,
    resources: [{ bindingKey, bindingPath: "$.src", role: "image", kind: "image" }],
    children: [],
  };
}

function pageModeLabel(page: TeacherMicrocoursePage, t: (key: string) => string) {
  return t(`mode_${page.doc.mode}`);
}

export function MicrocourseEditor({
  session,
  editor,
  initialSources,
}: {
  session: { id: string; title: string; classroomId: string; coursewareFrozenAt: string | null };
  editor: EditorData;
  initialSources: TeacherMicrocourseSourcePage[];
}) {
  const t = useTranslations("teacherMicrocourses");
  const locale = useLocale();
  const router = useRouter();
  const metadata = editor.draftMetadata!;
  const [title, setTitle] = useState(metadata.title);
  const [description, setDescription] = useState(metadata.description);
  const [grade, setGrade] = useState(metadata.grade);
  const [courseSeason, setCourseSeason] = useState<number | null>(metadata.courseSeason);
  const [classType, setClassType] = useState(metadata.classType);
  const [primaryTopicSlug, setPrimaryTopicSlug] = useState(metadata.primaryTopicSlug);
  const [keywords, setKeywords] = useState(metadata.keywords.join(", "));
  const [reviewNote, setReviewNote] = useState("");
  const [message, setMessage] = useState("");
  const [selectedPageId, setSelectedPageId] = useState<string | null>(editor.pages[0]?.pageDocId ?? null);
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentPage = editor.pages.find((page) => page.pageDocId === selectedPageId) ?? editor.pages[0] ?? null;
  const stage = editor.workflow?.stage ?? "idle";
  const inReview = stage === "in_review" || stage === "ready_to_publish";
  const published = Boolean(editor.publishedMetadataRevisionId && editor.currentReleaseId);

  const refresh = (nextMessage?: string) => {
    if (nextMessage) setMessage(nextMessage);
    router.refresh();
  };
  const saveMetadata = () => startTransition(async () => {
    const result = await saveTeacherMicrocourseMetadataAction({
      microcourseId: editor.id,
      title,
      description,
      grade,
      courseSeason,
      classType,
      primaryTopicSlug,
      keywords: keywords.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
    });
    setMessage(result.ok ? t("metadataSaved") : t("actionFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });
  const submit = () => startTransition(async () => {
    const result = await submitTeacherMicrocourseReviewAction({ microcourseId: editor.id, note: reviewNote });
    setMessage(result.ok ? t("reviewSubmitted") : t("actionFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });
  const withdrawReview = () => startTransition(async () => {
    if (!editor.workflow?.activeReviewCycleId) return;
    const result = await withdrawTeacherMicrocourseReviewAction(editor.workflow.activeReviewCycleId);
    setMessage(result.ok ? t("reviewWithdrawn") : t("actionFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });
  const startClass = () => startTransition(async () => {
    if (!session.coursewareFrozenAt) {
      const result = await freezeTeacherMicrocourseSourceSessionAction(editor.id);
      if (!result.ok) { setMessage(t("actionFailed", { code: result.code })); return; }
    }
    router.push(`/classroom/${session.classroomId}/session/${session.id}/live`);
  });
  const withdrawPublished = () => startTransition(async () => {
    const result = await withdrawTeacherMicrocourseAction(editor.id);
    setMessage(result.ok ? t("publicationWithdrawn") : t("actionFailed", { code: result.code }));
    setWithdrawOpen(false);
    if (result.ok) router.refresh();
  });
  const addBlank = () => startTransition(async () => {
    const result = await createTeacherCompositionPageAction({
      microcourseId: editor.id,
      afterPageDocId: currentPage?.pageDocId ?? null,
      title: t("untitledPage"),
      source: { kind: "blank" },
    });
    if (result.ok) { setSelectedPageId(result.data.pageId); refresh(t("pageAdded")); }
    else setMessage(t("actionFailed", { code: result.code }));
  });
  const addSudoku = () => startTransition(async () => {
    const result = await createTeacherSudokuPageAction({
      microcourseId: editor.id,
      afterPageDocId: currentPage?.pageDocId ?? null,
      title: t("sudokuDefaultTitle"),
      puzzle: Array.from({ length: 81 }, () => 0),
      display: { showCoordinates: true, allowCandidates: true, allowAnswerReveal: false, showTeachingTools: true },
    });
    if (result.ok) { setSelectedPageId(result.data.pageId); refresh(t("pageAdded")); }
    else setMessage(t("actionFailed", { code: result.code }));
  });
  const movePage = (direction: -1 | 1) => {
    if (!currentPage) return;
    const index = editor.pages.findIndex((page) => page.pageDocId === currentPage.pageDocId);
    const target = index + direction;
    if (target < 0 || target >= editor.pages.length) return;
    const next = [...editor.pages];
    [next[index], next[target]] = [next[target], next[index]];
    startTransition(async () => {
      const result = await reorderTeacherMicrocoursePagesAction({ microcourseId: editor.id, pageIds: next.map((page) => page.pageDocId) });
      if (result.ok) refresh(t("pageOrderSaved")); else setMessage(t("actionFailed", { code: result.code }));
    });
  };
  const deletePage = () => startTransition(async () => {
    if (!deletePageId) return;
    const result = await deleteTeacherMicrocoursePageAction(deletePageId);
    if (result.ok) {
      setDeletePageId(null);
      setSelectedPageId(editor.pages.find((page) => page.pageDocId !== deletePageId)?.pageDocId ?? null);
      refresh(t("pageDeleted"));
    } else setMessage(t("actionFailed", { code: result.code }));
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("workspaceTitle")}</CardTitle>
              <p className="mt-1 text-sm text-muted">{session.title}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{t(`workflow_${stage}`)}</Badge>
              {published && <Badge variant="outline">{editor.withdrawnAt ? t("withdrawn") : t("published")}</Badge>}
              <Button type="button" variant="secondary" size="sm" disabled={pending || editor.pages.length === 0} onClick={startClass}><Play className="size-4" />{session.coursewareFrozenAt ? t("enterClass") : t("freezeAndTeach")}</Button>
              {published && !editor.withdrawnAt && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setWithdrawOpen(true)}>{t("withdrawPublication")}</Button>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-6">
          <Label className="grid gap-1 lg:col-span-3"><span>{t("title")}</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></Label>
          <Label className="grid gap-1"><span>{t("grade")}</span><Select value={String(grade)} onValueChange={(value) => setGrade(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 9 }, (_, index) => index + 1).map((value) => <SelectItem key={value} value={String(value)}>{t("gradeValue", { grade: value })}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1"><span>{t("courseSeason")}</span><Select value={courseSeason === null ? NONE : String(courseSeason)} onValueChange={(value) => setCourseSeason(value === NONE ? null : Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>{t("seasonNone")}</SelectItem>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{t(`season_${value}`)}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1"><span>{t("classType")}</span><Input value={classType} onChange={(event) => setClassType(event.target.value)} maxLength={40} placeholder={t("optional")} /></Label>
          <Label className="grid gap-1 lg:col-span-3"><span>{t("description")}</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} /></Label>
          <Label className="grid gap-1"><span>{t("primaryTopic")}</span><Select value={primaryTopicSlug} onValueChange={setPrimaryTopicSlug}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{editor.topics.map((topic) => <SelectItem key={topic.id} value={topic.slug}>{locale === "en" ? topic.titleEn : topic.titleZh}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("keywords")}</span><Input value={keywords} onChange={(event) => setKeywords(event.target.value)} maxLength={400} placeholder={t("keywordsHint")} /></Label>
          <div className="flex items-end"><Button type="button" size="sm" disabled={pending || !title.trim()} onClick={saveMetadata}><Save className="size-4" />{t("saveMetadata")}</Button></div>
          <Label className="grid gap-1 lg:col-span-5"><span>{t("reviewNote")}</span><Input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} placeholder={t("reviewNoteHint")} /></Label>
          <div className="flex items-end gap-2">
            {inReview
              ? <Button type="button" variant="secondary" size="sm" disabled={pending || !editor.workflow?.activeReviewCycleId} onClick={withdrawReview}><Undo2 className="size-4" />{t("withdrawReview")}</Button>
              : <Button type="button" size="sm" disabled={pending || editor.pages.length === 0} onClick={submit}><Send className="size-4" />{published ? t("submitNewVersion") : t("submitReview")}</Button>}
          </div>
          {message && <p role="status" className="text-sm text-muted lg:col-span-6">{message}</p>}
        </CardContent>
      </Card>

      <div className="grid min-h-[44rem] gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="pb-3"><CardTitle className="text-base">{t("pages", { count: editor.pages.length })}</CardTitle></CardHeader>
          <CardContent className="flex h-[39rem] min-h-0 flex-col gap-3 p-3 pt-0">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={addBlank}><Plus className="size-4" />{t("addBlank")}</Button>
              <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={addSudoku}>{t("addSudoku")}</Button>
              <MicrocourseSourcePicker microcourseId={editor.id} afterPageDocId={currentPage?.pageDocId ?? null} initialSources={initialSources} disabled={pending} onAdded={(id) => { setSelectedPageId(id); refresh(t("pagesAdded")); }} />
              <H5CreateDialog microcourseId={editor.id} afterPageDocId={currentPage?.pageDocId ?? null} disabled={pending} onAdded={(id) => { setSelectedPageId(id); refresh(t("pageAdded")); }} />
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <ol className="space-y-2 pr-2">
                {editor.pages.map((page) => <li key={page.pageDocId}>
                  <Button type="button" variant="ghost" onClick={() => setSelectedPageId(page.pageDocId)} className={`h-auto w-full justify-start rounded-xl border px-3 py-2 text-left ${page.pageDocId === currentPage?.pageDocId ? "border-crater bg-moon/30 text-ink" : "border-line"}`}>
                    <span className="w-5 shrink-0 text-xs text-muted">{page.pageNo}</span><span className="min-w-0"><span className="block truncate text-sm">{page.title}</span><span className="block text-xs font-normal text-muted">{pageModeLabel(page, t)}</span></span>
                  </Button>
                </li>)}
              </ol>
            </ScrollArea>
            <div className="grid grid-cols-3 gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage || currentPage.pageNo <= 1} onClick={() => movePage(-1)} aria-label={t("moveUp")}><ArrowUp className="size-4" /></Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage || currentPage.pageNo >= editor.pages.length} onClick={() => movePage(1)} aria-label={t("moveDown")}><ArrowDown className="size-4" /></Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage} onClick={() => setDeletePageId(currentPage?.pageDocId ?? null)} aria-label={t("deletePage")}><Trash2 className="size-4 text-rose" /></Button>
            </div>
          </CardContent>
        </Card>
        {currentPage
          ? <MicrocoursePageWorkbench key={`${currentPage.pageDocId}:${currentPage.revisionId}`} microcourseId={editor.id} page={currentPage} onSaved={(nextMessage) => refresh(nextMessage)} />
          : <Card className="grid place-items-center"><p className="text-sm text-muted">{t("emptyPages")}</p></Card>}
      </div>

      <ConfirmDialog open={deletePageId !== null} onOpenChange={(open) => { if (!open) setDeletePageId(null); }} title={t("deletePageTitle")} description={t("deletePageDescription")} confirmLabel={t("deletePage")} cancelLabel={t("cancel")} onConfirm={deletePage} pending={pending} />
      <ConfirmDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} title={t("withdrawPublicationTitle")} description={t("withdrawPublicationDescription")} confirmLabel={t("withdrawPublication")} cancelLabel={t("cancel")} onConfirm={withdrawPublished} pending={pending} />
    </div>
  );
}

function H5CreateDialog({ microcourseId, afterPageDocId, disabled, onAdded }: { microcourseId: string; afterPageDocId: string | null; disabled: boolean; onAdded: (id: string) => void }) {
  const t = useTranslations("teacherMicrocourses");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(t("h5DefaultTitle"));
  const [html, setHtml] = useState(DEFAULT_H5);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const create = () => startTransition(async () => {
    const result = await createTeacherH5PageAction({ microcourseId, afterPageDocId, title, html });
    if (result.ok) { setOpen(false); onAdded(result.data.pageId); }
    else setMessage(t("actionFailed", { code: result.code }));
  });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" size="sm" variant="secondary" disabled={disabled}><FileCode2 className="size-4" />{t("addH5")}</Button></DialogTrigger>
    <DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>{t("createH5Title")}</DialogTitle><DialogDescription>{t("h5SecurityHint")}</DialogDescription></DialogHeader><Label className="grid gap-1"><span>{t("pageTitle")}</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></Label><Label className="grid gap-1"><span>{t("html")}</span><Textarea value={html} onChange={(event) => setHtml(event.target.value)} rows={18} className="font-mono text-xs" /></Label>{message && <p role="alert" className="text-sm text-rose">{message}</p>}<DialogFooter><Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" disabled={pending || !title.trim() || !html.trim()} onClick={create}>{pending && <LoaderCircle className="size-4 animate-spin" />}{t("create")}</Button></DialogFooter></DialogContent>
  </Dialog>;
}

function MicrocoursePageWorkbench({ microcourseId, page, onSaved }: { microcourseId: string; page: TeacherMicrocoursePage; onSaved: (message: string) => void }) {
  const t = useTranslations("teacherMicrocourses");
  const [title, setTitle] = useState(page.title);
  const [doc, setDoc] = useState(() => clone(page.doc));
  const [bindingUrls, setBindingUrls] = useState({ ...page.bindingUrls });
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const saveDoc = (nextDoc = doc) => startTransition(async () => {
    const result = await saveTeacherMicrocoursePageAction({ pageDocId: page.pageDocId, doc: nextDoc, baseRevisionNo: page.revisionNo, title, note: "" });
    if (result.ok) onSaved(t("pageSaved", { revision: result.data.revisionNo }));
    else setMessage(t("actionFailed", { code: result.code }));
  });

  return <Card className="min-w-0 overflow-hidden">
    <CardHeader className="border-b border-line pb-3"><div className="flex flex-wrap items-center gap-3"><Badge variant="secondary">{pageModeLabel(page, t)}</Badge><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className="min-w-[14rem] flex-1" />{doc.mode !== "h5" && <Button type="button" size="sm" disabled={pending} onClick={() => saveDoc()}><Save className="size-4" />{t("savePage")}</Button>}</div>{message && <p role="status" className="mt-2 text-xs text-rose">{message}</p>}</CardHeader>
    <CardContent className="grid min-h-[38rem] gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0"><div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-line bg-white shadow-sm"><StagePreview doc={doc} bindingUrls={bindingUrls} stageMode="natural" className="w-full" interactive /></div>{doc.mode === "composition" && doc.source && <p className="mt-2 text-xs text-muted">{t("lockedSource", { title: doc.source.sourceTitle, page: doc.source.sourcePageNo })}</p>}</div>
      <ScrollArea className="h-[35rem] rounded-xl border border-line bg-paper/50"><div className="p-4">
        {doc.mode === "composition" && <CompositionControls microcourseId={microcourseId} page={page} doc={doc} setDoc={setDoc} bindingUrls={bindingUrls} setBindingUrls={setBindingUrls} pending={pending} startTransition={startTransition} setMessage={setMessage} />}
        {doc.mode === "sudoku" && <SudokuControls doc={doc} setDoc={setDoc} />}
        {doc.mode === "h5" && <H5Controls microcourseId={microcourseId} page={page} title={title} pending={pending} onSaved={onSaved} setMessage={setMessage} />}
      </div></ScrollArea>
    </CardContent>
  </Card>;
}

function CompositionControls({ microcourseId, page, doc, setDoc, bindingUrls, setBindingUrls, pending, startTransition, setMessage }: {
  microcourseId: string;
  page: TeacherMicrocoursePage;
  doc: Extract<MicrocoursePageDoc, { mode: "composition" }>;
  setDoc: React.Dispatch<React.SetStateAction<MicrocoursePageDoc>>;
  bindingUrls: Record<string, string>;
  setBindingUrls: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  setMessage: (message: string) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const [selectedId, setSelectedId] = useState<string | null>(doc.overlay.nodes[0]?.id ?? null);
  const [file, setFile] = useState<File | null>(null);
  const selected = doc.overlay.nodes.find((node) => node.id === selectedId) ?? null;
  const updateOverlay = (updater: (overlay: PageDoc) => void) => setDoc((current) => {
    if (current.mode !== "composition") return current;
    const next = clone(current);
    updater(next.overlay);
    return next;
  });
  const patchSelected = (updater: (node: DocNode) => void) => updateOverlay((overlay) => {
    const node = overlay.nodes.find((item) => item.id === selectedId);
    if (node) updater(node);
  });
  const add = (kind: "text" | "formula" | "shape") => updateOverlay((overlay) => {
    const node = manualNode(kind, overlay.nodes.length + 1);
    overlay.nodes.push(node);
    setSelectedId(node.id);
  });
  const upload = () => startTransition(async () => {
    if (!file) return;
    const result = await uploadTeacherMicrocourseImageAction({ microcourseId, pageDocId: page.pageDocId, file });
    if (!result.ok) { setMessage(t("actionFailed", { code: result.code })); return; }
    updateOverlay((overlay) => {
      const node = imageNode(result.data.bindingKey, overlay.nodes.length + 1);
      overlay.nodes.push(node);
      setSelectedId(node.id);
    });
    setBindingUrls({ ...bindingUrls, [result.data.bindingKey]: result.data.url });
    setFile(null);
  });
  const number = (key: keyof DocNode["transform"] | "fontSize", raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    patchSelected((node) => {
      if (key === "fontSize") node.style.fontSize = value;
      else (node.transform[key] as number) = value;
    });
  };
  return <div className="space-y-4">
    <div><h3 className="text-sm font-medium">{t("overlayElements")}</h3><div className="mt-2 grid grid-cols-3 gap-1"><Button type="button" size="sm" variant="secondary" onClick={() => add("text")}><Type className="size-3.5" />{t("text")}</Button><Button type="button" size="sm" variant="secondary" onClick={() => add("formula")}><Sigma className="size-3.5" />{t("formula")}</Button><Button type="button" size="sm" variant="secondary" onClick={() => add("shape")}><Shapes className="size-3.5" />{t("shape")}</Button></div></div>
    <Label className="grid gap-1"><span>{t("localImage")}</span><Input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><Button type="button" size="sm" variant="secondary" disabled={pending || !file} onClick={upload}><ImagePlus className="size-4" />{t("insertImage")}</Button></Label>
    <div className="space-y-1"><p className="text-xs text-muted">{t("elementList")}</p>{doc.overlay.nodes.map((node) => <Button key={node.id} type="button" size="sm" variant={node.id === selectedId ? "primary" : "ghost"} onClick={() => setSelectedId(node.id)} className="w-full justify-start truncate">{node.name ?? node.content?.kind ?? node.id}</Button>)}</div>
    {selected && <div className="space-y-3 border-t border-line pt-3">
      {selected.content?.kind === "text" && <Label className="grid gap-1"><span>{t("text")}</span><Textarea value={selected.content.text ?? ""} onChange={(event) => patchSelected((node) => { if (node.content?.kind === "text") node.content.text = event.target.value; })} rows={4} /></Label>}
      {selected.content?.kind === "rich_text" && <Label className="grid gap-1"><span>{t("richTextFormula")}</span><Textarea value={selected.content.html ?? ""} onChange={(event) => patchSelected((node) => { if (node.content?.kind === "rich_text") node.content.html = event.target.value; })} rows={5} className="font-mono text-xs" /><span className="text-xs font-normal text-muted">{t("formulaHint")}</span></Label>}
      <div className="grid grid-cols-2 gap-2">{(["x", "y", "width", "height"] as const).map((key) => <Label key={key} className="grid gap-1 text-xs"><span>{key}</span><Input type="number" value={selected.transform[key]} onChange={(event) => number(key, event.target.value)} /></Label>)}</div>
      {(selected.content?.kind === "text" || selected.content?.kind === "rich_text") && <Label className="grid gap-1 text-xs"><span>{t("fontSize")}</span><Input type="number" value={selected.style.fontSize ?? 28} onChange={(event) => number("fontSize", event.target.value)} /></Label>}
      <Label className="grid gap-1 text-xs"><span>{t("color")}</span><Input type="color" value={selected.style.color ?? "#2d2a26"} onChange={(event) => patchSelected((node) => { node.style.color = event.target.value; })} /></Label>
      <Button type="button" size="sm" variant="ghost" onClick={() => updateOverlay((overlay) => { overlay.nodes = overlay.nodes.filter((node) => node.id !== selected.id); setSelectedId(null); })}><Trash2 className="size-4 text-rose" />{t("deleteElement")}</Button>
    </div>}
  </div>;
}

function SudokuControls({ doc, setDoc }: { doc: Extract<MicrocoursePageDoc, { mode: "sudoku" }>; setDoc: React.Dispatch<React.SetStateAction<MicrocoursePageDoc>> }) {
  const t = useTranslations("teacherMicrocourses");
  const analysis = useMemo(() => analyzeSudokuPuzzle(doc.puzzle), [doc.puzzle]);
  const setDigit = (index: number, raw: string) => {
    const digit = /^[1-9]$/.test(raw) ? Number(raw) : 0;
    setDoc((current) => current.mode !== "sudoku" ? current : {
      ...current,
      puzzle: current.puzzle.map((value, currentIndex) => currentIndex === index ? digit : value),
      analysis: analyzeSudokuPuzzle(current.puzzle.map((value, currentIndex) => currentIndex === index ? digit : value)),
    });
  };
  const setDisplay = (key: keyof typeof doc.display, value: boolean) => setDoc((current) => current.mode !== "sudoku" ? current : { ...current, display: { ...current.display, [key]: value } });
  return <div className="space-y-4"><div><h3 className="text-sm font-medium">{t("sudokuPrototype")}</h3><p className={`mt-1 text-xs ${analysis.status === "unique" ? "text-leaf" : "text-rose"}`}>{t(`sudoku_${analysis.status}`)}</p></div><div className="grid grid-cols-9 overflow-hidden rounded-lg border-2 border-ink/50">{doc.puzzle.map((digit, index) => <Input key={index} aria-label={t("sudokuCell", { cell: index + 1 })} inputMode="numeric" maxLength={1} value={digit || ""} onChange={(event) => setDigit(index, event.target.value)} className={`h-8 rounded-none border-0 border-r border-b border-line p-0 text-center text-xs ${index % 3 === 2 && index % 9 !== 8 ? "border-r-2 border-r-ink/40" : ""} ${Math.floor(index / 9) % 3 === 2 && index < 72 ? "border-b-2 border-b-ink/40" : ""}`} />)}</div><div className="space-y-2">{(["showCoordinates", "allowCandidates", "allowAnswerReveal", "showTeachingTools"] as const).map((key) => <Label key={key} className="flex items-center gap-2 text-sm font-normal"><Checkbox checked={doc.display[key]} onCheckedChange={(value) => setDisplay(key, value === true)} />{t(`sudokuOption_${key}`)}</Label>)}</div></div>;
}

function H5Controls({ microcourseId, page, title, pending, onSaved, setMessage }: { microcourseId: string; page: TeacherMicrocoursePage; title: string; pending: boolean; onSaved: (message: string) => void; setMessage: (message: string) => void }) {
  const t = useTranslations("teacherMicrocourses");
  const h5Doc = page.doc.mode === "h5" ? page.doc : null;
  const [html, setHtml] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!h5Doc) return;
    startLoading(async () => {
      try { setHtml(await loadTeacherMicrocourseH5HtmlAction(h5Doc.artifactId)); }
      catch { setMessage(t("h5LoadFailed")); }
    });
  }, [h5Doc, setMessage, t]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const bridge = `<script>window.addEventListener('error',function(e){parent.postMessage({type:'mathin-microcourse-preview-error',message:e.message||'Runtime error'},'*')});window.addEventListener('unhandledrejection',function(e){parent.postMessage({type:'mathin-microcourse-preview-error',message:String(e.reason||'Unhandled rejection')},'*')});<\/script>`;
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'">`;
      const withHead = /<head[\s>]/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${csp}`) : `${csp}${html}`;
      setPreviewHtml(/<\/body>/i.test(withHead) ? withHead.replace(/<\/body>/i, `${bridge}</body>`) : `${withHead}${bridge}`);
      setRuntimeError("");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [html]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === "mathin-microcourse-preview-error") setRuntimeError(String(event.data.message ?? t("h5RuntimeError")));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [t]);
  if (!h5Doc) return null;
  const save = () => startSaving(async () => {
    const result = await updateTeacherH5PageAction({ microcourseId, pageDocId: page.pageDocId, title, html, baseRevisionNo: page.revisionNo });
    if (result.ok) onSaved(t("pageSaved", { revision: result.data.revisionNo }));
    else setMessage(t("actionFailed", { code: result.code }));
  });
  const insertFile = (file: File | null) => {
    if (!file || file.size > 1_500_000) { if (file) setMessage(t("h5InlineAssetTooLarge")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const snippet = file.type.startsWith("audio/") ? `<audio controls src="${url}"></audio>` : file.type.startsWith("video/") ? `<video controls src="${url}"></video>` : `<img src="${url}" alt="">`;
      setHtml((current) => `${current}\n${snippet}`);
    };
    reader.readAsDataURL(file);
  };
  return <div className="space-y-3"><div><h3 className="text-sm font-medium">{t("h5Editor")}</h3><p className="mt-1 text-xs text-muted">{t("h5SecurityHint")}</p></div><Label className="grid gap-1"><span>{t("html")}</span><Textarea value={html} onChange={(event) => setHtml(event.target.value)} rows={16} className="font-mono text-[11px]" disabled={loading} /></Label><Label className="grid gap-1"><span>{t("insertLocalAsset")}</span><Input type="file" accept="image/*,audio/*,video/*" onChange={(event) => insertFile(event.target.files?.[0] ?? null)} /></Label><div className="overflow-hidden rounded-lg border border-line bg-white"><iframe ref={frameRef} title={t("h5LivePreview")} sandbox="allow-scripts" srcDoc={previewHtml} className="aspect-[4/3] w-full border-0" /></div>{runtimeError && <p role="alert" className="text-xs text-rose">{t("h5RuntimeErrorWithMessage", { message: runtimeError })}</p>}<p className="text-xs text-muted">{new TextEncoder().encode(html.replace(/\r\n?/g, "\n")).byteLength} / 5 MiB</p><Button type="button" size="sm" disabled={pending || saving || loading || !html.trim()} onClick={save}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{t("saveH5")}</Button></div>;
}
