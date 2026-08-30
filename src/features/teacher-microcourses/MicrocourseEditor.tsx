"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import type { MicrocoursePageDoc } from "@/features/courseware-doc/microcourse-schema";
import type { DocNode, PageDoc } from "@/features/courseware-doc/schema";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  createTeacherCompositionPageAction,
  deleteTeacherMicrocoursePageAction,
  freezeTeacherMicrocourseSourceSessionAction,
  reorderTeacherMicrocoursePagesAction,
  saveTeacherMicrocourseMetadataAction,
  saveTeacherMicrocoursePageAction,
  submitTeacherMicrocourseReviewAction,
  uploadTeacherMicrocourseImageAction,
  withdrawTeacherMicrocourseAction,
  withdrawTeacherMicrocourseReviewAction,
} from "./actions";
import type { TeacherMicrocourseEditor as EditorData, TeacherMicrocoursePage } from "./data";
import { MicrocourseSourcePicker } from "./MicrocourseSourcePicker";
import type { LegacyTeacherCompositionPage, TeacherMicrocoursePageDoc } from "./page-doc";
import {
  CoursewareCompositionWorkbench,
  type CoursewareCompositionWorkbenchHandle,
} from "./CoursewareCompositionWorkbench";

const NONE = "__none__";
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
  return t("mode_composition");
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
  rename?: (title: string) => void;
}

type LegacyTeacherMicrocoursePageDoc = LegacyTeacherCompositionPage;

export function MicrocourseEditor({
  session,
  editor,
  canTeach,
}: {
  session: { id: string; title: string; classroomId: string; coursewareFrozenAt: string | null };
  editor: EditorData;
  canTeach: boolean;
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
  const [pageTitleDrafts, setPageTitleDrafts] = useState<Record<string, string>>({});
  const [selectedPageId, setSelectedPageId] = useState<string | null>(editor.pages[0]?.pageDocId ?? null);
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [pageSwitching, setPageSwitching] = useState(false);
  const pageSwitchingRef = useRef(false);
  const workbenchRef = useRef<MicrocoursePageWorkbenchHandle | CoursewareCompositionWorkbenchHandle>(null);
  const [pending, startTransition] = useTransition();

  const pages = useMemo(() => editor.pages.map((page) => {
    const draft = pageDrafts[page.pageDocId];
    const resolved = draft ? { ...page, title: draft.title, doc: draft.doc, revisionNo: draft.revisionNo, h5Html: draft.h5Html } : page;
    return pageTitleDrafts[page.pageDocId] === undefined
      ? resolved
      : { ...resolved, title: pageTitleDrafts[page.pageDocId] };
  }), [editor.pages, pageDrafts, pageTitleDrafts]);
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
    setPageTitleDrafts((current) => {
      if (current[draft.pageDocId] === undefined) return current;
      const next = { ...current };
      delete next[draft.pageDocId];
      return next;
    });
  }, []);
  const renameCurrentPage = (value: string) => {
    if (!currentPage) return;
    setPageTitleDrafts((current) => ({ ...current, [currentPage.pageDocId]: value }));
    workbenchRef.current?.rename?.(value);
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
      <section className="border-y border-line">
        <header className="px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-medium">{t("workspaceTitle")}</h2>
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
              {canTeach && <Button type="button" variant="secondary" size="sm" disabled={pending || pages.length === 0} onClick={startClass}><Play className="size-4" />{session.coursewareFrozenAt ? t("enterClass") : t("freezeAndTeach")}</Button>}
              {published && !editor.withdrawnAt && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setWithdrawOpen(true)}>{t("withdrawPublication")}</Button>}
            </div>
          </div>
        </header>
        {detailsOpen && <div className="grid gap-3 border-t border-line px-3 py-4 lg:grid-cols-12">
          <Label className="grid gap-1 lg:col-span-4"><span>{t("title")}</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("grade")}</span><Select value={String(grade)} onValueChange={(value) => setGrade(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 9 }, (_, index) => index + 1).map((value) => <SelectItem key={value} value={String(value)}>{t("gradeValue", { grade: value })}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("courseSeason")}</span><Select value={courseSeason === null ? NONE : String(courseSeason)} onValueChange={(value) => setCourseSeason(value === NONE ? null : Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>{t("seasonNone")}</SelectItem>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{t(`season_${value}`)}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("classType")}</span><Input value={classType} onChange={(event) => setClassType(event.target.value)} maxLength={40} placeholder={t("optional")} /></Label>
          <Label className="grid gap-1 lg:col-span-2"><span>{t("primaryTopic")}</span><Select value={primaryTopicSlug} onValueChange={setPrimaryTopicSlug}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{editor.topics.map((topic) => <SelectItem key={topic.id} value={topic.slug}>{locale === "en" ? topic.titleEn : topic.titleZh}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid gap-1 lg:col-span-6"><span>{t("description")}</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} /></Label>
          <Label className="grid gap-1 lg:col-span-6"><span>{t("keywords")}</span><Input value={keywords} onChange={(event) => setKeywords(event.target.value)} maxLength={400} placeholder={t("keywordsHint")} /></Label>
          <Label className="grid gap-1 lg:col-span-10"><span>{t("reviewNote")}</span><Input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} placeholder={t("reviewNoteHint")} /></Label>
          <div className="flex items-end lg:col-span-2"><Button type="button" size="sm" disabled={pending || !title.trim()} onClick={saveMetadata}><Save className="size-4" />{t("saveMetadata")}</Button></div>
        </div>}
        {message && <p role="status" className="border-t border-line px-3 py-2 text-xs text-muted">{message}</p>}
      </section>

      <div className="grid h-[calc(100dvh-9rem)] min-h-[32rem] border-y border-line xl:grid-cols-[18rem_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden border-b border-line xl:border-b-0 xl:border-r">
          <header className="border-b border-line px-3 py-2.5"><h2 className="text-sm font-medium">{t("pages", { count: pages.length })}</h2></header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <div className="border-y border-crater/60 bg-moon/25 p-2">
              <p className="mb-2 px-1 text-xs font-medium text-muted">{t("pageCreateHint")}</p>
              <div className="grid gap-2">
                <Button type="button" size="sm" variant="secondary" className="justify-start" disabled={pending || pageSwitching} onClick={addBlank}><Plus className="size-4" />{t("addBlank")}</Button>
              <MicrocourseSourcePicker microcourseId={editor.id} afterPageDocId={currentPage?.pageDocId ?? null} disabled={pending || pageSwitching} onAdded={(id, count) => void handlePageAdded(id, t("pagesAdded", { count }))} />
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <ol className="space-y-2 pr-2">
                {pages.map((page) => <li key={page.pageDocId}>
                  {page.pageDocId === currentPage?.pageDocId ? (
                    <div className="rounded-xl border border-crater bg-moon/30 px-3 py-2 text-ink">
                      <div className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-xs text-muted">{page.pageNo}</span>
                        <Input aria-label={t("renamePage")} value={page.title} maxLength={200} className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-1" onChange={(event) => renameCurrentPage(event.target.value)} />
                      </div>
                      <span className="ml-7 block text-xs font-normal text-muted">{pageModeLabel(page, t)}</span>
                    </div>
                  ) : (
                    <Button type="button" variant="ghost" disabled={pending || pageSwitching} onClick={() => void selectPage(page.pageDocId)} className="h-auto w-full justify-start rounded-xl border border-line px-3 py-2 text-left">
                      <span className="w-5 shrink-0 text-xs text-muted">{page.pageNo}</span><span className="min-w-0"><span className="block truncate text-sm">{page.title}</span><span className="block text-xs font-normal text-muted">{pageModeLabel(page, t)}</span></span>
                    </Button>
                  )}
                </li>)}
              </ol>
            </ScrollArea>
            <div className="grid grid-cols-3 gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage || currentPage.pageNo <= 1} onClick={() => movePage(-1)} aria-label={t("moveUp")}><ArrowUp className="size-4" /></Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage || currentPage.pageNo >= pages.length} onClick={() => movePage(1)} aria-label={t("moveDown")}><ArrowDown className="size-4" /></Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage} onClick={() => setDeletePageId(currentPage?.pageDocId ?? null)} aria-label={t("deletePage")}><Trash2 className="size-4 text-rose" /></Button>
            </div>
          </div>
        </section>
        {currentPage
          ? isCoursewareCompositionPage(currentPage.doc)
            ? <CoursewareCompositionWorkbench ref={workbenchRef} key={currentPage.pageDocId} microcourseId={editor.id} page={{ ...currentPage, doc: currentPage.doc }} onPersisted={handlePagePersisted} onStatus={setMessage} />
            : <MicrocoursePageWorkbench ref={workbenchRef} key={currentPage.pageDocId} microcourseId={editor.id} page={{ ...currentPage, doc: currentPage.doc }} onPersisted={handlePagePersisted} onStatus={setMessage} />
          : <section className="grid place-items-center"><p className="text-sm text-muted">{t("emptyPages")}</p></section>}
      </div>

      <ConfirmDialog open={deletePageId !== null} onOpenChange={(open) => { if (!open) setDeletePageId(null); }} title={t("deletePageTitle")} description={t("deletePageDescription")} confirmLabel={t("deletePage")} cancelLabel={t("cancel")} onConfirm={deletePage} pending={pending} />
      <ConfirmDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} title={t("withdrawPublicationTitle")} description={t("withdrawPublicationDescription")} confirmLabel={t("withdrawPublication")} cancelLabel={t("cancel")} onConfirm={withdrawPublished} pending={pending} />
    </div>
  );
}

const MicrocoursePageWorkbench = forwardRef<MicrocoursePageWorkbenchHandle, {
  microcourseId: string;
  page: Omit<TeacherMicrocoursePage, "doc"> & { doc: LegacyTeacherMicrocoursePageDoc; h5Html?: string };
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
      if (isCoursewareCompositionPage(result.data.doc)) {
        setSaveState("error");
        setMessage(t("pageAutosaveFailed"));
        return false;
      }
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

  const flush = flushDoc;

  useEffect(() => { flushRef.current = flush; }, [flush]);
  useImperativeHandle(ref, () => ({ flush }), [flush]);

  const markDocDirty = useCallback(() => {
    sequenceRef.current += 1;
    setSaveState("dirty");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 800);
  }, []);

  const updateDoc: React.Dispatch<React.SetStateAction<LegacyTeacherMicrocoursePageDoc>> = useCallback((nextValue) => {
    const next = typeof nextValue === "function"
      ? (nextValue as (current: LegacyTeacherMicrocoursePageDoc) => LegacyTeacherMicrocoursePageDoc)(docRef.current)
      : nextValue;
    docRef.current = next;
    setDoc(next);
    markDocDirty();
  }, [markDocDirty]);

  const changeTitle = (value: string) => {
    titleRef.current = value;
    setTitle(value);
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

  return <section className="min-w-0 overflow-hidden">
    <header className="border-b border-line px-3 py-2.5">
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
    </header>
    <div className="grid min-h-[38rem] lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 p-4"><div className="mx-auto max-w-4xl overflow-hidden border border-line bg-white"><StagePreview doc={doc} bindingUrls={bindingUrls} stageMode="natural" className="w-full" interactive /></div>{doc.source && <p className="mt-2 text-xs text-muted">{t("lockedSource", { title: doc.source.sourceTitle, page: doc.source.sourcePageNo })}</p>}</div>
      <ScrollArea className="h-[35rem] border-t border-line bg-paper/50 lg:border-l lg:border-t-0"><div className="p-4">
        <CompositionControls microcourseId={microcourseId} page={page} doc={doc} setDoc={updateDoc} bindingUrls={bindingUrls} setBindingUrls={setBindingUrls} pending={pending} startTransition={startTransition} setMessage={setMessage} />
      </div></ScrollArea>
    </div>
  </section>;
});

function CompositionControls({ microcourseId, page, doc, setDoc, bindingUrls, setBindingUrls, pending, startTransition, setMessage }: {
  microcourseId: string;
  page: TeacherMicrocoursePage;
  initialHtml?: string;
  doc: Extract<MicrocoursePageDoc, { mode: "composition" }>;
  setDoc: React.Dispatch<React.SetStateAction<LegacyTeacherMicrocoursePageDoc>>;
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
