"use client";

import { useMemo, useState } from "react";
import { BookOpenCheck, Pencil, Presentation } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useRouter } from "@/i18n/navigation";
import {
  CoursewareOverlayEditor,
  type CoursewareLearningCheckDraft,
} from "./CoursewareOverlayEditor";
import type { CoursewareTemplatePage } from "./courseware-overlay";
import { savePublicClassTeachingCheckpointsAction } from "./public-class-actions";
import type { PublicClassSegment, PublicClassWorkbenchData } from "./public-class";
import type { PublicClassTeachingCourseware } from "./public-class-teaching-contract";

interface TeachingProgramItem {
  segment: PublicClassSegment;
  courseware: PublicClassTeachingCourseware;
}

/**
 * Public classes keep only an activity-specific segment selector and data
 * adapter here. The preparation surface itself is the same
 * CoursewareOverlayEditor used by formal class sessions.
 */
export function PublicClassTeachingPreparation({
  data,
  program,
  canPrepare,
  canUseCourseware,
  canAuthorMicrocourse,
  currentUserId,
  onCourseware,
}: {
  data: PublicClassWorkbenchData;
  program: TeachingProgramItem[];
  canPrepare: boolean;
  canUseCourseware: boolean;
  canAuthorMicrocourse: boolean;
  currentUserId: string;
  onCourseware: (segment: PublicClassSegment) => void;
}) {
  const t = useTranslations("school.publicClass");
  const router = useRouter();
  const [selectedSegmentId, setSelectedSegmentId] = useState(program[0]?.segment.id ?? "");
  const selectedProgram = program.find(({ segment }) => segment.id === selectedSegmentId) ?? program[0] ?? null;
  const selectedSegment = selectedProgram?.segment ?? null;
  const courseware = selectedProgram?.courseware ?? null;

  const template = useMemo<CoursewareTemplatePage[]>(() => courseware?.pages.map((page) => ({
    id: page.pageDocId,
    type: "doc",
    docId: page.pageDocId,
    title: page.title,
  })) ?? [], [courseware]);
  const checkpointIds = useMemo(
    () => new Set(selectedSegment?.teachingCheckpointPageIds ?? []),
    [selectedSegment?.teachingCheckpointPageIds],
  );
  const initialLearningChecks = useMemo(() => template.flatMap((page, index) => (
    page.type === "doc" && checkpointIds.has(page.docId)
      ? [{ id: page.docId, position: index + 1, title: page.title, sourcePageId: page.docId }]
      : []
  )), [checkpointIds, template]);

  if (!selectedProgram || !selectedSegment || !courseware) {
    return <p className="grid min-h-[28rem] place-items-center text-sm text-muted">{t("noSegments")}</p>;
  }

  const canEditProject = canAuthorMicrocourse
    && selectedSegment.microcourseId !== null
    && selectedSegment.microcourseAuthorId === currentUserId
    && !selectedSegment.teachingStartedAt;
  const editorHref = `/dashboard/activities/${data.activity.id}/segments/${selectedSegment.id}/microcourse`;
  const learningChecksReadOnly = !canPrepare
    || selectedSegment.kind !== "trial_lesson"
    || Boolean(selectedSegment.teachingStartedAt);
  const saveLearningChecks = async (items: CoursewareLearningCheckDraft[]) => {
    const result = await savePublicClassTeachingCheckpointsAction({
      segmentId: selectedSegment.id,
      pageDocIds: items.flatMap((item) => item.sourcePageId ? [item.sourcePageId] : []),
    });
    if (result.ok) router.refresh();
    return result;
  };

  return (
    <section
      className="flex h-[calc(100dvh-14rem)] min-h-[36rem] min-w-0 flex-col"
      data-public-class-preparation-adapter
    >
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{t("teachingPreparationTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted">{t("teachingPreparationHint")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={courseware.ready ? "secondary" : "outline"}>
            {courseware.ready
              ? t("teachingCoursewareReady", {
                  title: selectedSegment.microcourseLectureTitle ?? selectedSegment.title,
                  count: courseware.pages.length,
                })
              : t("candidateCoursewareMissing")}
          </Badge>
          {!selectedSegment.teachingStartedAt && canEditProject ? (
            <Link href={editorHref} className={buttonVariants({ size: "sm", variant: "secondary" })}>
              <Pencil className="size-3.5" />{t("continueEditing")}
            </Link>
          ) : null}
          {!selectedSegment.teachingStartedAt && canUseCourseware && !canEditProject ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => onCourseware(selectedSegment)}>
              <BookOpenCheck className="size-3.5" />
              {selectedSegment.microcourseLectureId ? t("changeCourseware") : t("chooseOrCreateCourseware")}
            </Button>
          ) : null}
        </div>
      </header>

      {program.length > 1 ? (
        <Tabs value={selectedSegment.id} onValueChange={setSelectedSegmentId} className="mb-3 shrink-0">
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

      <div className="min-h-0 flex-1" data-shared-formal-preparation-surface>
        <CoursewareOverlayEditor
          key={`${selectedSegment.id}:${selectedSegment.teachingCheckpointPageIds.join(",")}`}
          sessionId={selectedSegment.id}
          template={template}
          initialOverlay={template.map((page) => ({ ref: page.id }))}
          docPreviews={courseware.pages.map((page) => ({
            pageDocId: page.pageDocId,
            doc: page.doc,
            bindingUrls: page.bindingUrls,
          }))}
          annotations={[]}
          solutionRecords={[]}
          learningCheckPages={selectedSegment.kind === "trial_lesson"
            ? courseware.pages.map((page) => ({
                pageDocId: page.pageDocId,
                pageNo: page.pageNo,
                title: page.title,
                learningCheckEnabled: false,
              }))
            : []}
          initialLearningChecks={initialLearningChecks}
          learningChecksLocked={selectedSegment.kind !== "trial_lesson" || Boolean(selectedSegment.teachingStartedAt)}
          learningChecksConfigured
          learningChecksReadOnly={learningChecksReadOnly}
          saveLearningChecks={saveLearningChecks}
          readOnly
          structureReadOnly
          frozen={Boolean(selectedSegment.teachingStartedAt)}
        />
      </div>
    </section>
  );
}
