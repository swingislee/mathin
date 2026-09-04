"use client";

import { useMemo, useState, useTransition } from "react";
import { BookOpenCheck, LoaderCircle, Pencil, Plus, Presentation } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useRouter } from "@/i18n/navigation";
import {
  CoursewareOverlayEditor,
  type CoursewareLearningCheckDraft,
} from "./CoursewareOverlayEditor";
import type { CoursewareTemplatePage } from "./courseware-overlay";
import {
  createPublicClassMicrocourseProjectAction,
  linkPublicClassSegmentMicrocourseAction,
  savePublicClassTeachingCheckpointsAction,
} from "./public-class-actions";
import type { PublicClassSegment, PublicClassWorkbenchData } from "./public-class";
import type { PublicClassTeachingCourseware } from "./public-class-teaching-contract";
import { TeachingPreparationSurface } from "./TeachingPreparationSurface";
import { CoursePicker } from "./teaching-operations/CoursePicker";
import type { ClassBuildCourseDetail } from "./teaching-operations/course-picker-types";

const NONE = "__none__";

interface TeachingProgramItem {
  segment: PublicClassSegment;
  courseware: PublicClassTeachingCourseware;
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
    <section className="flex h-[calc(100dvh-14rem)] min-h-[36rem] min-w-0 flex-col" data-public-class-preparation-adapter>
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{t("teachingPreparationTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted">{t("teachingPreparationHint")}</p>
        </div>
        <Badge variant={selectedProgram.courseware.ready ? "secondary" : "outline"}>
          {selectedProgram.courseware.ready
            ? t("teachingCoursewareReady", {
                title: selectedProgram.segment.microcourseLectureTitle ?? selectedProgram.segment.title,
                count: selectedProgram.courseware.pages.length,
              })
            : t("candidateCoursewareMissing")}
        </Badge>
      </header>

      {program.length > 1 ? (
        <Tabs value={selectedProgram.segment.id} onValueChange={setSelectedSegmentId} className="mb-3 shrink-0">
          <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
            {program.map(({ segment }) => (
              <TabsTrigger key={segment.id} value={segment.id} className="gap-1.5">
                {segment.kind === "parent_talk"
                  ? <Presentation className="size-3.5" />
                  : <BookOpenCheck className="size-3.5" />}
                {segment.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      <SegmentPreparation
        key={selectedProgram.segment.id}
        activityId={data.activity.id}
        segment={selectedProgram.segment}
        courseware={selectedProgram.courseware}
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
  catalog,
  canPrepare,
  canUseCourseware,
  canAuthorMicrocourse,
  currentUserId,
}: {
  activityId: string;
  segment: PublicClassSegment;
  courseware: PublicClassTeachingCourseware;
  catalog: readonly ClassBuildCourseDetail[];
  canPrepare: boolean;
  canUseCourseware: boolean;
  canAuthorMicrocourse: boolean;
  currentUserId: string;
}) {
  const t = useTranslations("school.publicClass");
  const router = useRouter();
  const [savingCourseware, startSavingCourseware] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const currentCourse = catalog.find((item) => item.id === segment.microcourseCourseId) ?? null;
  const [selectedCourse, setSelectedCourse] = useState<ClassBuildCourseDetail | null>(currentCourse);
  const [selectedLectureId, setSelectedLectureId] = useState(segment.microcourseLectureId ?? NONE);

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
  const canEditProject = canAuthorMicrocourse
    && segment.microcourseId !== null
    && segment.microcourseAuthorId === currentUserId
    && !segment.teachingStartedAt;
  const editorHref = `/dashboard/activities/${activityId}/segments/${segment.id}/microcourse`;
  const learningChecksReadOnly = !canPrepare
    || segment.kind !== "trial_lesson"
    || Boolean(segment.teachingStartedAt);
  const selectionChanged = selectedCourse?.id !== segment.microcourseCourseId
    || (selectedCourse ? selectedLectureId !== segment.microcourseLectureId : segment.microcourseLectureId !== null);

  const selectCourse = (course: ClassBuildCourseDetail) => {
    setSelectedCourse(course);
    const currentLectureStillBelongs = course.lectures.some((lecture) => lecture.id === selectedLectureId);
    if (!currentLectureStillBelongs) setSelectedLectureId(course.lectures[0]?.id ?? NONE);
  };
  const clearCourse = () => {
    setSelectedCourse(null);
    setSelectedLectureId(NONE);
  };
  const saveCourseware = () => startSavingCourseware(async () => {
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
    router.refresh();
  });
  const saveLearningChecks = async (items: CoursewareLearningCheckDraft[]) => {
    const result = await savePublicClassTeachingCheckpointsAction({
      segmentId: segment.id,
      pageDocIds: items.flatMap((item) => item.sourcePageId ? [item.sourcePageId] : []),
    });
    if (result.ok) router.refresh();
    return result;
  };

  return (
    <div className="min-h-0 flex-1">
      <TeachingPreparationSurface
        flow={(
          <aside className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pr-1">
            <section className="rounded-xl border border-line bg-card/70 p-3">
              <h3 className="text-sm font-medium text-ink">{t("chooseCoursewareFor", { title: segment.title })}</h3>
              <p className="mt-1 text-xs leading-5 text-muted">{t("microcourseReuseHint")}</p>
              <div className="mt-3">
                <CoursePicker
                  purpose="production"
                  selected={selectedCourse}
                  onSelect={selectCourse}
                  onClear={clearCourse}
                  disabled={!canUseCourseware || Boolean(segment.teachingStartedAt)}
                  fixedCourseKind="microcourse"
                  catalog={catalog}
                  showMicrocourseMetadataFilters={false}
                />
              </div>
              {selectedCourse ? (
                <Label className="mt-3 grid gap-1.5 text-xs font-normal text-muted">
                  {t("chooseLecture")}
                  <Select value={selectedLectureId} onValueChange={setSelectedLectureId} disabled={!canUseCourseware || Boolean(segment.teachingStartedAt)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {selectedCourse.lectures.map((lecture) => (
                        <SelectItem key={lecture.id} value={lecture.id}>
                          {t("lectureLabel", { no: lecture.no, title: lecture.name })}{lecture.ready ? "" : ` · ${t("draft")}`}
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
                  disabled={savingCourseware || !selectionChanged || Boolean(selectedCourse && selectedLectureId === NONE)}
                  onClick={saveCourseware}
                >
                  {savingCourseware ? <LoaderCircle className="size-4 animate-spin" /> : <BookOpenCheck className="size-4" />}
                  {t("useSelection")}
                </Button>
              ) : null}
            </section>

            {!segment.teachingStartedAt && (canEditProject || canAuthorMicrocourse) ? (
              <section className="mt-3 rounded-xl border border-line bg-card/70 p-3">
                <h3 className="text-sm font-medium text-ink">{t("coursewareAuthoringTitle")}</h3>
                <p className="mt-1 text-xs leading-5 text-muted">{t("coursewareAuthoringHint")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canEditProject ? (
                    <Link href={editorHref} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                      <Pencil className="size-3.5" />{t("continueEditing")}
                    </Link>
                  ) : null}
                  {canAuthorMicrocourse ? (
                    <Button type="button" size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>
                      <Plus className="size-3.5" />{t("createCoursewareHere")}
                    </Button>
                  ) : null}
                </div>
              </section>
            ) : null}
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
              learningChecksReadOnly={learningChecksReadOnly}
              saveLearningChecks={saveLearningChecks}
              readOnly
              structureReadOnly
              frozen={Boolean(segment.teachingStartedAt)}
            />
          </section>
        )}
      />

      {createOpen ? (
        <CreateMicrocourseDialog
          activityId={activityId}
          segment={segment}
          close={() => setCreateOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CreateMicrocourseDialog({
  activityId,
  segment,
  close,
}: {
  activityId: string;
  segment: PublicClassSegment;
  close: () => void;
}) {
  const t = useTranslations("school.publicClass");
  const router = useRouter();
  const [creating, startCreating] = useTransition();
  const [courseTitle, setCourseTitle] = useState(segment.microcourseCourseTitle ?? segment.title);
  const [lectureTitle, setLectureTitle] = useState(segment.title);
  const [grade, setGrade] = useState("1");
  const create = () => startCreating(async () => {
    const result = await createPublicClassMicrocourseProjectAction({
      segmentId: segment.id,
      courseTitle,
      lectureTitle,
      grade: Number(grade),
    });
    if (!result.ok) {
      toast.error(result.code === "MICROCOURSE_ALREADY_EXISTS"
        ? t("microcourseAlreadyExists")
        : t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(t("microcourseCreated"));
    router.push(`/dashboard/activities/${activityId}/segments/${segment.id}/microcourse`);
    router.refresh();
  });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("createCoursewareHere")}</DialogTitle>
          <DialogDescription>{t("createCoursewareHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label className="grid gap-1.5 text-xs text-muted">{t("microcourseTitle")}
            <Input value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} maxLength={100} />
          </Label>
          <Label className="grid gap-1.5 text-xs text-muted">{t("firstLectureTitle")}
            <Input value={lectureTitle} onChange={(event) => setLectureTitle(event.target.value)} maxLength={120} />
          </Label>
          <Label className="grid gap-1.5 text-xs text-muted">{t("applicableGrade")}
            <Select value={grade} onValueChange={setGrade}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 9 }, (_, index) => index + 1).map((value) => <SelectItem key={value} value={String(value)}>{t("gradeValue", { grade: value })}</SelectItem>)}</SelectContent>
            </Select>
          </Label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>{t("cancel")}</Button>
          <Button disabled={creating || !courseTitle.trim() || !lectureTitle.trim()} onClick={create}>
            {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{t("createAndEdit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
