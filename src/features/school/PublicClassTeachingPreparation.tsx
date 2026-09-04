"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { BookOpenCheck, LoaderCircle, Presentation, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MicrocourseWorkspaceButton } from "@/features/teacher-microcourses/MicrocourseWorkspaceButton";
import { useRouter } from "@/i18n/navigation";
import {
  CoursewareOverlayEditor,
  type CoursewareLearningCheckDraft,
} from "./CoursewareOverlayEditor";
import type { CoursewareTemplatePage } from "./courseware-overlay";
import {
  linkPublicClassSegmentMicrocourseAction,
  savePublicClassLessonPlanAction,
  savePublicClassPreparationArtifactsAction,
  savePublicClassTeachingCheckpointsAction,
} from "./public-class-actions";
import type { PublicClassSegment, PublicClassWorkbenchData } from "./public-class";
import type { PublicClassPreparationData } from "./public-class-preparation";
import type { PublicClassTeachingCourseware } from "./public-class-teaching-contract";
import { TeachingLessonPlanWorkspace } from "./SessionLessonPlanWorkspace";
import {
  TeachingPreparationFlow,
  type TeachingPreparationArtifactsDraft,
} from "./SessionPreparationFlow";
import { TeachingPreparationSurface } from "./TeachingPreparationSurface";
import { CoursePicker } from "./teaching-operations/CoursePicker";
import type { ClassBuildCourseDetail } from "./teaching-operations/course-picker-types";
import type { TeachingLessonPlanSaveInput } from "./SessionLessonPlanEditor";

const NONE = "__none__";

interface TeachingProgramItem {
  segment: PublicClassSegment;
  courseware: PublicClassTeachingCourseware;
  preparation: PublicClassPreparationData;
}

export function PublicClassTeachingPreparation({
  data,
  program,
  canPrepare,
  canUseCourseware,
  canAuthorMicrocourse,
  currentUserId,
}: {
  data: PublicClassWorkbenchData;
  program: TeachingProgramItem[];
  canPrepare: boolean;
  canUseCourseware: boolean;
  canAuthorMicrocourse: boolean;
  currentUserId: string;
}) {
  const t = useTranslations("school.publicClass");
  const [selectedSegmentId, setSelectedSegmentId] = useState(program[0]?.segment.id ?? "");
  const selectedProgram = program.find(({ segment }) => segment.id === selectedSegmentId) ?? program[0] ?? null;

  if (!selectedProgram) {
    return <p className="grid min-h-[28rem] place-items-center text-sm text-muted">{t("noSegments")}</p>;
  }

  return (
    <section
      className="flex h-[calc(100dvh-12rem)] min-h-[36rem] min-w-0 flex-col"
      data-public-class-preparation-adapter
    >
      <SegmentPreparation
        key={selectedProgram.segment.id}
        activityId={data.activity.id}
        segment={selectedProgram.segment}
        courseware={selectedProgram.courseware}
        preparation={selectedProgram.preparation}
        program={program}
        selectedSegmentId={selectedProgram.segment.id}
        onSelectedSegmentIdChange={setSelectedSegmentId}
        catalog={data.microcourseCatalog}
        canPrepare={canPrepare}
        canUseCourseware={canUseCourseware}
        canAuthorMicrocourse={canAuthorMicrocourse}
        currentUserId={currentUserId}
      />
    </section>
  );
}

function SegmentPreparation({
  activityId,
  segment,
  courseware,
  preparation,
  program,
  selectedSegmentId,
  onSelectedSegmentIdChange,
  catalog,
  canPrepare,
  canUseCourseware,
  canAuthorMicrocourse,
  currentUserId,
}: {
  activityId: string;
  segment: PublicClassSegment;
  courseware: PublicClassTeachingCourseware;
  preparation: PublicClassPreparationData;
  program: TeachingProgramItem[];
  selectedSegmentId: string;
  onSelectedSegmentIdChange: (segmentId: string) => void;
  catalog: readonly ClassBuildCourseDetail[];
  canPrepare: boolean;
  canUseCourseware: boolean;
  canAuthorMicrocourse: boolean;
  currentUserId: string;
}) {
  const sessionT = useTranslations("school.session");
  const router = useRouter();
  const template = useMemo<CoursewareTemplatePage[]>(() => courseware.pages.map((page) => ({
    id: page.pageDocId,
    type: "doc",
    docId: page.pageDocId,
    title: page.title,
  })), [courseware]);
  const checkpointIds = useMemo(
    () => new Set(segment.teachingCheckpointPageIds),
    [segment.teachingCheckpointPageIds],
  );
  const initialLearningChecks = useMemo(() => template.flatMap((page, index) => (
    page.type === "doc" && checkpointIds.has(page.docId)
      ? [{ id: page.docId, position: index + 1, title: page.title, sourcePageId: page.docId }]
      : []
  )), [checkpointIds, template]);
  const readOnly = !canPrepare || Boolean(segment.teachingStartedAt);
  const canEditProject = canAuthorMicrocourse
    && segment.microcourseId !== null
    && segment.microcourseAuthorId === currentUserId
    && !segment.teachingStartedAt;
  const canOpenMicrocourseWorkspace = !segment.teachingStartedAt
    && (canEditProject || (canAuthorMicrocourse && segment.microcourseId === null));
  const editorHref = `/dashboard/activities/${activityId}/segments/${segment.id}/microcourse`;

  const saveArtifacts = useCallback((draft: TeachingPreparationArtifactsDraft) => (
    savePublicClassPreparationArtifactsAction({ segmentId: segment.id, ...draft })
  ), [segment.id]);
  const saveLessonPlan = useCallback(({ targetId, ...input }: TeachingLessonPlanSaveInput) => (
    savePublicClassLessonPlanAction({ segmentId: targetId, ...input })
  ), []);
  const saveLearningChecks = useCallback(async (items: CoursewareLearningCheckDraft[]) => {
    const result = await savePublicClassTeachingCheckpointsAction({
      segmentId: segment.id,
      pageDocIds: items.flatMap((item) => item.sourcePageId ? [item.sourcePageId] : []),
    });
    if (result.ok) router.refresh();
    return result;
  }, [router, segment.id]);

  const segmentSwitcher = program.length > 1 ? (
    <Tabs value={selectedSegmentId} onValueChange={onSelectedSegmentIdChange} className="min-w-0">
      <TabsList className="h-8 max-w-[22rem] justify-start overflow-x-auto bg-line/35 p-0.5">
        {program.map(({ segment: option }) => (
          <TabsTrigger key={option.id} value={option.id} className="h-7 gap-1 px-2 text-[11px]">
            {option.kind === "parent_talk"
              ? <Presentation className="size-3.5" />
              : <BookOpenCheck className="size-3.5" />}
            <span className="max-w-28 truncate">{option.title}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  ) : null;

  const previewHeaderLeading = (
    <div className="flex min-w-0 items-center gap-1.5">
      {segmentSwitcher}
      <CoursewareBindingPopover
        segment={segment}
        catalog={catalog}
        canUseCourseware={canUseCourseware}
      />
      {canOpenMicrocourseWorkspace ? (
        <MicrocourseWorkspaceButton
          href={editorHref}
          label={sessionT("editCourseware")}
          compact
          className="max-w-40"
        />
      ) : null}
    </div>
  );

  return (
    <TeachingPreparationSurface
      flow={(
        <aside className="@container flex min-h-0 min-w-0 flex-1 flex-col">
          <TeachingPreparationFlow
            scopeId={segment.id}
            initial={preparation.artifacts}
            solutionRecords={[]}
            solutionPageLabels={Object.fromEntries(courseware.pages.map((page) => [page.pageDocId, page.title]))}
            solutionPagePreviews={courseware.pages.map((page) => ({
              pageDocId: page.pageDocId,
              doc: page.doc,
              bindingUrls: page.bindingUrls,
            }))}
            lessonPlanEditor={(
              <TeachingLessonPlanWorkspace
                lessonPlan={preparation.lessonPlan}
                readOnly={readOnly}
                saveLessonPlan={saveLessonPlan}
              />
            )}
            lessonPlanPresent={preparation.lessonPlan.revision > 0}
            saveArtifacts={saveArtifacts}
            readOnly={readOnly}
            reviewerReadOnly
            showReviewer={false}
            statusMode="presence"
          />
        </aside>
      )}
      courseware={(
        <section className="@container flex min-h-0 min-w-0 flex-1 flex-col" data-shared-formal-preparation-surface>
          <CoursewareOverlayEditor
            key={`${segment.id}:${segment.teachingCheckpointPageIds.join(",")}`}
            sessionId={segment.id}
            template={template}
            initialOverlay={template.map((page) => ({ ref: page.id }))}
            docPreviews={courseware.pages.map((page) => ({
              pageDocId: page.pageDocId,
              doc: page.doc,
              bindingUrls: page.bindingUrls,
            }))}
            annotations={[]}
            solutionRecords={[]}
            learningCheckPages={segment.kind === "trial_lesson"
              ? courseware.pages.map((page) => ({
                  pageDocId: page.pageDocId,
                  pageNo: page.pageNo,
                  title: page.title,
                  learningCheckEnabled: false,
                }))
              : []}
            initialLearningChecks={initialLearningChecks}
            learningChecksLocked={segment.kind !== "trial_lesson" || Boolean(segment.teachingStartedAt)}
            learningChecksConfigured
            learningChecksReadOnly={readOnly || segment.kind !== "trial_lesson"}
            saveLearningChecks={saveLearningChecks}
            previewHeaderLeading={previewHeaderLeading}
            readOnly
            structureReadOnly
            frozen={Boolean(segment.teachingStartedAt)}
          />
        </section>
      )}
    />
  );
}

function CoursewareBindingPopover({
  segment,
  catalog,
  canUseCourseware,
}: {
  segment: PublicClassSegment;
  catalog: readonly ClassBuildCourseDetail[];
  canUseCourseware: boolean;
}) {
  const t = useTranslations("school.publicClass");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const currentCourse = catalog.find((item) => item.id === segment.microcourseCourseId) ?? null;
  const [selectedCourse, setSelectedCourse] = useState<ClassBuildCourseDetail | null>(currentCourse);
  const [selectedLectureId, setSelectedLectureId] = useState(segment.microcourseLectureId ?? NONE);
  const selectionChanged = selectedCourse?.id !== segment.microcourseCourseId
    || (selectedCourse ? selectedLectureId !== segment.microcourseLectureId : segment.microcourseLectureId !== null);
  const disabled = !canUseCourseware || Boolean(segment.teachingStartedAt);

  const selectCourse = (course: ClassBuildCourseDetail) => {
    setSelectedCourse(course);
    if (!course.lectures.some((lecture) => lecture.id === selectedLectureId)) {
      setSelectedLectureId(course.lectures[0]?.id ?? NONE);
    }
  };
  const clearCourse = () => {
    setSelectedCourse(null);
    setSelectedLectureId(NONE);
  };
  const save = () => startSaving(async () => {
    const result = await linkPublicClassSegmentMicrocourseAction({
      segmentId: segment.id,
      courseId: selectedCourse?.id ?? null,
      lectureId: selectedCourse && selectedLectureId !== NONE ? selectedLectureId : null,
    });
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(t("coursewareSaved"));
    setOpen(false);
    router.refresh();
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 max-w-44 gap-1.5 px-2 text-xs"
          title={segment.microcourseCourseTitle ?? t("chooseCourseware")}
        >
          <Settings2 className="size-3.5 shrink-0" />
          <span className="truncate">{segment.microcourseLectureTitle ?? t("chooseCourseware")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] p-3">
        <div className="mb-3">
          <p className="text-sm font-medium text-ink">{t("chooseCoursewareFor", { title: segment.title })}</p>
          <p className="mt-0.5 text-xs text-muted">{t("microcourseReuseHint")}</p>
        </div>
        <CoursePicker
          purpose="production"
          selected={selectedCourse}
          onSelect={selectCourse}
          onClear={clearCourse}
          disabled={disabled}
          fixedCourseKind="microcourse"
          catalog={catalog}
          showMicrocourseMetadataFilters={false}
        />
        {selectedCourse ? (
          <Label className="mt-3 grid gap-1.5 text-xs font-normal text-muted">
            {t("chooseLecture")}
            <Select value={selectedLectureId} onValueChange={setSelectedLectureId} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {selectedCourse.lectures.map((lecture) => (
                  <SelectItem key={lecture.id} value={lecture.id}>
                    {t("lectureLabel", { no: lecture.no, title: lecture.name })}
                    {lecture.ready ? "" : ` · ${t("draft")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        ) : null}
        {canUseCourseware && !segment.teachingStartedAt ? (
          <Button
            type="button"
            size="sm"
            className="mt-3 w-full"
            disabled={saving || !selectionChanged || Boolean(selectedCourse && selectedLectureId === NONE)}
            onClick={save}
          >
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <BookOpenCheck className="size-4" />}
            {t("useSelection")}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
