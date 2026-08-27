"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  FileCode2,
  Gamepad2,
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
import { isGamePageDoc } from "@/features/courseware-doc/game-page-schema";
import type { MicrocoursePageDoc } from "@/features/courseware-doc/microcourse-schema";
import type { DocNode, PageDoc } from "@/features/courseware-doc/schema";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { GamePageEditor } from "@/features/games/courseware/GamePageEditor";
import { gameCoursewareContractsForSurface } from "@/features/games/courseware/registry";
import { getGame } from "@/features/games/registry";
import { analyzeSudokuPuzzle } from "@/features/games/sudoku/logic";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  createTeacherCompositionPageAction,
  createTeacherH5PageAction,
  createTeacherGamePageAction,
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
import type { TeacherMicrocourseEditor as EditorData, TeacherMicrocoursePage } from "./data";
import { microcourseH5Bytes, normalizeMicrocourseH5 } from "./h5";
import { MicrocourseSourcePicker } from "./MicrocourseSourcePicker";
import type { TeacherMicrocoursePageDoc } from "./page-doc";

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
  if (isGamePageDoc(page.doc)) return t("mode_game");
  return t(`mode_${page.doc.mode}`);
}

type PageSaveState = "saved" | "saving" | "dirty" | "error";

interface PersistedPageDraft {
  pageDocId: string;
  title: string;
  doc: TeacherMicrocoursePageDoc;
  revisionNo: number;
  h5Html?: string;
}

interface MicrocoursePageWorkbenchHandle {
  flush: () => Promise<boolean>;
}

interface MicrocourseH5ControlsHandle extends MicrocoursePageWorkbenchHandle {
  markDirty: () => void;
}

export function MicrocourseEditor({
  session,
  editor,
}: {
  session: { id: string; title: string; classroomId: string; coursewareFrozenAt: string | null };
  editor: EditorData;
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pageDrafts, setPageDrafts] = useState<Record<string, PersistedPageDraft>>({});
  const [selectedPageId, setSelectedPageId] = useState<string | null>(editor.pages[0]?.pageDocId ?? null);
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [pageSwitching, setPageSwitching] = useState(false);
  const pageSwitchingRef = useRef(false);
  const workbenchRef = useRef<MicrocoursePageWorkbenchHandle>(null);
  const [pending, startTransition] = useTransition();

  const pages = useMemo(() => editor.pages.map((page) => {
    const draft = pageDrafts[page.pageDocId];
    return draft ? { ...page, title: draft.title, doc: draft.doc, revisionNo: draft.revisionNo, h5Html: draft.h5Html } : page;
  }), [editor.pages, pageDrafts]);
  const currentPage = pages.find((page) => page.pageDocId === selectedPageId) ?? pages[0] ?? null;
  const stage = editor.workflow?.stage ?? "idle";
  const inReview = stage === "in_review" || stage === "ready_to_publish";
  const published = Boolean(editor.publishedMetadataRevisionId && editor.currentReleaseId);

  const refresh = (nextMessage?: string) => {
    if (nextMessage) setMessage(nextMessage);
    router.refresh();
  };
  const persistCurrentPage = useCallback(async () => {
    const saved = await (workbenchRef.current?.flush() ?? Promise.resolve(true));
    if (!saved) setMessage(t("pageAutosaveFailed"));
    return saved;
  }, [t]);
  const selectPage = async (pageDocId: string) => {
    if (pageDocId === currentPage?.pageDocId || pageSwitchingRef.current) return;
    pageSwitchingRef.current = true;
    setPageSwitching(true);
    const saved = await persistCurrentPage();
    if (saved) setSelectedPageId(pageDocId);
    pageSwitchingRef.current = false;
    setPageSwitching(false);
  };
  const handlePagePersisted = useCallback((draft: PersistedPageDraft) => {
    setPageDrafts((current) => ({ ...current, [draft.pageDocId]: draft }));
  }, []);
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
    if (!await persistCurrentPage()) return;
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
    if (!await persistCurrentPage()) return;
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
    if (!await persistCurrentPage()) return;
    const result = await createTeacherCompositionPageAction({
      microcourseId: editor.id,
      afterPageDocId: currentPage?.pageDocId ?? null,
      title: t("untitledPage"),
      source: { kind: "blank" },
    });
    if (result.ok) { setSelectedPageId(result.data.pageId); refresh(t("pageAdded")); }
    else setMessage(t("actionFailed", { code: result.code }));
  });
  const movePage = (direction: -1 | 1) => {
    if (!currentPage) return;
    const index = pages.findIndex((page) => page.pageDocId === currentPage.pageDocId);
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
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
      setSelectedPageId(pages.find((page) => page.pageDocId !== deletePageId)?.pageDocId ?? null);
      refresh(t("pageDeleted"));
    } else setMessage(t("actionFailed", { code: result.code }));
  });
  const handlePageAdded = async (pageId: string, nextMessage: string) => {
    const saved = await persistCurrentPage();
    if (saved) {
      setSelectedPageId(pageId);
      setMessage(nextMessage);
    }
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="truncate text-base">{t("workspaceTitle")}</CardTitle>
                <Badge variant="secondary">{t(`workflow_${stage}`)}</Badge>
                {published && <Badge variant="outline">{editor.withdrawnAt ? t("withdrawn") : t("published")}</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">{title ? `${title} · ${session.title}` : session.title}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
                {detailsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                {detailsOpen ? t("collapseDetails") : t("editDetails")}
              </Button>
              {inReview
                ? <Button type="button" variant="secondary" size="sm" disabled={pending || !editor.workflow?.activeReviewCycleId} onClick={withdrawReview}><Undo2 className="size-4" />{t("withdrawReview")}</Button>
                : <Button type="button" size="sm" disabled={pending || pages.length === 0} onClick={submit}><Send className="size-4" />{published ? t("submitNewVersion") : t("submitReview")}</Button>}
              <Button type="button" variant="secondary" size="sm" disabled={pending || pages.length === 0} onClick={startClass}><Play className="size-4" />{session.coursewareFrozenAt ? t("enterClass") : t("freezeAndTeach")}</Button>
              {published && !editor.withdrawnAt && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setWithdrawOpen(true)}>{t("withdrawPublication")}</Button>}
            </div>
          </div>
        </CardHeader>
        {detailsOpen && <CardContent className="grid gap-3 border-t border-line pt-4 lg:grid-cols-12">
          <Label className="grid gap-1 lg:col-span-4"><span>{t("title")}</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("grade")}</span><Select value={String(grade)} onValueChange={(value) => setGrade(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 9 }, (_, index) => index + 1).map((value) => <SelectItem key={value} value={String(value)}>{t("gradeValue", { grade: value })}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("courseSeason")}</span><Select value={courseSeason === null ? NONE : String(courseSeason)} onValueChange={(value) => setCourseSeason(value === NONE ? null : Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>{t("seasonNone")}</SelectItem>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{t(`season_${value}`)}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("classType")}</span><Input value={classType} onChange={(event) => setClassType(event.target.value)} maxLength={40} placeholder={t("optional")} /></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("primaryTopic")}</span><Select value={primaryTopicSlug} onValueChange={setPrimaryTopicSlug}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{editor.topics.map((topic) => <SelectItem key={topic.id} value={topic.slug}>{locale === "en" ? topic.titleEn : topic.titleZh}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1 lg:col-span-6"><span>{t("description")}</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} /></Label>
          <Label className="grid gap-1 lg:col-span-6"><span>{t("keywords")}</span><Input value={keywords} onChange={(event) => setKeywords(event.target.value)} maxLength={400} placeholder={t("keywordsHint")} /></Label>
          <Label className="grid gap-1 lg:col-span-10"><span>{t("reviewNote")}</span><Input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} placeholder={t("reviewNoteHint")} /></Label>
          <div className="flex items-end lg:col-span-2"><Button type="button" size="sm" disabled={pending || !title.trim()} onClick={saveMetadata}><Save className="size-4" />{t("saveMetadata")}</Button></div>
        </CardContent>}
        {message && <p role="status" className="border-t border-line px-6 py-2 text-xs text-muted">{message}</p>}
      </Card>

      <div className="grid min-h-[44rem] gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="pb-3"><CardTitle className="text-base">{t("pages", { count: pages.length })}</CardTitle></CardHeader>
          <CardContent className="flex h-[39rem] min-h-0 flex-col gap-3 p-3 pt-0">
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={pending || pageSwitching} onClick={addBlank}><Plus className="size-4" />{t("addBlank")}</Button>
              <GameCreateDialog
                microcourseId={editor.id}
                afterPageDocId={currentPage?.pageDocId ?? null}
                disabled={pending || pageSwitching}
                beforeCreate={persistCurrentPage}
                onAdded={(id) => void handlePageAdded(id, t("pageAdded"))}
              />
              <MicrocourseSourcePicker microcourseId={editor.id} afterPageDocId={currentPage?.pageDocId ?? null} disabled={pending || pageSwitching} onAdded={(id, count) => void handlePageAdded(id, t("pagesAdded", { count }))} />
              <H5CreateDialog microcourseId={editor.id} afterPageDocId={currentPage?.pageDocId ?? null} disabled={pending || pageSwitching} onAdded={(id) => void handlePageAdded(id, t("pageAdded"))} />
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <ol className="space-y-2 pr-2">
                {pages.map((page) => <li key={page.pageDocId}>
                  <Button type="button" variant="ghost" disabled={pending || pageSwitching} onClick={() => void selectPage(page.pageDocId)} className={`h-auto w-full justify-start rounded-xl border px-3 py-2 text-left ${page.pageDocId === currentPage?.pageDocId ? "border-crater bg-moon/30 text-ink" : "border-line"}`}>
                    <span className="w-5 shrink-0 text-xs text-muted">{page.pageNo}</span><span className="min-w-0"><span className="block truncate text-sm">{page.title}</span><span className="block text-xs font-normal text-muted">{pageModeLabel(page, t)}</span></span>
                  </Button>
                </li>)}
              </ol>
            </ScrollArea>
            <div className="grid grid-cols-3 gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage || currentPage.pageNo <= 1} onClick={() => movePage(-1)} aria-label={t("moveUp")}><ArrowUp className="size-4" /></Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage || currentPage.pageNo >= pages.length} onClick={() => movePage(1)} aria-label={t("moveDown")}><ArrowDown className="size-4" /></Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage} onClick={() => setDeletePageId(currentPage?.pageDocId ?? null)} aria-label={t("deletePage")}><Trash2 className="size-4 text-rose" /></Button>
            </div>
          </CardContent>
        </Card>
        {currentPage
          ? <MicrocoursePageWorkbench ref={workbenchRef} key={currentPage.pageDocId} microcourseId={editor.id} page={currentPage} onPersisted={handlePagePersisted} onStatus={setMessage} />
          : <Card className="grid place-items-center"><p className="text-sm text-muted">{t("emptyPages")}</p></Card>}
      </div>

      <ConfirmDialog open={deletePageId !== null} onOpenChange={(open) => { if (!open) setDeletePageId(null); }} title={t("deletePageTitle")} description={t("deletePageDescription")} confirmLabel={t("deletePage")} cancelLabel={t("cancel")} onConfirm={deletePage} pending={pending} />
      <ConfirmDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} title={t("withdrawPublicationTitle")} description={t("withdrawPublicationDescription")} confirmLabel={t("withdrawPublication")} cancelLabel={t("cancel")} onConfirm={withdrawPublished} pending={pending} />
    </div>
  );
}

function GameCreateDialog({
  microcourseId,
  afterPageDocId,
  disabled,
  beforeCreate,
  onAdded,
}: {
  microcourseId: string;
  afterPageDocId: string | null;
  disabled: boolean;
  beforeCreate: () => Promise<boolean>;
  onAdded: (id: string) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const tGames = useTranslations("games");
  const contracts = gameCoursewareContractsForSurface("microcourse");
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(
    contracts[0] ? `${contracts[0].gameId}:${contracts[0].contentVersion}` : "",
  );
  const [title, setTitle] = useState(
    contracts[0] ? tGames(`items.${contracts[0].gameId}.name`) : "",
  );
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const selected = contracts.find((contract) => (
    `${contract.gameId}:${contract.contentVersion}` === selectedKey
  ));
  const choose = (gameId: string, contentVersion: string) => {
    setSelectedKey(`${gameId}:${contentVersion}`);
    setTitle(tGames(`items.${gameId}.name`));
    setMessage("");
  };
  const create = () => startTransition(async () => {
    if (!selected || !await beforeCreate()) return;
    const result = await createTeacherGamePageAction({
      microcourseId,
      afterPageDocId,
      title,
      gameId: selected.gameId,
      contentVersion: selected.contentVersion,
    });
    if (result.ok) {
      setOpen(false);
      onAdded(result.data.pageId);
    } else {
      setMessage(t("actionFailed", { code: result.code }));
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary" disabled={disabled || contracts.length === 0}>
          <Gamepad2 className="size-4" />
          {t("addGame")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("createGameTitle")}</DialogTitle>
          <DialogDescription>{t("gameAuthoringHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {contracts.map((contract) => {
            const game = getGame(contract.gameId);
            const Icon = game?.icon ?? Gamepad2;
            const key = `${contract.gameId}:${contract.contentVersion}`;
            return (
              <Button
                key={key}
                type="button"
                variant="secondary"
                aria-pressed={selectedKey === key}
                className={cn(
                  "h-auto justify-start rounded-xl px-4 py-3",
                  selectedKey === key && "border-crater bg-moon/30",
                )}
                onClick={() => choose(contract.gameId, contract.contentVersion)}
              >
                <Icon className="size-4" />
                {tGames(`items.${contract.gameId}.name`)}
              </Button>
            );
          })}
        </div>
        <Label className="grid gap-1">
          <span>{t("pageTitle")}</span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
        </Label>
        {message && <p role="alert" className="text-sm text-rose">{message}</p>}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
          <Button type="button" disabled={pending || !selected || !title.trim()} onClick={create}>
            {pending && <LoaderCircle className="size-4 animate-spin" />}
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

const MicrocoursePageWorkbench = forwardRef<MicrocoursePageWorkbenchHandle, {
  microcourseId: string;
  page: TeacherMicrocoursePage & { h5Html?: string };
  onPersisted: (draft: PersistedPageDraft) => void;
  onStatus: (message: string) => void;
}>(function MicrocoursePageWorkbench({ microcourseId, page, onPersisted, onStatus }, ref) {
  const t = useTranslations("teacherMicrocourses");
  const [title, setTitle] = useState(page.title);
  const [doc, setDoc] = useState(() => clone(page.doc));
  const [bindingUrls, setBindingUrls] = useState({ ...page.bindingUrls });
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState<PageSaveState>("saved");
  const [pending, startTransition] = useTransition();
  const titleRef = useRef(page.title);
  const docRef = useRef(clone(page.doc));
  const revisionRef = useRef(page.revisionNo);
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const h5Ref = useRef<MicrocourseH5ControlsHandle>(null);

  const flushDoc = useCallback(async (): Promise<boolean> => {
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
    const docSnapshot = clone(docRef.current);
    setSaveState("saving");
    const request = saveTeacherMicrocoursePageAction({
      pageDocId: page.pageDocId,
      doc: docSnapshot,
      baseRevisionNo: revisionRef.current,
      title: titleSnapshot,
      note: "",
    }).then((result) => {
      if (!result.ok) {
        setSaveState("error");
        setMessage(t("actionFailed", { code: result.code }));
        onStatus(t("pageAutosaveFailed"));
        return false;
      }
      revisionRef.current = result.data.revisionNo;
      savedSequenceRef.current = sequence;
      setMessage("");
      onPersisted({
        pageDocId: page.pageDocId,
        title: titleSnapshot,
        doc: result.data.doc,
        revisionNo: result.data.revisionNo,
      });
      if (sequenceRef.current === sequence) {
        docRef.current = result.data.doc;
        setDoc(result.data.doc);
        setSaveState("saved");
      } else {
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

  const flush = useCallback(async (): Promise<boolean> => {
    if (!isGamePageDoc(docRef.current) && docRef.current.mode === "h5") {
      return h5Ref.current?.flush() ?? false;
    }
    return flushDoc();
  }, [flushDoc]);

  useEffect(() => { flushRef.current = flush; }, [flush]);
  useImperativeHandle(ref, () => ({ flush }), [flush]);

  const markDocDirty = useCallback(() => {
    sequenceRef.current += 1;
    setSaveState("dirty");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
  }, []);

  const updateDoc: React.Dispatch<React.SetStateAction<TeacherMicrocoursePageDoc>> = useCallback((nextValue) => {
    const next = typeof nextValue === "function"
      ? (nextValue as (current: TeacherMicrocoursePageDoc) => TeacherMicrocoursePageDoc)(docRef.current)
      : nextValue;
    docRef.current = next;
    setDoc(next);
    markDocDirty();
  }, [markDocDirty]);

  const changeTitle = (value: string) => {
    titleRef.current = value;
    setTitle(value);
    if (!isGamePageDoc(docRef.current) && docRef.current.mode === "h5") {
      h5Ref.current?.markDirty();
      return;
    }
    markDocDirty();
  };

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

  const saveLabel = saveState === "saving" ? t("pageAutosaving")
    : saveState === "dirty" ? t("pageUnsaved")
      : saveState === "error" ? t("pageAutosaveFailed")
        : t("pageAutosaved");

  return <Card className="min-w-0 overflow-hidden">
    <CardHeader className="border-b border-line pb-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">{pageModeLabel(page, t)}</Badge>
        <Input value={title} onChange={(event) => changeTitle(event.target.value)} maxLength={200} className="min-w-[14rem] flex-1" />
        <span data-testid="microcourse-autosave-status" role="status" aria-live="polite" className={cn("inline-flex items-center gap-1 text-xs", saveState === "error" ? "text-rose" : "text-muted")}>
          {saveState === "saving" && <LoaderCircle className="size-3.5 animate-spin" />}
          {saveLabel}
        </span>
        <Button type="button" size="sm" variant="secondary" disabled={pending || saveState === "saving"} onClick={() => void flush()}><Save className="size-4" />{t("saveNow")}</Button>
      </div>
      {message && <p role="alert" className="mt-2 text-xs text-rose">{message}</p>}
    </CardHeader>
    <CardContent className="grid min-h-[38rem] gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0"><div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-line bg-white shadow-sm"><StagePreview doc={doc} bindingUrls={bindingUrls} stageMode="natural" className="w-full" interactive /></div>{!isGamePageDoc(doc) && doc.mode === "composition" && doc.source && <p className="mt-2 text-xs text-muted">{t("lockedSource", { title: doc.source.sourceTitle, page: doc.source.sourcePageNo })}</p>}</div>
      <ScrollArea className="h-[35rem] rounded-xl border border-line bg-paper/50"><div className="p-4">
        {isGamePageDoc(doc) && <GamePageEditor doc={doc} onChange={updateDoc} />}
        {!isGamePageDoc(doc) && doc.mode === "composition" && <CompositionControls microcourseId={microcourseId} page={page} doc={doc} setDoc={updateDoc} bindingUrls={bindingUrls} setBindingUrls={setBindingUrls} pending={pending} startTransition={startTransition} setMessage={setMessage} />}
        {!isGamePageDoc(doc) && doc.mode === "sudoku" && <SudokuControls doc={doc} setDoc={updateDoc} />}
        {!isGamePageDoc(doc) && doc.mode === "h5" && <H5Controls ref={h5Ref} microcourseId={microcourseId} page={page} initialHtml={page.h5Html} titleRef={titleRef} onPersisted={onPersisted} onSaveStateChange={setSaveState} setMessage={setMessage} onStatus={onStatus} />}
      </div></ScrollArea>
    </CardContent>
  </Card>;
});

function CompositionControls({ microcourseId, page, doc, setDoc, bindingUrls, setBindingUrls, pending, startTransition, setMessage }: {
  microcourseId: string;
  page: TeacherMicrocoursePage;
  initialHtml?: string;
  doc: Extract<MicrocoursePageDoc, { mode: "composition" }>;
  setDoc: React.Dispatch<React.SetStateAction<TeacherMicrocoursePageDoc>>;
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
    if (isGamePageDoc(current) || current.mode !== "composition") return current;
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
      {selected.content?.kind === "text" && <Label className="grid gap-1"><span>{t("text")}</span><Textarea data-testid="microcourse-overlay-text" aria-label={t("text")} value={selected.content.text ?? ""} onChange={(event) => patchSelected((node) => { if (node.content?.kind === "text") node.content.text = event.target.value; })} rows={4} /></Label>}
      {selected.content?.kind === "rich_text" && <Label className="grid gap-1"><span>{t("richTextFormula")}</span><Textarea value={selected.content.html ?? ""} onChange={(event) => patchSelected((node) => { if (node.content?.kind === "rich_text") node.content.html = event.target.value; })} rows={5} className="font-mono text-xs" /><span className="text-xs font-normal text-muted">{t("formulaHint")}</span></Label>}
      <div className="grid grid-cols-2 gap-2">{(["x", "y", "width", "height"] as const).map((key) => <Label key={key} className="grid gap-1 text-xs"><span>{key}</span><Input type="number" value={selected.transform[key]} onChange={(event) => number(key, event.target.value)} /></Label>)}</div>
      {(selected.content?.kind === "text" || selected.content?.kind === "rich_text") && <Label className="grid gap-1 text-xs"><span>{t("fontSize")}</span><Input type="number" value={selected.style.fontSize ?? 28} onChange={(event) => number("fontSize", event.target.value)} /></Label>}
      <Label className="grid gap-1 text-xs"><span>{t("color")}</span><Input type="color" value={selected.style.color ?? "#2d2a26"} onChange={(event) => patchSelected((node) => { node.style.color = event.target.value; })} /></Label>
      <Button type="button" size="sm" variant="ghost" onClick={() => updateOverlay((overlay) => { overlay.nodes = overlay.nodes.filter((node) => node.id !== selected.id); setSelectedId(null); })}><Trash2 className="size-4 text-rose" />{t("deleteElement")}</Button>
    </div>}
  </div>;
}

function SudokuControls({ doc, setDoc }: { doc: Extract<MicrocoursePageDoc, { mode: "sudoku" }>; setDoc: React.Dispatch<React.SetStateAction<TeacherMicrocoursePageDoc>> }) {
  const t = useTranslations("teacherMicrocourses");
  const analysis = useMemo(() => analyzeSudokuPuzzle(doc.puzzle), [doc.puzzle]);
  const setDigit = (index: number, raw: string) => {
    const digit = /^[1-9]$/.test(raw) ? Number(raw) : 0;
    setDoc((current) => isGamePageDoc(current) || current.mode !== "sudoku" ? current : {
      ...current,
      puzzle: current.puzzle.map((value, currentIndex) => currentIndex === index ? digit : value),
      analysis: analyzeSudokuPuzzle(current.puzzle.map((value, currentIndex) => currentIndex === index ? digit : value)),
    });
  };
  const setDisplay = (key: keyof typeof doc.display, value: boolean) => setDoc((current) => isGamePageDoc(current) || current.mode !== "sudoku" ? current : { ...current, display: { ...current.display, [key]: value } });
  return <div className="space-y-4"><div><h3 className="text-sm font-medium">{t("sudokuPrototype", { size: 9 })}</h3><p className={`mt-1 text-xs ${analysis.status === "unique" ? "text-leaf-deep" : "text-rose"}`}>{t(`sudoku_${analysis.status}`)}</p></div><div className="grid grid-cols-9 overflow-hidden rounded-lg border-2 border-ink/50">{doc.puzzle.map((digit, index) => <Input key={index} aria-label={t("sudokuCell", { cell: index + 1 })} inputMode="numeric" maxLength={1} value={digit || ""} onChange={(event) => setDigit(index, event.target.value)} className={`h-8 rounded-none border-0 border-r border-b border-line p-0 text-center text-xs ${index % 3 === 2 && index % 9 !== 8 ? "border-r-2 border-r-ink/40" : ""} ${Math.floor(index / 9) % 3 === 2 && index < 72 ? "border-b-2 border-b-ink/40" : ""}`} />)}</div><div className="space-y-2">{(["showCoordinates", "allowCandidates", "allowAnswerReveal", "showTeachingTools"] as const).map((key) => <Label key={key} className="flex items-center gap-2 text-sm font-normal"><Checkbox checked={doc.display[key]} onCheckedChange={(value) => setDisplay(key, value === true)} />{t(`sudokuOption_${key}`)}</Label>)}</div></div>;
}

const H5Controls = forwardRef<MicrocourseH5ControlsHandle, {
  microcourseId: string;
  page: TeacherMicrocoursePage;
  initialHtml?: string;
  titleRef: { current: string };
  onPersisted: (draft: PersistedPageDraft) => void;
  onSaveStateChange: (state: PageSaveState) => void;
  setMessage: (message: string) => void;
  onStatus: (message: string) => void;
}>(function H5Controls({ microcourseId, page, initialHtml, titleRef, onPersisted, onSaveStateChange, setMessage, onStatus }, ref) {
  const t = useTranslations("teacherMicrocourses");
  const h5Doc = !isGamePageDoc(page.doc) && page.doc.mode === "h5" ? page.doc : null;
  const [initialArtifactId] = useState(() => h5Doc?.artifactId ?? null);
  const [html, setHtml] = useState(initialHtml ?? "");
  const [previewHtml, setPreviewHtml] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [loading, setLoading] = useState(Boolean(initialArtifactId) && initialHtml === undefined);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const htmlRef = useRef(initialHtml ?? "");
  const htmlEditedRef = useRef(false);
  const revisionRef = useRef(page.revisionNo);
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const loadPromiseRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);

  useEffect(() => {
    if (initialHtml !== undefined) {
      loadPromiseRef.current = Promise.resolve(true);
      return;
    }
    if (!initialArtifactId) return;
    let active = true;
    const request = loadTeacherMicrocourseH5HtmlAction(initialArtifactId).then((value) => {
      if (active) {
        if (!htmlEditedRef.current) {
          htmlRef.current = value;
          setHtml(value);
        }
        setLoading(false);
      }
      return true;
    }).catch(() => {
      if (active) {
        setLoading(false);
        setMessage(t("h5LoadFailed"));
      }
      onStatus(t("h5LoadFailed"));
      return false;
    });
    loadPromiseRef.current = request;
    return () => { active = false; };
  }, [initialArtifactId, initialHtml, onStatus, setMessage, t]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (savedSequenceRef.current === sequenceRef.current) return true;
    if (!htmlEditedRef.current && loadPromiseRef.current && !(await loadPromiseRef.current)) return false;
    if (savingRef.current) {
      const previousSaved = await savingRef.current;
      if (!previousSaved) return false;
    }
    if (savedSequenceRef.current === sequenceRef.current) return true;
    if (!titleRef.current.trim() || !htmlRef.current.trim()) {
      onSaveStateChange("error");
      setMessage(t("pageAutosaveFailed"));
      onStatus(t("pageAutosaveFailed"));
      return false;
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const sequence = sequenceRef.current;
    const titleSnapshot = titleRef.current;
    const htmlSnapshot = htmlRef.current;
    onSaveStateChange("saving");
    const request = updateTeacherH5PageAction({
      microcourseId,
      pageDocId: page.pageDocId,
      title: titleSnapshot,
      html: htmlSnapshot,
      baseRevisionNo: revisionRef.current,
    }).then((result) => {
      if (!result.ok) {
        onSaveStateChange("error");
        setMessage(t("actionFailed", { code: result.code }));
        onStatus(t("pageAutosaveFailed"));
        return false;
      }
      const normalized = normalizeMicrocourseH5(htmlSnapshot);
      const bytes = microcourseH5Bytes(normalized);
      const nextDoc: Extract<MicrocoursePageDoc, { mode: "h5" }> = {
        docVersion: "microcourse-page-v1",
        mode: "h5",
        canvas: { width: 960, height: 720, backgroundColor: null },
        artifactId: result.data.artifactId,
        sha256: result.data.sha256,
        byteCount: bytes.byteLength,
        entryPath: "index.html",
      };
      revisionRef.current = result.data.revisionNo;
      savedSequenceRef.current = sequence;
      setMessage("");
      onPersisted({ pageDocId: page.pageDocId, title: titleSnapshot, doc: nextDoc, revisionNo: result.data.revisionNo, h5Html: htmlSnapshot });
      if (sequenceRef.current === sequence) {
        onSaveStateChange("saved");
      } else {
        onSaveStateChange("dirty");
        timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
      }
      return true;
    }).catch(() => {
      onSaveStateChange("error");
      setMessage(t("pageAutosaveFailed"));
      onStatus(t("pageAutosaveFailed"));
      return false;
    }).finally(() => {
      savingRef.current = null;
    });
    savingRef.current = request;
    return request;
  }, [microcourseId, onPersisted, onSaveStateChange, onStatus, page.pageDocId, setMessage, t, titleRef]);

  useEffect(() => { flushRef.current = flush; }, [flush]);

  const markDirty = useCallback(() => {
    sequenceRef.current += 1;
    onSaveStateChange("dirty");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
  }, [onSaveStateChange]);

  useImperativeHandle(ref, () => ({ flush, markDirty }), [flush, markDirty]);

  const changeHtml = (value: string) => {
    htmlEditedRef.current = true;
    htmlRef.current = value;
    setHtml(value);
    markDirty();
  };

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
  const insertFile = (file: File | null) => {
    if (!file || file.size > 1_500_000) { if (file) setMessage(t("h5InlineAssetTooLarge")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const snippet = file.type.startsWith("audio/") ? `<audio controls src="${url}"></audio>` : file.type.startsWith("video/") ? `<video controls src="${url}"></video>` : `<img src="${url}" alt="">`;
      changeHtml(`${htmlRef.current}\n${snippet}`);
    };
    reader.readAsDataURL(file);
  };
  return <div className="space-y-3"><div><h3 className="text-sm font-medium">{t("h5Editor")}</h3><p className="mt-1 text-xs text-muted">{t("h5SecurityHint")}</p></div><Label className="grid gap-1"><span>{t("html")}</span><Textarea value={html} onChange={(event) => changeHtml(event.target.value)} rows={16} className="font-mono text-[11px]" placeholder={loading ? t("h5Loading") : undefined} /></Label><Label className="grid gap-1"><span>{t("insertLocalAsset")}</span><Input type="file" accept="image/*,audio/*,video/*" disabled={loading} onChange={(event) => insertFile(event.target.files?.[0] ?? null)} /></Label><div className="overflow-hidden rounded-lg border border-line bg-white"><iframe ref={frameRef} title={t("h5LivePreview")} sandbox="allow-scripts" srcDoc={previewHtml} className="aspect-[4/3] w-full border-0" /></div>{runtimeError && <p role="alert" className="text-xs text-rose">{t("h5RuntimeErrorWithMessage", { message: runtimeError })}</p>}<p className="text-xs text-muted">{new TextEncoder().encode(normalizeMicrocourseH5(html)).byteLength} / 5 MiB</p></div>;
});
