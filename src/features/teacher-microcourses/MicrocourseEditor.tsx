"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Save, Send, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { newId } from "@/lib/uuid";
import { DashboardCommandActions, DashboardCommandPanel } from "@/features/school/dashboard-page";
import { QuestionGroupControls, ALL_QUESTION_GROUPS, UNGROUPED_QUESTIONS } from "@/features/interactive-questions/QuestionGroupControls";
import { orderedQuestionIds, type QuestionGroup, type QuestionGroupState } from "@/features/interactive-questions/contract";
import { saveMicrocourseQuestionGroups } from "./question-group-actions";
import type { CoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import {
  CoursewareWorkbench,
  CoursewareWorkbenchAddPageButton,
  CoursewareWorkbenchPageActions,
  CoursewareWorkbenchDeletePageDialog,
  CoursewareWorkbenchDirectoryHeader,
  CoursewareWorkbenchPageRail,
  CoursewareWorkbenchPager,
} from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { useRouter } from "@/i18n/navigation";
import {
  createTeacherCompositionPageAction,
  deleteTeacherMicrocoursePageAction,
  reorderTeacherMicrocoursePagesAction,
  saveTeacherMicrocourseMetadataAction,
  selectTeacherMicrocourseVariantAction,
  submitTeacherMicrocourseReviewAction,
  withdrawTeacherMicrocourseAction,
  withdrawTeacherMicrocourseReviewAction,
} from "./actions";
import { InteractiveQuestionEditor, type InteractiveQuestionEditorHandle } from "@/features/interactive-questions/InteractiveQuestionEditor";
import type { TeacherMicrocourseEditor as EditorData } from "./data";
import { MicrocourseSourcePicker } from "./MicrocourseSourcePicker";

const NONE = "__none__";

interface PersistedPageDraft {
  pageDocId: string;
  title: string;
  doc: CoursewareCompositionPage;
  revisionNo: number;
}

interface MicrocourseEditorContext {
  title: string;
  returnHref: string;
  badgeLabel: string;
  saveLabel: string;
}

/** 微课通过共享交互题目编辑器制作内容，分组维护有序题目目录。 */
export function MicrocourseEditor({ session, context, editor, canTeach }: {
  session?: { id: string; title: string; classroomId: string; coursewareFrozenAt: string | null };
  context?: MicrocourseEditorContext;
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
  const [questionGroups, setQuestionGroups] = useState<QuestionGroupState>(editor.questionGroups ?? { version: 0, groups: [] });
  const [selectedGroup, setSelectedGroup] = useState(ALL_QUESTION_GROUPS);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(editor.pages[0]?.pageDocId ?? null);
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [pageSwitching, setPageSwitching] = useState(false);
  const [contentPending, setContentPending] = useState(false);
  const pageSwitchingRef = useRef(false);
  const workbenchRef = useRef<InteractiveQuestionEditorHandle>(null);
  const [pending, startTransition] = useTransition();

  const allPages = useMemo(() => editor.pages.map((page) => {
    const draft = pageDrafts[page.pageDocId];
    const resolved = draft ? { ...page, title: draft.title, doc: draft.doc, revisionNo: draft.revisionNo } : page;
    return pageTitleDrafts[page.pageDocId] === undefined
      ? resolved
      : { ...resolved, title: pageTitleDrafts[page.pageDocId] };
  }), [editor.pages, pageDrafts, pageTitleDrafts]);
  const assignedIds = new Set(questionGroups.groups.flatMap(group => group.questionIds));
  const orderedIds = orderedQuestionIds(allPages.map(page => page.pageDocId), questionGroups.groups);
  const pages = orderedIds.flatMap(id => {
    const page = allPages.find(item => item.pageDocId === id)!;
    return selectedGroup === ALL_QUESTION_GROUPS || (selectedGroup === UNGROUPED_QUESTIONS ? !assignedIds.has(id) : questionGroups.groups.find(g => g.id === selectedGroup)?.questionIds.includes(id)) ? [page] : [];
  });
  const currentPage = pages.find((page) => page.pageDocId === selectedPageId) ?? pages[0] ?? null;
  const currentPageIndex = currentPage ? pages.findIndex((page) => page.pageDocId === currentPage.pageDocId) : -1;
  const stage = editor.workflow?.stage ?? "idle";
  const inReview = stage === "in_review" || stage === "ready_to_publish";
  const published = Boolean(editor.publishedMetadataRevisionId && editor.currentReleaseId);

  const refresh = (nextMessage?: string) => {
    if (nextMessage) setMessage(nextMessage);
    router.refresh();
  };
  const persistCurrentPage = useCallback(async () => {
    if (contentPending) { setMessage(locale === "en" ? "Wait for the component to finish uploading." : "请等待组件上传完成。"); return false; }
    const saved = await (workbenchRef.current?.flush() ?? Promise.resolve(true));
    if (!saved) setMessage(t("pageAutosaveFailed"));
    return saved;
  }, [t, contentPending, locale]);
  const saveGroups = async (groups: QuestionGroup[], select?: string) => {
    if (!await persistCurrentPage()) return false;
    try {
      const result = await saveMicrocourseQuestionGroups({ microcourseId: editor.id, version: questionGroups.version, groups });
      if (!result.ok) { setMessage(result.code === "CONFLICT" ? (locale === "en" ? "Groups changed elsewhere. Reload before trying again." : "分组已被其他人更新，请刷新后再调整；当前题目已保存。") : t("actionFailed", { code: result.code })); return false; }
      setQuestionGroups(result.data); if (select) setSelectedGroup(select); router.refresh(); return true;
    } catch { setMessage(t("pageAutosaveFailed")); return false; }
  };
  const mutateGroups = async (groups: QuestionGroup[], select?: string) => {
    if (pageSwitchingRef.current) return false;
    pageSwitchingRef.current = true; setPageSwitching(true);
    try { return await saveGroups(groups, select); }
    finally { pageSwitchingRef.current = false; setPageSwitching(false); }
  };
  const changeGroup = async (groupId: string) => {
    if (pageSwitchingRef.current) return;
    pageSwitchingRef.current = true; setPageSwitching(true);
    if (await persistCurrentPage()) { setSelectedGroup(groupId); setSelectedPageId(null); }
    pageSwitchingRef.current = false; setPageSwitching(false);
  };
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
  const directoryItems = pages.map((page) => {
    const active = page.pageDocId === currentPage?.pageDocId;
    return {
      id: page.pageDocId,
      title: page.title,
      selectable: !active,
      disabled: pending || pageSwitching,
    };
  });
  const persistMetadata = () => saveTeacherMicrocourseMetadataAction({
    microcourseId: editor.id, title, description, grade, courseSeason, classType, primaryTopicSlug,
    keywords: keywords.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
  });
  const saveMetadata = () => startTransition(async () => {
    const result = await persistMetadata();
    setMessage(result.ok ? t("metadataSaved") : t("actionFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });
  const saveForSession = () => startTransition(async () => {
    if (!await persistCurrentPage()) return;
    const metadataResult = await persistMetadata();
    if (!metadataResult.ok) {
      setMessage(t("actionFailed", { code: metadataResult.code }));
      return;
    }
    if (session && canTeach && !session.coursewareFrozenAt && !editor.selectedForSession && allPages.length > 0) {
      const selectionResult = await selectTeacherMicrocourseVariantAction({
        sessionId: session.id,
        microcourseId: editor.id,
      });
      if (!selectionResult.ok) {
        setMessage(t("actionFailed", { code: selectionResult.code }));
        return;
      }
    }
    setMessage(t("sessionDraftSaved"));
    router.push(context?.returnHref ?? `/dashboard/sessions/${session?.id}?stage=pre`);
  });
  const submit = () => startTransition(async () => {
    if (!await persistCurrentPage()) return;
    const metadataResult = await persistMetadata();
    if (!metadataResult.ok) {
      setMessage(t("actionFailed", { code: metadataResult.code }));
      return;
    }
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
      if (questionGroups.groups.some(group => group.id === selectedGroup)) {
        const saved = await saveGroups(questionGroups.groups.map(group => group.id === selectedGroup ? { ...group, questionIds: [...group.questionIds, result.data.pageId] } : group));
        if (!saved) { setSelectedGroup(ALL_QUESTION_GROUPS); router.refresh(); return; }
      }
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
      if (!await persistCurrentPage()) return;
      const group = questionGroups.groups.find(g => g.questionIds.includes(currentPage.pageDocId));
      const destinationGroup = questionGroups.groups.find(g => g.questionIds.includes(pages[target].pageDocId));
      if (group?.id !== destinationGroup?.id) { setMessage(locale === "en" ? "Use Move to group to move this question between groups." : "跨组移动请使用“移入分组”。"); return; }
      if (group) { await saveGroups(questionGroups.groups.map(g => g.id === group.id ? { ...g, questionIds: next.filter(p => group.questionIds.includes(p.pageDocId)).map(p => p.pageDocId) } : g)); return; }
      const rest = allPages.filter(p => !next.some(item => item.pageDocId === p.pageDocId));
      const result = await reorderTeacherMicrocoursePagesAction({ microcourseId: editor.id, pageIds: [...rest, ...next].map((page) => page.pageDocId) });
      if (result.ok) refresh(t("pageOrderSaved"));
      else setMessage(t("actionFailed", { code: result.code }));
    });
  };
  const deletePage = () => startTransition(async () => {
    if (!deletePageId) return;
    const result = await deleteTeacherMicrocoursePageAction(deletePageId);
    if (result.ok) {
      setQuestionGroups(current => ({ ...current, groups: current.groups.map(group => ({ ...group, questionIds: group.questionIds.filter(id => id !== deletePageId) })) }));
      setDeletePageId(null);
      setSelectedPageId(pages.find((page) => page.pageDocId !== deletePageId)?.pageDocId ?? null);
      refresh(t("pageDeleted"));
    } else setMessage(t("actionFailed", { code: result.code }));
  });
  const handlePageAdded = async (pageId: string, nextMessage: string) => {
    if (await persistCurrentPage()) {
      setSelectedGroup(ALL_QUESTION_GROUPS);
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
              <Badge variant="secondary">{context?.badgeLabel ?? (editor.selectedForSession ? t("selectedForClass") : t("sessionDraft"))}</Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">{title ? `${title} · ${context?.title ?? session?.title ?? ""}` : context?.title ?? session?.title ?? ""}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
              {detailsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              {detailsOpen ? t("collapseDetails") : t("editDetails")}
            </Button>
            <Button type="button" size="sm" disabled={pending || !title.trim()} onClick={saveForSession}><Save className="size-4" />{context?.saveLabel ?? t(session && canTeach && !session.coursewareFrozenAt ? "saveForSessionAndReturn" : "saveDraftAndReturn")}</Button>
          </div>
        </div>
        {detailsOpen ? (
          <div className="mt-3 grid gap-3 pt-3 lg:grid-cols-12">
            <Label className="grid gap-1 lg:col-span-4"><span>{t("title")}</span><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></Label>
            <Label className="grid gap-1 lg:col-span-2"><span>{t("grade")}</span><Select value={String(grade)} onValueChange={(value) => setGrade(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 9 }, (_, index) => index + 1).map((value) => <SelectItem key={value} value={String(value)}>{t("gradeValue", { grade: value })}</SelectItem>)}</SelectContent></Select></Label>
            <Label className="grid gap-1 lg:col-span-2"><span>{t("courseSeason")}</span><Select value={courseSeason === null ? NONE : String(courseSeason)} onValueChange={(value) => setCourseSeason(value === NONE ? null : Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>{t("seasonNone")}</SelectItem>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{t(`season_${value}`)}</SelectItem>)}</SelectContent></Select></Label>
            <Label className="grid gap-1 lg:col-span-2"><span>{t("classType")}</span><Input value={classType} onChange={(event) => setClassType(event.target.value)} maxLength={40} placeholder={t("optional")} /></Label>
            <Label className="grid gap-1 lg:col-span-2"><span>{t("primaryTopic")}</span><Select value={primaryTopicSlug} onValueChange={setPrimaryTopicSlug}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{editor.topics.map((topic) => <SelectItem key={topic.id} value={topic.slug}>{locale === "en" ? topic.titleEn : topic.titleZh}</SelectItem>)}</SelectContent></Select></Label>
            <Label className="grid gap-1 lg:col-span-6"><span>{t("description")}</span><Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} /></Label>
            <Label className="grid gap-1 lg:col-span-6"><span>{t("keywords")}</span><Input value={keywords} onChange={(event) => setKeywords(event.target.value)} maxLength={400} placeholder={t("keywordsHint")} /></Label>
            <div className="flex items-end lg:col-span-12"><Button type="button" size="sm" variant="secondary" disabled={pending || !title.trim()} onClick={saveMetadata}><Save className="size-4" />{t("saveMetadata")}</Button></div>
            <div className="flex flex-wrap items-start justify-between gap-3 pt-3 lg:col-span-12">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-ink">{t("catalogSharingTitle")}</h3>
                  <Badge variant="secondary">{t(`workflow_${stage}`)}</Badge>
                  {published ? <Badge variant="outline">{editor.withdrawnAt ? t("withdrawn") : t("published")}</Badge> : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">{t("catalogSharingDescription")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {inReview
                  ? <Button type="button" variant="secondary" size="sm" disabled={pending || !editor.workflow?.activeReviewCycleId} onClick={withdrawReview}><Undo2 className="size-4" />{t("withdrawReview")}</Button>
                  : <Button type="button" variant="secondary" size="sm" disabled={pending || allPages.length === 0} onClick={submit}><Send className="size-4" />{published ? t("submitNewVersion") : t("submitReview")}</Button>}
                {published && !editor.withdrawnAt ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setWithdrawOpen(true)}>{t("withdrawPublication")}</Button> : null}
              </div>
            </div>
            <Label className="grid gap-1 lg:col-span-12"><span>{t("reviewNote")}</span><Input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} placeholder={t("reviewNoteHint")} /></Label>
          </div>
        ) : null}
        {message ? <p role="status" className="mt-2 text-xs text-muted">{message}</p> : null}
      </section>

      <DashboardCommandPanel><DashboardCommandActions>
        <QuestionGroupControls groups={questionGroups.groups.map(group => ({ id: group.id, name: group.name, count: group.questionIds.filter(id => allPages.some(p => p.pageDocId === id)).length }))}
          selected={selectedGroup} onSelect={id => void changeGroup(id)} disabled={pending || pageSwitching}
          onAdd={name => { const group = { id: newId(), name, questionIds: [] }; return mutateGroups([...questionGroups.groups, group], group.id); }}
          onRename={(id, name) => mutateGroups(questionGroups.groups.map(group => group.id === id ? { ...group, name } : group))}
          onMove={(id, direction) => { const next = [...questionGroups.groups]; const index = next.findIndex(g => g.id === id); [next[index], next[index + direction]] = [next[index + direction], next[index]]; void mutateGroups(next); }} />
        {currentPage && <Select value={questionGroups.groups.find(group => group.questionIds.includes(currentPage.pageDocId))?.id ?? UNGROUPED_QUESTIONS}
          disabled={pending || pageSwitching} onValueChange={id => startTransition(async () => { await saveGroups(questionGroups.groups.map(group => ({ ...group, questionIds: [...group.questionIds.filter(qid => qid !== currentPage.pageDocId), ...(group.id === id ? [currentPage.pageDocId] : [])] })), id); })}>
          <SelectTrigger className="w-48" aria-label={locale === "en" ? "Move question to group" : "移入分组"}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={UNGROUPED_QUESTIONS}>{locale === "en" ? "Ungrouped" : "未分组"}</SelectItem>{questionGroups.groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent>
        </Select>}
      </DashboardCommandActions></DashboardCommandPanel>

      {/* 微课目录与作业共用交互题目编辑器。 */}
      <CoursewareWorkbench
        mode="microcourse-editor"
        adapter="courseware-composition-v1"
        layout="viewport"
        layoutId={`microcourse-editor-${editor.id}`}
        className="h-[calc(100dvh-9rem)] min-h-[32rem]"
        directory={{
          ariaLabel: t("pages", { count: pages.length }),
          header: <CoursewareWorkbenchDirectoryHeader
            title={t("pages", { count: pages.length })}
            action={<CoursewareWorkbenchAddPageButton label={t("addBlank")} disabled={pending || pageSwitching} onClick={addBlank} />}
          />,
          content: <div className="flex size-full min-h-0 flex-col pt-3">
            <div className="shrink-0 px-3 pb-3"><MicrocourseSourcePicker microcourseId={editor.id} afterPageDocId={currentPage?.pageDocId ?? null} disabled={pending || pageSwitching} onAdded={(id, count) => void handlePageAdded(id, t("pagesAdded", { count }))} /></div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {[...questionGroups.groups, { id: UNGROUPED_QUESTIONS, name: locale === "en" ? "Ungrouped" : "未分组", questionIds: allPages.filter(p => !assignedIds.has(p.pageDocId)).map(p => p.pageDocId) }]
                .filter(group => selectedGroup === ALL_QUESTION_GROUPS || selectedGroup === group.id).map(group => {
                  const items = directoryItems.filter(item => group.questionIds.includes(item.id));
                  return <section key={group.id} data-question-group={group.id}>
                    <h3 className="px-3 py-2 text-xs font-medium">{group.name} · {items.length}</h3>
                    <CoursewareWorkbenchPageRail items={items} selectedIndex={items.findIndex(item => item.id === currentPage?.pageDocId)}
                      onItemTitleChange={(_item, _index, value) => renameCurrentPage(value)} titleInputLabel={t("renamePage")} titleInputDisabled={pending || pageSwitching}
                      onSelectedIndexChange={index => { if (items[index]) void selectPage(items[index].id); }} />
                  </section>;
                })}
            </div>
          </div>,
          footer: <CoursewareWorkbenchPageActions selectedIndex={currentPageIndex} total={pages.length}
            disabled={pending || pageSwitching} onMove={movePage} onDelete={() => setDeletePageId(currentPage?.pageDocId ?? null)} />,
        }}
        canvas={{
          ariaLabel: t("workspaceTitle"),
          content: currentPage
            ? <InteractiveQuestionEditor
                ref={workbenchRef}
                key={currentPage.pageDocId}
                microcourseId={editor.id}
                page={currentPage}
                onPersisted={handlePagePersisted}
                onStatus={setMessage}
                onPendingChange={setContentPending}
              />
            : <section className="grid size-full place-items-center"><p className="text-sm text-muted">{t("emptyPages")}</p></section>,
          footer: <CoursewareWorkbenchPager
            previousLabel={t("previousPage")}
            nextLabel={t("nextPage")}
            previousDisabled={pending || pageSwitching || currentPageIndex <= 0}
            nextDisabled={pending || pageSwitching || currentPageIndex < 0 || currentPageIndex >= pages.length - 1}
            onPrevious={() => {
              const previous = pages[currentPageIndex - 1];
              if (previous) void selectPage(previous.pageDocId);
            }}
            onNext={() => {
              const next = pages[currentPageIndex + 1];
              if (next) void selectPage(next.pageDocId);
            }}
            center={<span className="text-xs tabular-nums text-muted">{t("pageContext", { page: Math.max(0, currentPageIndex + 1), total: pages.length })}</span>}
          />,
        }}
        inspector={{
          ariaLabel: t("componentPanelTitle"),
          header: null,
        }}
      />

      <CoursewareWorkbenchDeletePageDialog open={deletePageId !== null} onOpenChange={(open) => { if (!open) setDeletePageId(null); }} onConfirm={deletePage} pending={pending} />
      <ConfirmDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} title={t("withdrawPublicationTitle")} description={t("withdrawPublicationDescription")} confirmLabel={t("withdrawPublication")} cancelLabel={t("cancel")} onConfirm={withdrawPublished} pending={pending} />
    </div>
  );
}
