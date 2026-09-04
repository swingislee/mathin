"use client";

import { useMemo, useState, useTransition } from "react";
import {
  BadgeCheck,
  BookOpenCheck,
  Circle,
  LoaderCircle,
  Pencil,
  Presentation,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CoursewareWorkbench } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { savePublicClassTeachingCheckpointsAction } from "./public-class-actions";
import type { PublicClassSegment, PublicClassWorkbenchData } from "./public-class";
import type { PublicClassTeachingCourseware } from "./public-class-teaching-contract";
import { DashboardSection } from "./dashboard-page";

interface TeachingProgramItem {
  segment: PublicClassSegment;
  courseware: PublicClassTeachingCourseware;
}

type PreparedPage = PublicClassTeachingCourseware["pages"][number] & {
  segment: PublicClassSegment;
};

function pageAspect(aspect: string) {
  return aspect === "4:3" ? 4 / 3 : 16 / 9;
}

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);
  const [savingPageId, setSavingPageId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [checkpointBySegment, setCheckpointBySegment] = useState<Record<string, string[]>>(() => (
    Object.fromEntries(program.map(({ segment }) => [segment.id, segment.teachingCheckpointPageIds]))
  ));
  const pages = useMemo(() => program.flatMap(({ segment, courseware }) => (
    courseware.pages.map((page): PreparedPage => ({ ...page, segment }))
  )), [program]);
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, pages.length - 1));
  const selectedPage = pages[safeSelectedIndex] ?? null;
  const selectedCheckpoint = Boolean(
    selectedPage
      && checkpointBySegment[selectedPage.segment.id]?.includes(selectedPage.pageDocId),
  );
  const checkpointCount = Object.values(checkpointBySegment).reduce((count, pageIds) => count + pageIds.length, 0);

  const toggleCheckpoint = (page: PreparedPage) => {
    if (
      !canPrepare
      || page.segment.kind !== "trial_lesson"
      || page.segment.teachingStartedAt
      || savingSegmentId
    ) return;
    const previous = checkpointBySegment[page.segment.id] ?? [];
    const next = previous.includes(page.pageDocId)
      ? previous.filter((pageId) => pageId !== page.pageDocId)
      : program
        .find(({ segment }) => segment.id === page.segment.id)
        ?.courseware.pages
        .filter((candidate) => candidate.pageDocId === page.pageDocId || previous.includes(candidate.pageDocId))
        .map((candidate) => candidate.pageDocId) ?? [...previous, page.pageDocId];
    setCheckpointBySegment((current) => ({ ...current, [page.segment.id]: next }));
    setSavingSegmentId(page.segment.id);
    setSavingPageId(page.pageDocId);
    startTransition(async () => {
      const result = await savePublicClassTeachingCheckpointsAction({
        segmentId: page.segment.id,
        pageDocIds: next,
      });
      if (!result.ok) {
        setCheckpointBySegment((current) => ({ ...current, [page.segment.id]: previous }));
        toast.error(t("actionFailed", { code: result.code }));
      } else {
        toast.success(t("teachingCheckpointsSaved"));
        router.refresh();
      }
      setSavingSegmentId(null);
      setSavingPageId(null);
    });
  };

  const items = pages.map((page) => {
    const isTrial = page.segment.kind === "trial_lesson";
    const selected = checkpointBySegment[page.segment.id]?.includes(page.pageDocId) ?? false;
    return {
      id: `${page.segment.id}:${page.pageDocId}`,
      title: `${page.segment.title} · ${page.title}`,
      leading: isTrial ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "size-7 shrink-0 rounded-full p-0",
            selected ? "bg-leaf/20 text-leaf-deep" : "text-muted",
          )}
          aria-pressed={selected}
          aria-label={t(selected ? "removeTeachingCheckpoint" : "addTeachingCheckpoint")}
          title={t(selected ? "removeTeachingCheckpoint" : "addTeachingCheckpoint")}
          disabled={!canPrepare || Boolean(page.segment.teachingStartedAt) || savingSegmentId === page.segment.id}
          onClick={(event) => {
            event.stopPropagation();
            toggleCheckpoint(page);
          }}
        >
          {savingPageId === page.pageDocId && pending
            ? <LoaderCircle className="size-3.5 animate-spin" />
            : selected
              ? <BadgeCheck className="size-4" />
              : <Circle className="size-3.5" />}
        </Button>
      ) : (
        <span className="grid size-7 shrink-0 place-items-center text-muted">
          <Presentation className="size-3.5" />
        </span>
      ),
      trailing: <span className="shrink-0 text-[10px] text-muted">{t(`kind_${page.segment.kind}`)}</span>,
    };
  });

  return <DashboardSection
    title={t("teachingPreparationTitle")}
    description={t("teachingPreparationHint")}
  >
    <div className="mb-3 divide-y divide-line">
      {program.map(({ segment, courseware }) => {
        const canEditProject = canAuthorMicrocourse
          && segment.microcourseId !== null
          && segment.microcourseAuthorId === currentUserId
          && !segment.teachingStartedAt;
        const editorHref = `/dashboard/activities/${data.activity.id}/segments/${segment.id}/microcourse`;
        return <div key={segment.id} className="flex min-w-0 flex-wrap items-center gap-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-moon/20 text-crater">
            {segment.kind === "parent_talk" ? <Presentation className="size-4" /> : <BookOpenCheck className="size-4" />}
          </span>
          <div className="min-w-48 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{segment.title}</span>
              <Badge variant="outline">{t(`kind_${segment.kind}`)}</Badge>
            </div>
            <p className={cn("mt-0.5 truncate text-xs", courseware.ready ? "text-muted" : "text-amber-700")}>{
              courseware.ready
                ? t("teachingCoursewareReady", { title: segment.microcourseLectureTitle ?? segment.title, count: courseware.pages.length })
                : segment.kind === "parent_talk" && !segment.microcourseLectureId
                  ? t("spokenTalkReady")
                  : t("candidateCoursewareMissing")
            }</p>
          </div>
          {!segment.teachingStartedAt && canEditProject ? (
            <Link href={editorHref} className={buttonVariants({ size: "sm", variant: "ghost" })}>
              <Pencil className="size-3.5" />{t("continueEditing")}
            </Link>
          ) : null}
          {!segment.teachingStartedAt && canUseCourseware && !canEditProject ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onCourseware(segment)}>
              <BookOpenCheck className="size-3.5" />
              {segment.microcourseLectureId ? t("changeCourseware") : t("chooseOrCreateCourseware")}
            </Button>
          ) : null}
        </div>;
      })}
    </div>

    <div className="h-[calc(100dvh-20rem)] min-h-[34rem]">
      <CoursewareWorkbench
        mode="preview"
        className="border-line shadow-none"
        layoutId={`public-class-preparation-${data.activity.id}`}
        items={items}
        selectedIndex={safeSelectedIndex}
        onSelectedIndexChange={setSelectedIndex}
        directoryLabel={t("teachingPreparationPages")}
        previewLabel={selectedPage?.segment.title ?? t("teachingPreview")}
        previousLabel={t("previousPage")}
        nextLabel={t("nextPage")}
        selectedPageLabel={t("pageIndicator", { current: pages.length ? safeSelectedIndex + 1 : 0, total: pages.length })}
        railStatus={<Badge variant="secondary">{t("teachingCheckpointCount", { count: checkpointCount })}</Badge>}
        railFooter={<p className="px-1 text-[11px] leading-5 text-muted">{t(canPrepare ? "teachingCheckpointHint" : "teachingCheckpointReadOnlyHint")}</p>}
        previewActions={selectedPage?.segment.kind === "trial_lesson" ? (
          <Button
            type="button"
            size="sm"
            variant={selectedCheckpoint ? "secondary" : "ghost"}
            disabled={!canPrepare || Boolean(selectedPage.segment.teachingStartedAt) || Boolean(savingSegmentId)}
            onClick={() => toggleCheckpoint(selectedPage)}
          >
            {savingPageId === selectedPage.pageDocId && pending
              ? <LoaderCircle className="size-3.5 animate-spin" />
              : selectedCheckpoint
                ? <BadgeCheck className="size-3.5" />
                : <Circle className="size-3.5" />}
            {t(selectedCheckpoint ? "removeTeachingCheckpoint" : "addTeachingCheckpoint")}
          </Button>
        ) : undefined}
        previewAspect={selectedPage ? pageAspect(selectedPage.aspect) : 4 / 3}
        preview={selectedPage
          ? <StagePreview
              doc={selectedPage.doc}
              bindingUrls={selectedPage.bindingUrls}
              stageMode={selectedPage.aspect === "4:3" ? "board43" : "natural"}
              className="size-full"
            />
          : <div className="grid size-full place-items-center px-6 text-center text-sm text-muted">{t("teachingPreviewEmpty")}</div>}
      />
    </div>
  </DashboardSection>;
}
