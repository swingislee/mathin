"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Play, Plus, Save, Send, Trash2, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { useRouter } from "@/i18n/navigation";
import {
  createTeacherCompositionPageAction,
  deleteTeacherMicrocoursePageAction,
  freezeTeacherMicrocourseSourceSessionAction,
  reorderTeacherMicrocoursePagesAction,
  saveTeacherMicrocourseMetadataAction,
  submitTeacherMicrocourseReviewAction,
  withdrawTeacherMicrocourseAction,
  withdrawTeacherMicrocourseReviewAction,
} from "./actions";
import { CoursewareCompositionWorkbench, type CoursewareCompositionWorkbenchHandle } from "./CoursewareCompositionWorkbench";
import type { TeacherMicrocourseEditor as EditorData } from "./data";
import { MicrocourseSourcePicker } from "./MicrocourseSourcePicker";

const NONE = "__none__";

interface PersistedPageDraft {
  pageDocId: string;
  title: string;
  doc: CoursewareCompositionPage;
  revisionNo: number;
}

/** One teacher authoring shell backed exclusively by CoursewareCompositionWorkbench. */
export function MicrocourseEditor({ session, editor, canTeach }: {
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
  const workbenchRef = useRef<CoursewareCompositionWorkbenchHandle>(null);
  const [pending, startTransition] = useTransition();

  const pages = useMemo(() => editor.pages.map((page) => {
    const draft = pageDrafts[page.pageDocId];
    const resolved = draft ? { ...page, title: draft.title, doc: draft.doc, revisionNo: draft.revisionNo } : page;
    return pageTitleDrafts[page.pageDocId] === undefined ? resolved : { ...resolved, title: pageTitleDrafts[page.pageDocId] };
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
    if (await persistCurrentPage()) setSelectedPageId(pageDocId);
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
      microcourseId: editor.id, title, description, grade, courseSeason, classType, primaryTopicSlug,
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
      if (!result.ok) {
        setMessage(t("actionFailed", { code: result.code }));
        return;
      }
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
    if (result.ok) {
      setSelectedPageId(result.data.pageId);
      refresh(t("pageAdded"));
    } else setMessage(t("actionFailed", { code: result.code }));
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
      if (result.ok) refresh(t("pageOrderSaved"));
      else setMessage(t("actionFailed", { code: result.code }));
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
    if (await persistCurrentPage()) {
      setSelectedPageId(pageId);
      setMessage(nextMessage);
    }
    router.refresh();
  };

  return (
    <div className="space-y-4" data-teacher-microcourse-editor="composition">
      <section aria-label={t("workspaceTitle")}>
        <div className="flex flex-wrap items-center justify-between gap-3 py-1">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-medium">{t("workspaceTitle")}</h2>
              <Badge variant="secondary">{t(`workflow_${stage}`)}</Badge>
              {published ? <Badge variant="outline">{editor.withdrawnAt ? t("withdrawn") : t("published")}</Badge> : null}
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
            {canTeach ? <Button type="button" variant="secondary" size="sm" disabled={pending || pages.length === 0} onClick={startClass}><Play className="size-4" />{session.coursewareFrozenAt ? t("enterClass") : t("freezeAndTeach")}</Button> : null}
            {published && !editor.withdrawnAt ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setWithdrawOpen(true)}>{t("withdrawPublication")}</Button> : null}
          </div>
        </div>
        {detailsOpen ? (
          <div className="mt-3 grid gap-3 bg-moon/15 p-4 lg:grid-cols-12">
            <Label className="grid gap-1 lg:col-span-4"><span>{t("title")}</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></Label>
            <Label className="grid gap-1 lg:col-span-2"><span>{t("grade")}</span><Select value={String(grade)} onValueChange={(value) => setGrade(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 9 }, (_, index) => index + 1).map((value) => <SelectItem key={value} value={String(value)}>{t("gradeValue", { grade: value })}</SelectItem>)}</SelectContent></Select></Label>
            <Label className="grid gap-1 lg:col-span-2"><span>{t("courseSeason")}</span><Select value={courseSeason === null ? NONE : String(courseSeason)} onValueChange={(value) => setCourseSeason(value === NONE ? null : Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>{t("seasonNone")}</SelectItem>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{t(`season_${value}`)}</SelectItem>)}</SelectContent></Select></Label>
            <Label className="grid gap-1 lg:col-span-2"><span>{t("classType")}</span><Input value={classType} onChange={(event) => setClassType(event.target.value)} maxLength={40} placeholder={t("optional")} /></Label>
            <Label className="grid gap-1 lg:col-span-2"><span>{t("primaryTopic")}</span><Select value={primaryTopicSlug} onValueChange={setPrimaryTopicSlug}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{editor.topics.map((topic) => <SelectItem key={topic.id} value={topic.slug}>{locale === "en" ? topic.titleEn : topic.titleZh}</SelectItem>)}</SelectContent></Select></Label>
            <Label className="grid gap-1 lg:col-span-6"><span>{t("description")}</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} /></Label>
            <Label className="grid gap-1 lg:col-span-6"><span>{t("keywords")}</span><Input value={keywords} onChange={(event) => setKeywords(event.target.value)} maxLength={400} placeholder={t("keywordsHint")} /></Label>
            <Label className="grid gap-1 lg:col-span-10"><span>{t("reviewNote")}</span><Input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} placeholder={t("reviewNoteHint")} /></Label>
            <div className="flex items-end lg:col-span-2"><Button type="button" size="sm" disabled={pending || !title.trim()} onClick={saveMetadata}><Save className="size-4" />{t("saveMetadata")}</Button></div>
          </div>
        ) : null}
        {message ? <p role="status" className="mt-2 text-xs text-muted">{message}</p> : null}
      </section>

      <div className="grid h-[calc(100dvh-9rem)] min-h-[32rem] overflow-hidden xl:grid-cols-[18rem_minmax(0,1fr)]">
        <nav className="flex min-h-0 flex-col overflow-hidden bg-moon/10 xl:border-r xl:border-line/80" aria-label={t("pages", { count: pages.length })}>
          <div className="flex items-center justify-between px-3 py-2.5">
            <h2 className="text-sm font-medium">{t("pages", { count: pages.length })}</h2>
            <Button type="button" size="sm" variant="ghost" className="size-8 p-0" disabled={pending || pageSwitching} onClick={addBlank} aria-label={t("addBlank")}><Plus className="size-4" /></Button>
          </div>
          <div className="px-3 pb-3"><MicrocourseSourcePicker microcourseId={editor.id} afterPageDocId={currentPage?.pageDocId ?? null} disabled={pending || pageSwitching} onAdded={(id, count) => void handlePageAdded(id, t("pagesAdded", { count }))} /></div>
          <ScrollArea className="min-h-0 flex-1">
            <ol className="space-y-1 px-2 pb-3">
              {pages.map((page) => {
                const active = page.pageDocId === currentPage?.pageDocId;
                return <li key={page.pageDocId}>
                  {active ? (
                    <div className="flex items-center gap-2 bg-crater/10 px-2 py-1.5 text-ink">
                      <span className="w-5 shrink-0 text-xs text-muted">{page.pageNo}</span>
                      <Input aria-label={t("renamePage")} value={page.title} maxLength={200} className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-1" onChange={(event) => renameCurrentPage(event.target.value)} />
                    </div>
                  ) : (
                    <Button type="button" variant="ghost" disabled={pending || pageSwitching} onClick={() => void selectPage(page.pageDocId)} className="h-10 w-full justify-start rounded-md px-2 text-left">
                      <span className="w-5 shrink-0 text-xs text-muted">{page.pageNo}</span><span className="min-w-0 truncate text-sm">{page.title}</span>
                    </Button>
                  )}
                </li>;
              })}
            </ol>
          </ScrollArea>
          <div className="grid grid-cols-3 gap-1 p-2">
            <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage || currentPage.pageNo <= 1} onClick={() => movePage(-1)} aria-label={t("moveUp")}><ArrowUp className="size-4" /></Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage || currentPage.pageNo >= pages.length} onClick={() => movePage(1)} aria-label={t("moveDown")}><ArrowDown className="size-4" /></Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending || !currentPage} onClick={() => setDeletePageId(currentPage?.pageDocId ?? null)} aria-label={t("deletePage")}><Trash2 className="size-4 text-rose" /></Button>
          </div>
        </nav>
        {currentPage
          ? <CoursewareCompositionWorkbench ref={workbenchRef} key={currentPage.pageDocId} microcourseId={editor.id} page={currentPage} onPersisted={handlePagePersisted} onStatus={setMessage} />
          : <section className="grid place-items-center"><p className="text-sm text-muted">{t("emptyPages")}</p></section>}
      </div>

      <ConfirmDialog open={deletePageId !== null} onOpenChange={(open) => { if (!open) setDeletePageId(null); }} title={t("deletePageTitle")} description={t("deletePageDescription")} confirmLabel={t("deletePage")} cancelLabel={t("cancel")} onConfirm={deletePage} pending={pending} />
      <ConfirmDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} title={t("withdrawPublicationTitle")} description={t("withdrawPublicationDescription")} confirmLabel={t("withdrawPublication")} cancelLabel={t("cancel")} onConfirm={withdrawPublished} pending={pending} />
    </div>
  );
}
