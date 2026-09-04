"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MapPin,
  MonitorPlay,
  Pencil,
  UsersRound,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CoursewareWorkbench } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { StagePreview } from "@/features/courseware-studio/StagePreview";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  endPublicClassSegmentTeachingAction,
  startPublicClassSegmentTeachingAction,
} from "./public-class-actions";
import type {
  PublicClassParticipant,
  PublicClassSegment,
  PublicClassWorkbenchData,
} from "./public-class";
import type { PublicClassTeachingCourseware } from "./public-class-teaching";

function pageAspect(aspect: string) {
  return aspect === "4:3" ? 4 / 3 : 16 / 9;
}

export function PublicClassTeachingShell({
  activity,
  segment,
  participants,
  courseware,
  canTeach,
  locale,
}: {
  activity: PublicClassWorkbenchData["activity"];
  segment: PublicClassSegment;
  participants: PublicClassParticipant[];
  courseware: PublicClassTeachingCourseware;
  canTeach: boolean;
  locale: string;
}) {
  const t = useTranslations("school.publicClass");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [endOpen, setEndOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [phase, setPhase] = useState<"candidate" | "live" | "ended">(
    segment.teachingEndedAt ? "ended" : segment.teachingStartedAt ? "live" : "candidate",
  );
  const activeParticipants = useMemo(
    () => participants.filter((participant) => participant.status !== "cancelled"),
    [participants],
  );
  const selectedPage = courseware.pages[selectedIndex] ?? courseware.pages[0] ?? null;
  const arrangementHref = `/dashboard/activities/${activity.id}?view=arrangement`;
  const rosterHref = `/dashboard/activities/${activity.id}?view=roster&segment=${segment.id}`;
  const editorHref = segment.microcourseId
    ? `/dashboard/activities/${activity.id}/segments/${segment.id}/microcourse`
    : null;
  const place = segment.roomName
    ? [segment.campusName, segment.roomName].filter(Boolean).join(" · ")
    : segment.location;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (phase !== "live" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.matches("input, textarea, select, button, [role='dialog']")) return;
      const direction = event.key === "ArrowLeft" || event.key === "PageUp"
        ? -1
        : event.key === "ArrowRight" || event.key === "PageDown" || event.key === " "
          ? 1
          : 0;
      if (!direction) return;
      event.preventDefault();
      setSelectedIndex((current) => Math.max(0, Math.min(courseware.pages.length - 1, current + direction)));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [courseware.pages.length, phase]);

  const startTeaching = () => startTransition(async () => {
    const result = await startPublicClassSegmentTeachingAction(segment.id);
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    setPhase("live");
    toast.success(t("teachingStarted"));
    router.refresh();
  });

  const endTeaching = () => startTransition(async () => {
    const result = await endPublicClassSegmentTeachingAction(segment.id);
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    setEndOpen(false);
    setPhase("ended");
    toast.success(t("teachingEnded"));
    router.push(rosterHref);
    router.refresh();
  });

  if (phase === "ended") {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper px-6 py-12">
        <section className="w-full max-w-xl rounded-3xl border border-line bg-card p-7 shadow-sm">
          <span className="grid size-12 place-items-center rounded-full bg-leaf/15 text-leaf-deep"><Check className="size-6" /></span>
          <h1 className="mt-5 font-display text-2xl text-ink">{t("teachingCompleteTitle")}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{t("teachingCompleteHint")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={rosterHref} className={buttonVariants({ size: "sm" })}>{t("recordOnSiteNow")}</Link>
            <Link href={arrangementHref} className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("backToArrangement")}</Link>
          </div>
        </section>
      </main>
    );
  }

  if (phase === "candidate") {
    const checks = [
      {
        key: "courseware",
        ok: courseware.ready,
        blocking: true,
        icon: BookOpenCheck,
        label: courseware.ready
          ? t("candidateCoursewareReady", { count: courseware.pages.length })
          : t("candidateCoursewareMissing"),
        hint: courseware.ready ? t("candidateCoursewareFrozenOnStart") : t("candidateCoursewareMissingHint"),
      },
      {
        key: "place",
        ok: Boolean(place),
        blocking: false,
        icon: MapPin,
        label: place || t("candidateRoomMissing"),
        hint: place ? t("candidateRoomReady") : t("candidateRoomMissingHint"),
      },
      {
        key: "teacher",
        ok: Boolean(segment.primaryTeacherName),
        blocking: false,
        icon: UsersRound,
        label: segment.primaryTeacherName || t("candidateTeacherMissing"),
        hint: segment.assistantTeacherName
          ? t("candidateAssistant", { name: segment.assistantTeacherName })
          : t("candidateTeacherHint"),
      },
      {
        key: "roster",
        ok: activeParticipants.length > 0,
        blocking: false,
        icon: UsersRound,
        label: t("candidateRoster", { count: activeParticipants.length }),
        hint: activeParticipants.length > 0 ? t("candidateRosterReady") : t("candidateRosterWalkInHint"),
      },
    ];
    return (
      <main className="min-h-dvh bg-paper px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <header className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
            <Link href={arrangementHref} aria-label={t("backToArrangement")} className="grid size-9 place-items-center rounded-full text-muted hover:bg-moon/30 hover:text-ink"><ArrowLeft className="size-4" /></Link>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-xl text-ink">{segment.title}</h1>
                <Badge variant="secondary">{t("candidateBadge")}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">{activity.title} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(segment.scheduledAt))}</p>
            </div>
            {editorHref ? <Link href={editorHref} className={buttonVariants({ size: "sm", variant: "secondary" })}><Pencil className="size-4" />{t("editCourseware")}</Link> : null}
          </header>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(19rem,0.72fr)_minmax(32rem,1.28fr)]">
            <section>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{t("candidateChecklistEyebrow")}</p>
              <h2 className="mt-2 font-display text-2xl text-ink">{t("candidateTitle")}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{t("candidateHint")}</p>
              <ul className="mt-5 divide-y divide-line border-y border-line">
                {checks.map((item) => {
                  const Icon = item.icon;
                  return <li key={item.key} className="flex gap-3 py-3.5">
                    <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full", item.ok ? "bg-leaf/15 text-leaf-deep" : "bg-crater/10 text-crater")}>
                      {item.ok ? <Check className="size-4" /> : <Icon className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{item.label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted">{item.hint}</p>
                    </div>
                  </li>;
                })}
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={pending || !canTeach || !courseware.ready} onClick={startTeaching}>
                  {pending ? <LoaderCircle className="size-4 animate-spin" /> : <MonitorPlay className="size-4" />}
                  {t("startOnSiteTeaching")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setRosterOpen(true)}><UsersRound className="size-4" />{t("viewRosterCount", { count: activeParticipants.length })}</Button>
              </div>
              {!canTeach ? <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{t("candidateReadOnlyHint")}</p> : null}
            </section>

            <section className="min-w-0">
              <div className="flex items-center justify-between gap-3 pb-2 text-xs text-muted">
                <span>{t("candidateFirstPage")}</span>
                <span className="tabular-nums">{courseware.pages.length ? `1 / ${courseware.pages.length}` : "0 / 0"}</span>
              </div>
              <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
                {selectedPage ? <StagePreview doc={selectedPage.doc} bindingUrls={selectedPage.bindingUrls} stageMode={selectedPage.aspect === "4:3" ? "board43" : "natural"} className="size-full" /> : <div className="grid size-full place-items-center px-8 text-center text-sm text-muted">{t("candidateNoPreview")}</div>}
              </div>
              <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><Clock3 className="mt-0.5 size-3.5 shrink-0" />{t("candidateRuntimeBoundary")}</p>
            </section>
          </div>
        </div>
        <RosterDialog open={rosterOpen} onOpenChange={setRosterOpen} participants={activeParticipants} />
      </main>
    );
  }

  return (
    <main className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-paper p-2 sm:p-3">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-1 pb-2">
        <Link href={arrangementHref} aria-label={t("backToArrangement")} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-moon/30 hover:text-ink"><ArrowLeft className="size-4" /></Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{segment.title}</p>
          <p className="truncate text-[11px] text-muted">{activity.title} · {place || t("roomUnassigned")}</p>
        </div>
        <Badge variant="secondary" className="hidden sm:inline-flex">{t("teachingInProgress")}</Badge>
        <Button size="sm" variant="secondary" onClick={() => setRosterOpen(true)}><UsersRound className="size-4" /><span className="hidden sm:inline">{t("viewRosterCount", { count: activeParticipants.length })}</span><span className="sm:hidden">{activeParticipants.length}</span></Button>
        {canTeach ? <Button size="sm" variant="ghost" className="text-rose" onClick={() => setEndOpen(true)}>{t("endOnSiteTeaching")}</Button> : null}
      </header>
      <CoursewareWorkbench
        mode="preview"
        className="min-h-0 flex-1 border-0 shadow-none"
        layoutId={`public-class-live-${segment.id}`}
        items={courseware.pages.map((page) => ({ id: page.pageDocId, title: `${page.pageNo}. ${page.title}` }))}
        selectedIndex={selectedIndex}
        onSelectedIndexChange={setSelectedIndex}
        directoryLabel={t("teachingPages")}
        previewLabel={t("teachingStage")}
        previousLabel={t("previousPage")}
        nextLabel={t("nextPage")}
        selectedPageLabel={t("pageIndicator", { current: selectedIndex + 1, total: courseware.pages.length })}
        railStatus={<Badge variant="outline">{courseware.frozen ? t("frozenForTeaching") : t("candidateBadge")}</Badge>}
        previewAspect={selectedPage ? pageAspect(selectedPage.aspect) : 4 / 3}
        preview={selectedPage ? <StagePreview doc={selectedPage.doc} bindingUrls={selectedPage.bindingUrls} stageMode={selectedPage.aspect === "4:3" ? "board43" : "natural"} className="size-full" /> : <div className="grid size-full place-items-center text-sm text-muted">{t("candidateNoPreview")}</div>}
      />
      <RosterDialog open={rosterOpen} onOpenChange={setRosterOpen} participants={activeParticipants} />
      <ConfirmDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        title={t("endTeachingTitle")}
        description={t("endTeachingDescription")}
        confirmLabel={t("endAndRecord")}
        cancelLabel={t("cancel")}
        pending={pending}
        onConfirm={endTeaching}
      />
    </main>
  );
}

function RosterDialog({
  open,
  onOpenChange,
  participants,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participants: PublicClassParticipant[];
}) {
  const t = useTranslations("school.publicClass");
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("candidateRoster", { count: participants.length })}</DialogTitle>
        <DialogDescription>{t("liveRosterHint")}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[55dvh] divide-y divide-line overflow-y-auto border-y border-line">
        {participants.map((participant, index) => <div key={participant.registrationId} className="flex items-center gap-3 px-2 py-2.5 text-sm">
          <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{participant.name}</span>
          <span className="text-xs text-muted">{participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : t("gradePending"))}</span>
        </div>)}
        {participants.length === 0 ? <p className="py-10 text-center text-sm text-muted">{t("emptyRoster")}</p> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
