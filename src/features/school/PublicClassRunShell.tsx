"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  CircleAlert,
  GitBranch,
  LoaderCircle,
  MapPin,
  MonitorPlay,
  Presentation,
  UsersRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoursewareWorkbench } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  endPublicClassRunAction,
  startPublicClassRunAction,
} from "./public-class-actions";
import type { PublicClassSegment, PublicClassWorkbenchData } from "./public-class";
import type { PublicClassTeachingCourseware } from "./public-class-teaching";
import { PublicClassRosterView } from "./PublicClassWorkspace";

export type PublicClassLiveMode = "host" | "assessment" | "roster";

export interface PublicClassRunProgramItem {
  segment: PublicClassSegment;
  courseware: PublicClassTeachingCourseware;
}

function pageAspect(aspect: string) {
  return aspect === "4:3" ? 4 / 3 : 16 / 9;
}

function placeFor(segment: PublicClassSegment) {
  if (segment.roomName) return [segment.campusName, segment.roomName].filter(Boolean).join(" · ");
  return segment.location;
}

export function PublicClassRunShell({
  data,
  program,
  assessmentSegment,
  canTeach,
  canRecord,
  locale,
  defaultMode,
}: {
  data: PublicClassWorkbenchData;
  program: PublicClassRunProgramItem[];
  assessmentSegment: PublicClassSegment | null;
  canTeach: boolean;
  canRecord: boolean;
  locale: string;
  defaultMode: PublicClassLiveMode;
}) {
  const t = useTranslations("school.publicClass");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<PublicClassLiveMode>(defaultMode);
  const [endOpen, setEndOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const initialPhase = program.some((item) => item.segment.teachingStartedAt)
    ? program.filter((item) => item.segment.microcourseLectureId).every((item) => item.segment.teachingEndedAt)
      ? "ended"
      : "live"
    : "candidate";
  const [phase, setPhase] = useState<"candidate" | "live" | "ended">(initialPhase);
  const pages = useMemo(() => program.flatMap((item) => item.courseware.pages.map((page) => ({
    ...page,
    segment: item.segment,
  }))), [program]);
  const selectedPage = pages[selectedIndex] ?? pages[0] ?? null;
  const requiredTrialBlocks = program.filter((item) => item.segment.kind === "trial_lesson");
  const linkedOptionalBlocks = program.filter((item) => item.segment.kind === "parent_talk" && item.segment.microcourseLectureId);
  const ready = requiredTrialBlocks.length > 0
    && requiredTrialBlocks.every((item) => item.courseware.ready)
    && linkedOptionalBlocks.every((item) => item.courseware.ready);
  const rosterSegment = program.find((item) => item.segment.kind === "trial_lesson")?.segment
    ?? assessmentSegment
    ?? data.segments[0]
    ?? null;
  const dashboardHref = `/dashboard/activities/${data.activity.id}?view=live`;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (phase !== "live" || mode !== "host" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("input, textarea, select, button, [role='dialog'], [role='tab']")) return;
      const direction = event.key === "ArrowLeft" || event.key === "PageUp"
        ? -1
        : event.key === "ArrowRight" || event.key === "PageDown" || event.key === " "
          ? 1
          : 0;
      if (!direction) return;
      event.preventDefault();
      setSelectedIndex((current) => Math.max(0, Math.min(pages.length - 1, current + direction)));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, pages.length, phase]);

  const runRecordAction = (
    action: () => Promise<{ ok: true; data?: unknown } | { ok: false; code: string }>,
    success: string,
    after?: () => void,
  ) => startTransition(async () => {
    const result = await action();
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(success);
    after?.();
    router.refresh();
  });

  const startRun = () => startTransition(async () => {
    const result = await startPublicClassRunAction(data.activity.id);
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    setPhase("live");
    toast.success(t("runStarted"));
    router.refresh();
  });

  const endRun = () => startTransition(async () => {
    const result = await endPublicClassRunAction(data.activity.id);
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    setEndOpen(false);
    setPhase("ended");
    toast.success(t("runEnded"));
    router.refresh();
  });

  return <main className="flex min-h-dvh flex-col bg-paper px-3 py-3 sm:px-5">
    <header className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
      <Link href={dashboardHref} aria-label={t("backToEvent")} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-moon/30 hover:text-ink"><ArrowLeft className="size-4" /></Link>
      <div className="min-w-52 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate font-display text-xl text-ink">{data.activity.title}</h1>
          <Badge variant="secondary">{t(`runPhase_${phase}`)}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(data.activity.scheduledAt))} · {data.activity.location || "—"}</p>
      </div>
      <Tabs value={mode} onValueChange={(value) => setMode(value as PublicClassLiveMode)}>
        <TabsList aria-label={t("liveRoleViews")}>
          <TabsTrigger value="host"><MonitorPlay className="mr-1.5 size-3.5" />{t("modeHost")}</TabsTrigger>
          {assessmentSegment ? <TabsTrigger value="assessment"><BookOpenCheck className="mr-1.5 size-3.5" />{t("modeAssessment")}</TabsTrigger> : null}
          <TabsTrigger value="roster"><UsersRound className="mr-1.5 size-3.5" />{t("modeRoster")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {phase === "live" && canTeach ? <Button size="sm" variant="ghost" className="text-rose" onClick={() => setEndOpen(true)}>{t("endPublicClass")}</Button> : null}
    </header>

    {mode === "host" ? <HostRunSurface
      data={data}
      program={program}
      assessmentSegment={assessmentSegment}
      phase={phase}
      pages={pages}
      selectedIndex={selectedIndex}
      selectedPage={selectedPage}
      ready={ready}
      canTeach={canTeach}
      pending={pending}
      onSelectedIndexChange={setSelectedIndex}
      onStart={startRun}
    /> : null}

    {mode === "assessment" ? <section className="min-h-0 flex-1 pt-4">
      {assessmentSegment ? <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-display text-lg text-ink">{assessmentSegment.title}</h2><p className="mt-1 text-xs text-muted">{t("liveAssessmentHint")}</p></div>
          <Badge variant="outline"><MapPin className="mr-1 size-3" />{placeFor(assessmentSegment) || t("roomUnassigned")}</Badge>
        </div>
        <PublicClassRosterView data={data} locale={locale} segment={assessmentSegment} canRecord={canRecord} pending={pending} run={runRecordAction} />
      </> : <div className="grid min-h-[24rem] place-items-center text-sm text-muted">{t("noGroupAssessment")}</div>}
    </section> : null}

    {mode === "roster" ? <section className="min-h-0 flex-1 pt-4">
      <div className="mb-3"><h2 className="font-display text-lg text-ink">{t("supportWorkspace")}</h2><p className="mt-1 text-xs text-muted">{t("liveRosterFullHint")}</p></div>
      <PublicClassRosterView data={data} locale={locale} segment={rosterSegment} canRecord={canRecord} pending={pending} run={runRecordAction} />
    </section> : null}

    <ConfirmDialog
      open={endOpen}
      onOpenChange={setEndOpen}
      title={t("endRunTitle")}
      description={t("endRunDescription")}
      confirmLabel={t("endRunConfirm")}
      cancelLabel={t("cancel")}
      pending={pending}
      onConfirm={endRun}
    />
  </main>;
}

function HostRunSurface({
  data,
  program,
  assessmentSegment,
  phase,
  pages,
  selectedIndex,
  selectedPage,
  ready,
  canTeach,
  pending,
  onSelectedIndexChange,
  onStart,
}: {
  data: PublicClassWorkbenchData;
  program: PublicClassRunProgramItem[];
  assessmentSegment: PublicClassSegment | null;
  phase: "candidate" | "live" | "ended";
  pages: Array<PublicClassTeachingCourseware["pages"][number] & { segment: PublicClassSegment }>;
  selectedIndex: number;
  selectedPage: (PublicClassTeachingCourseware["pages"][number] & { segment: PublicClassSegment }) | null;
  ready: boolean;
  canTeach: boolean;
  pending: boolean;
  onSelectedIndexChange: (index: number) => void;
  onStart: () => void;
}) {
  const t = useTranslations("school.publicClass");
  const firstPreview = pages[0] ?? null;

  if (phase === "ended") return <section className="grid min-h-[calc(100dvh-5rem)] place-items-center px-4 py-12">
    <div className="w-full max-w-xl text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-leaf/15 text-leaf-deep"><Check className="size-6" /></span>
      <h2 className="mt-5 font-display text-2xl text-ink">{t("runCompleteTitle")}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{t("runCompleteHint")}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href={`/dashboard/activities/${data.activity.id}?view=review`} className={buttonVariants({ size: "sm" })}>{t("openPostReview")}</Link>
        <Link href={`/dashboard/activities/${data.activity.id}?view=live`} className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("openOnsiteRecords")}</Link>
      </div>
    </div>
  </section>;

  if (phase === "candidate") return <section className="mx-auto grid w-full max-w-7xl flex-1 gap-6 py-6 lg:grid-cols-[minmax(20rem,0.78fr)_minmax(34rem,1.22fr)]">
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{t("candidateChecklistEyebrow")}</p>
      <h2 className="mt-2 font-display text-2xl text-ink">{t("runCandidateTitle")}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{t("runCandidateHint")}</p>
      <div className="mt-5 divide-y divide-line border-y border-line">
        {program.map(({ segment, courseware }) => {
          const optionalTalk = segment.kind === "parent_talk" && !segment.microcourseLectureId;
          const ok = courseware.ready || optionalTalk;
          return <div key={segment.id} className="flex items-start gap-3 py-3">
            <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", ok ? "bg-leaf/15 text-leaf-deep" : "bg-crater/10 text-crater")}>{ok ? <Check className="size-4" /> : <BookOpenCheck className="size-4" />}</span>
            <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink">{segment.title}</p><p className="mt-0.5 text-xs leading-5 text-muted">{courseware.ready ? t("candidateCoursewareReady", { count: courseware.pages.length }) : optionalTalk ? t("spokenTalkReady") : t("candidateCoursewareMissing")}</p></div>
            <Badge variant="outline">{t(`kind_${segment.kind}`)}</Badge>
          </div>;
        })}
        <div className="flex items-start gap-3 py-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-moon/20 text-crater"><UsersRound className="size-4" /></span>
          <div><p className="text-sm font-medium text-ink">{t("candidateRoster", { count: data.participants.filter((item) => item.status !== "cancelled").length })}</p><p className="mt-0.5 text-xs leading-5 text-muted">{t("singleRunRosterHint")}</p></div>
        </div>
        {assessmentSegment ? <div className="flex items-start gap-3 py-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-moon/20 text-crater"><GitBranch className="size-4" /></span>
          <div><p className="text-sm font-medium text-ink">{t("parallelAssessmentReady")}</p><p className="mt-0.5 text-xs leading-5 text-muted">{t("parallelAssessmentCandidateHint", { title: assessmentSegment.title })}</p></div>
        </div> : null}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || !canTeach || !ready} onClick={onStart}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <MonitorPlay className="size-4" />}{t("startPublicClass")}</Button>
        <Link href={`/dashboard/activities/${data.activity.id}?view=prepare`} className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("backToPreparation")}</Link>
      </div>
      {!ready ? <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-amber-700"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{t("runNotReadyHint")}</p> : null}
      {!canTeach ? <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{t("candidateReadOnlyHint")}</p> : null}
    </div>
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 pb-2 text-xs text-muted"><span>{t("candidateFirstPage")}</span><span className="tabular-nums">{pages.length ? `1 / ${pages.length}` : "0 / 0"}</span></div>
      <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-card shadow-sm">{firstPreview ? <StagePreview doc={firstPreview.doc} bindingUrls={firstPreview.bindingUrls} stageMode={firstPreview.aspect === "4:3" ? "board43" : "natural"} className="size-full" /> : <div className="grid size-full place-items-center px-8 text-center text-sm text-muted">{t("candidateNoPreview")}</div>}</div>
      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><Presentation className="mt-0.5 size-3.5 shrink-0" />{t("continuousPresentationHint")}</p>
    </div>
  </section>;

  return <section className="flex min-h-0 flex-1 flex-col pt-2">
    <CoursewareWorkbench
      mode="preview"
      className="min-h-0 flex-1 border-0 shadow-none"
      layoutId={`public-class-run-${data.activity.id}`}
      items={pages.map((page) => ({ id: page.pageDocId, title: `${page.segment.title} · ${page.pageNo}. ${page.title}` }))}
      selectedIndex={selectedIndex}
      onSelectedIndexChange={onSelectedIndexChange}
      directoryLabel={t("runProgramPages")}
      previewLabel={selectedPage?.segment.title ?? t("teachingStage")}
      previousLabel={t("previousPage")}
      nextLabel={t("nextPage")}
      selectedPageLabel={t("pageIndicator", { current: selectedIndex + 1, total: pages.length })}
      railStatus={<div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline">{t("frozenForTeaching")}</Badge>{selectedPage?.segment.kind === "parent_talk" && assessmentSegment ? <Badge variant="secondary"><GitBranch className="mr-1 size-3" />{t("assessmentRunningInParallel")}</Badge> : null}</div>}
      previewAspect={selectedPage ? pageAspect(selectedPage.aspect) : 4 / 3}
      preview={selectedPage ? <StagePreview doc={selectedPage.doc} bindingUrls={selectedPage.bindingUrls} stageMode={selectedPage.aspect === "4:3" ? "board43" : "natural"} className="size-full" /> : <div className="grid size-full place-items-center text-sm text-muted">{t("candidateNoPreview")}</div>}
    />
  </section>;
}
