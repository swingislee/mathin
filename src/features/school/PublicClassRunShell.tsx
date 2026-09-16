"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  Check,
  CircleAlert,
  GitBranch,
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
import { ClassroomPreparation, type ClassroomPreparationCheck } from "@/features/classroom/preparation/ClassroomPreparation";
import { useClassroomPreparation } from "@/features/classroom/preparation/useClassroomPreparation";
import { classroomRehearsalHref } from "@/features/classroom/preparation/schedule-contract";
import { useClassroomPaging } from "@/features/classroom/live/useClassroomPaging";
import { useRehearsalRoom } from "@/features/classroom/live/useRehearsalRoom";
import { DocCoursewarePage } from "@/features/classroom/live/DocCoursewarePage";
import { RehearsalDevices } from "@/features/classroom/preparation/RehearsalDevices";
import { createClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { enterFromPreparation, initialClassroomView, type ClassroomEntry, type ClassroomRunMode, type ClassroomRunState } from "@/features/classroom/preparation/preparation-contract";
import {
  endPublicClassRunAction,
  startPublicClassRunAction,
} from "./public-class-actions";
import type { PublicClassSegment, PublicClassWorkbenchData } from "./public-class";
import type { PublicClassTeachingCourseware } from "./public-class-teaching-contract";
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
  userId,
  display = false,
  rehearsal = false,
  entry = null,
}: {
  data: PublicClassWorkbenchData;
  program: PublicClassRunProgramItem[];
  assessmentSegment: PublicClassSegment | null;
  canTeach: boolean;
  canRecord: boolean;
  locale: string;
  defaultMode: PublicClassLiveMode;
  userId: string;
  display?: boolean;
  rehearsal?: boolean;
  entry?: ClassroomEntry;
}) {
  const t = useTranslations("school.publicClass");
  const tPreparation = useTranslations("classroom.preparation");
  const router = useRouter();
  const classroomRootRef = useRef<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<PublicClassLiveMode>(defaultMode);
  const [endOpen, setEndOpen] = useState(false);
  const [localSelectedIndex, setLocalSelectedIndex] = useState(0);
  const initialRunState = program.some((item) => item.segment.teachingStartedAt)
    ? program.filter((item) => item.segment.microcourseLectureId).every((item) => item.segment.teachingEndedAt)
      ? "ended"
      : "started"
    : "scheduled";
  const [runState, setRunState] = useState<ClassroomRunState>(initialRunState);
  const runMode: ClassroomRunMode = rehearsal ? "rehearsal" : "formal";
  const preparation = useClassroomPreparation(display ? "live" : initialClassroomView({ mode: runMode, runState, entry }));
  const phase = preparation.phase === "prep" ? "candidate" : !rehearsal && runState === "ended" ? "ended" : "live";
  const pages = useMemo(() => program.flatMap((item) => item.courseware.pages.map((page) => ({
    ...page,
    segment: item.segment,
  }))), [program]);
  const rehearsalPages = useMemo(() => pages.map((page) => ({ id: page.pageDocId, type: "doc" as const, docId: page.pageDocId, title: page.title })), [pages]);
  const rehearsalRoom = useRehearsalRoom(userId, data.activity.id, rehearsalPages, rehearsal);
  const canControl = canTeach && !display;
  const selectedIndex = rehearsal ? rehearsalRoom.state.currentPage : localSelectedIndex;
  const selectPage = (index: number) => {
    if (!canControl) return;
    const page = Math.max(0, Math.min(pages.length - 1, index));
    if (rehearsal) void rehearsalRoom.log?.append("page", { page });
    else setLocalSelectedIndex(page);
  };
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

  useClassroomPaging({
    enabled: phase === "live" && mode === "host" && canControl && pages.length > 0,
    rootRef: classroomRootRef,
    onPage: (direction) => {
      selectPage(selectedIndex + direction);
    },
  });

  const runRecordAction = (
    action: () => Promise<{ ok: true; data?: unknown } | { ok: false; code: string }>,
    success: string,
    after?: () => void,
  ) => startTransition(async () => {
    if (rehearsal) return;
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
    if (pending) return;
    try {
      await enterFromPreparation({
        mode: runMode,
        runState,
        canEnter: canControl,
        startFormal: async () => {
          const result = await startPublicClassRunAction(data.activity.id);
          if (!result.ok) throw new Error(result.code);
          setRunState("started");
          toast.success(t("runStarted"));
          router.refresh();
        },
        enterStage: preparation.enterStage,
      });
    } catch (error) {
      toast.error(t("actionFailed", { code: error instanceof Error ? error.message : "UNKNOWN" }));
    }
  });

  const endRun = () => startTransition(async () => {
    if (!canTeach || rehearsal) return;
    const result = await endPublicClassRunAction(data.activity.id);
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    setEndOpen(false);
    setRunState("ended");
    toast.success(t("runEnded"));
    router.refresh();
  });

  return <main ref={classroomRootRef} className="flex min-h-dvh flex-col bg-paper px-3 py-3 sm:px-5">
    <header className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
      <Link href={dashboardHref} aria-label={t("backToEvent")} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-moon/30 hover:text-ink"><ArrowLeft className="size-4" /></Link>
      <div className="min-w-52 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate font-display text-xl text-ink">{data.activity.title}</h1>
          <Badge variant="secondary">{rehearsal ? tPreparation("rehearsal") : t(`runPhase_${runState === "scheduled" ? "candidate" : runState === "started" ? "live" : "ended"}`)}</Badge>
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
      {rehearsal && <><Badge variant="secondary">{tPreparation(rehearsalRoom.connected ? "devicesOnline" : "devicesOffline")}</Badge><Badge variant="secondary">{tPreparation("devicesPaired", { count: rehearsalRoom.health.peers })}</Badge><RehearsalDevices /></>}
      {canControl && phase !== "candidate" && <Button size="sm" variant="secondary" onClick={() => {
        setMode("host");
        preparation.openPreparation();
      }}>{tPreparation("entry")}</Button>}
      {phase === "live" && canTeach && !rehearsal ? <Button size="sm" variant="ghost" className="text-rose" onClick={() => setEndOpen(true)}>{t("endPublicClass")}</Button> : null}
    </header>

    {mode === "host" ? <HostRunSurface
      data={data}
      program={program}
      assessmentSegment={assessmentSegment}
      phase={phase}
      runState={runState}
      runMode={runMode}
      stageMounted={preparation.stageMounted}
      pages={pages}
      selectedIndex={selectedIndex}
      selectedPage={selectedPage}
      ready={ready}
      canTeach={canControl}
      pending={pending}
      onSelectedIndexChange={selectPage}
      onStart={startRun}
      rehearsalRoom={rehearsalRoom}
    /> : null}

    {mode === "assessment" ? <section className="min-h-0 flex-1 pt-4">
      {assessmentSegment ? <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-display text-lg text-ink">{assessmentSegment.title}</h2><p className="mt-1 text-xs text-muted">{t("liveAssessmentHint")}</p></div>
          <Badge variant="outline"><MapPin className="mr-1 size-3" />{placeFor(assessmentSegment) || t("roomUnassigned")}</Badge>
        </div>
        <PublicClassRosterView data={data} locale={locale} segment={assessmentSegment} canRecord={canRecord && !rehearsal} pending={pending} run={runRecordAction} />
      </> : <div className="grid min-h-[24rem] place-items-center text-sm text-muted">{t("noGroupAssessment")}</div>}
    </section> : null}

    {mode === "roster" ? <section className="min-h-0 flex-1 pt-4">
      <div className="mb-3"><h2 className="font-display text-lg text-ink">{t("supportWorkspace")}</h2><p className="mt-1 text-xs text-muted">{t("liveRosterFullHint")}</p></div>
      <PublicClassRosterView data={data} locale={locale} segment={rosterSegment} canRecord={canRecord && !rehearsal} pending={pending} run={runRecordAction} />
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
  runState,
  runMode,
  stageMounted,
  pages,
  selectedIndex,
  selectedPage,
  ready,
  canTeach,
  pending,
  onSelectedIndexChange,
  onStart,
  rehearsalRoom,
}: {
  data: PublicClassWorkbenchData;
  program: PublicClassRunProgramItem[];
  assessmentSegment: PublicClassSegment | null;
  phase: "candidate" | "live" | "ended";
  runState: ClassroomRunState;
  runMode: ClassroomRunMode;
  stageMounted: boolean;
  pages: Array<PublicClassTeachingCourseware["pages"][number] & { segment: PublicClassSegment }>;
  selectedIndex: number;
  selectedPage: (PublicClassTeachingCourseware["pages"][number] & { segment: PublicClassSegment }) | null;
  ready: boolean;
  canTeach: boolean;
  pending: boolean;
  onSelectedIndexChange: (index: number) => void;
  onStart: () => void;
  rehearsalRoom: ReturnType<typeof useRehearsalRoom>;
}) {
  const t = useTranslations("school.publicClass");
  const tPreparation = useTranslations("classroom.preparation");
  const firstPreview = pages[0] ?? null;
  const router = useRouter();

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

  const checks: ClassroomPreparationCheck[] = program.map(({ segment, courseware }) => {
    const optionalTalk = segment.kind === "parent_talk" && !segment.microcourseLectureId;
    return {
      key: segment.id,
      status: courseware.ready || optionalTalk ? "ready" : "warning",
      label: segment.title,
      hint: courseware.ready
        ? t("candidateCoursewareReady", { count: courseware.pages.length })
          + (segment.kind === "trial_lesson" ? ` · ${t("candidateCheckpointCount", { count: segment.teachingCheckpointPageIds.length })}` : "")
        : optionalTalk ? t("spokenTalkReady") : t("candidateCoursewareMissing"),
    };
  });
  checks.push({ key: "roster", status: "ready", label: t("candidateRoster", { count: data.participants.filter((item) => item.status !== "cancelled").length }), hint: t("singleRunRosterHint") });
  if (assessmentSegment) checks.push({ key: "assessment", status: "info", label: t("parallelAssessmentReady"), hint: t("parallelAssessmentCandidateHint", { title: assessmentSegment.title }) });
  if (runMode === "rehearsal") checks.push({ key: "rehearsal", status: "info", label: tPreparation("rehearsalConnection"), hint: tPreparation("rehearsalConnectionHint") });

  return <>
    {phase === "candidate" && <div className="mx-auto w-full max-w-7xl">
      <ClassroomPreparation
        mode={runMode}
        runState={runState}
        checks={checks}
        canEnter={canTeach}
        pending={pending}
        blocked={runMode === "rehearsal" ? !rehearsalRoom.log : runMode === "formal" && runState === "scheduled" && !ready}
        onEnter={onStart}
        schedule={program.map((item) => item.segment)}
        onRehearse={() => router.push(classroomRehearsalHref(`/activity/${data.activity.id}/live`, window.location.search, "activity"))}
        secondaryActions={<Link href={`/dashboard/activities/${data.activity.id}?view=teaching`} className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("backToPreparation")}</Link>}
        afterChecks={<>
          {!ready && runState === "scheduled" ? <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-crater"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{t("runNotReadyHint")}</p> : null}
          {!canTeach ? <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{t("candidateReadOnlyHint")}</p> : null}
        </>}
        preview={<>
          <div className="flex items-center justify-between gap-3 pb-2 text-xs text-muted"><span>{t("candidateFirstPage")}</span><span className="tabular-nums">{pages.length ? `1 / ${pages.length}` : "0 / 0"}</span></div>
          <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-card">{firstPreview ? <StagePreview doc={firstPreview.doc} bindingUrls={firstPreview.bindingUrls} stageMode={firstPreview.aspect === "4:3" ? "board43" : "natural"} className="size-full" /> : <div className="grid size-full place-items-center px-8 text-center text-sm text-muted">{t("candidateNoPreview")}</div>}</div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><Presentation className="mt-0.5 size-3.5 shrink-0" />{t("continuousPresentationHint")}</p>
        </>}
      />
    </div>}

    {(stageMounted || phase === "live") && <section className={cn("flex min-h-0 flex-1 flex-col pt-2", phase !== "live" && "invisible pointer-events-none fixed inset-0")} inert={phase !== "live"} aria-hidden={phase !== "live"}>
    <CoursewareWorkbench
      mode="preview"
      keyboardPagingEnabled={false}
      className="min-h-0 flex-1 border-0 shadow-none"
      layoutId={`public-class-run-${data.activity.id}`}
      items={pages.map((page) => ({
        id: page.pageDocId,
        title: `${page.segment.title} · ${page.pageNo}. ${page.title}`,
        leading: page.segment.teachingCheckpointPageIds.includes(page.pageDocId)
          ? <span className="grid size-7 shrink-0 place-items-center rounded-full bg-leaf/20 text-leaf-deep" title={t("activeTeachingCheckpoint")}><BadgeCheck className="size-4" /></span>
          : undefined,
      }))}
      selectedIndex={selectedIndex}
      onSelectedIndexChange={onSelectedIndexChange}
      directoryLabel={t("runProgramPages")}
      previewLabel={selectedPage?.segment.title ?? t("teachingStage")}
      previousLabel={t("previousPage")}
      nextLabel={t("nextPage")}
      selectedPageLabel={t("pageIndicator", { current: selectedIndex + 1, total: pages.length })}
      railStatus={<div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline">{runMode === "rehearsal" ? tPreparation("rehearsal") : t("frozenForTeaching")}</Badge>{selectedPage?.segment.teachingCheckpointPageIds.includes(selectedPage.pageDocId) ? <Badge variant="secondary"><BadgeCheck className="mr-1 size-3" />{t("activeTeachingCheckpoint")}</Badge> : null}{selectedPage?.segment.kind === "parent_talk" && assessmentSegment ? <Badge variant="secondary"><GitBranch className="mr-1 size-3" />{t("assessmentRunningInParallel")}</Badge> : null}</div>}
      previewAspect={selectedPage ? pageAspect(selectedPage.aspect) : 4 / 3}
      preview={selectedPage ? runMode === "rehearsal" ? <DocCoursewarePage
        key={selectedPage.pageDocId}
        doc={selectedPage.doc}
        bindingUrls={selectedPage.bindingUrls}
        stageMode={selectedPage.aspect === "4:3" ? "board43" : "natural"}
        isController={canTeach}
        syncControllerMirror
        steps={rehearsalRoom.state.docSteps[selectedPage.pageDocId]}
        onStep={(trigger) => { void rehearsalRoom.log?.append("doc_step", { pageId: selectedPage.pageDocId, ...trigger }); }}
        videoCtl={rehearsalRoom.state.video[selectedPage.pageDocId]}
        onVideoCtl={(action, time) => { void rehearsalRoom.log?.append("video_ctl", { pageId: selectedPage.pageDocId, action, time }); }}
        onAdvance={() => onSelectedIndexChange(selectedIndex + 1)}
        gameMirror={rehearsalRoom.state.games[selectedPage.pageDocId] ?? null}
        onGameMirror={(state) => { void rehearsalRoom.log?.append("game_state", { pageId: selectedPage.pageDocId, state }); }}
        classroomTools={{
          pageId: selectedPage.pageDocId,
          docId: selectedPage.pageDocId,
          states: rehearsalRoom.state.tools?.[selectedPage.pageDocId] ?? {},
          onChange: canTeach && rehearsalRoom.log ? async (instanceId, originHash, snapshot) => {
            if (!rehearsalRoom.log) throw new Error("CLASSROOM_SYNC_NOT_READY");
            await rehearsalRoom.log.append("tool_state", createClassroomToolState(selectedPage.pageDocId, selectedPage.pageDocId, instanceId, snapshot, originHash));
          } : undefined,
        }}
      /> : <StagePreview doc={selectedPage.doc} bindingUrls={selectedPage.bindingUrls} stageMode={selectedPage.aspect === "4:3" ? "board43" : "natural"} className="size-full" /> : <div className="grid size-full place-items-center text-sm text-muted">{t("candidateNoPreview")}</div>}
    />
    </section>}
  </>;
}
