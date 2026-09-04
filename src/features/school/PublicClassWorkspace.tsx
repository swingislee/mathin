"use client";

import {
  ArrowRight,
  BookOpenCheck,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  FileDown,
  GraduationCap,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Presentation,
  Search,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Fragment, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import {
  deletePublicClassSegmentAction,
  linkPublicClassroomAction,
  linkPublicClassSegmentMicrocourseAction,
  savePublicClassParticipantRecordAction,
  savePublicClassSegmentAction,
  syncPublicClassroomCandidatesAction,
  unlinkPublicClassroomAction,
} from "./public-class-actions";
import type {
  PublicClassParticipant,
  PublicClassParticipantRecord,
  PublicClassPresence,
  PublicClassSegment,
  PublicClassSegmentKind,
  PublicClassWorkbenchData,
} from "./public-class";
import {
  DashboardCommandActions,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardSection,
  DashboardTableShell,
  StatusStrip,
} from "./dashboard-page";

export const PUBLIC_CLASS_VIEWS = ["arrangement", "roster", "print", "conversion"] as const;
export type PublicClassView = (typeof PUBLIC_CLASS_VIEWS)[number];

const NONE = "__none__";

type Run = (
  action: () => Promise<ActionResult>,
  success: string,
  after?: () => void,
) => void;

function recordFor(participant: PublicClassParticipant, segmentId: string): PublicClassParticipantRecord | null {
  return participant.records.find((record) => record.segmentId === segmentId) ?? null;
}

function segmentIcon(kind: PublicClassSegmentKind) {
  if (kind === "group_assessment") return ClipboardCheck;
  if (kind === "parent_talk") return Presentation;
  return BookOpenCheck;
}

function segmentPlace(segment: PublicClassSegment) {
  if (segment.roomName) return [segment.campusName, segment.roomName].filter(Boolean).join(" · ");
  return segment.location;
}

function formatDateTime(locale: string, value: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function PublicClassWorkspace({
  data,
  locale,
  activeView,
  activeSegmentId,
  canManage,
  canRecord,
  canLinkClass,
  canUseCourseware,
}: {
  data: PublicClassWorkbenchData;
  locale: string;
  activeView: PublicClassView;
  activeSegmentId: string | null;
  canManage: boolean;
  canRecord: boolean;
  canLinkClass: boolean;
  canUseCourseware: boolean;
}) {
  const t = useTranslations("school.publicClass");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingSegment, setEditingSegment] = useState<PublicClassSegment | "new" | null>(null);
  const [coursewareSegment, setCoursewareSegment] = useState<PublicClassSegment | null>(null);
  const participantCount = data.participants.filter((item) => item.status !== "cancelled").length;
  const selectedSegment = data.segments.find((item) => item.id === activeSegmentId) ?? data.segments[0] ?? null;
  const readySegments = data.segments.filter((item) => item.microcourseLectureId).length;
  const roomPending = data.segments.filter((item) => !item.roomId && !item.location).length;

  const run: Run = (action, success, after) => startTransition(async () => {
    const result = await action();
    if (!result.ok) {
      toast.error(t("actionFailed", { code: result.code }));
      return;
    }
    toast.success(success);
    after?.();
    router.refresh();
  });

  const baseHref = `/dashboard/activities/${data.activity.id}`;
  const tabs = [
    { value: "arrangement", label: t("viewArrangement"), href: `${baseHref}?view=arrangement` },
    { value: "roster", label: t("viewRoster"), href: `${baseHref}?view=roster${selectedSegment ? `&segment=${selectedSegment.id}` : ""}` },
    { value: "print", label: t("viewPrint"), href: `${baseHref}?view=print` },
    ...(canLinkClass ? [{ value: "conversion", label: t("viewConversion"), href: `${baseHref}?view=conversion` }] : []),
  ];

  return <div className="space-y-5">
    <StatusStrip items={[
      { label: t("segmentCount"), value: data.segments.length },
      { label: t("participantCount"), value: participantCount },
      { label: t("coursewareReady"), value: `${readySegments}/${data.segments.length}` },
      { label: t("roomPending"), value: roomPending },
    ]} />

    <DashboardCommandPanel>
      <DashboardCommandState>
        <DashboardCommandTabs ariaLabel={t("workspaceViews")} activeValue={activeView} items={tabs} />
      </DashboardCommandState>
      {canManage && activeView === "arrangement" ? <DashboardCommandActions>
        <Button size="sm" onClick={() => setEditingSegment("new")}>
          <Plus className="size-4" />{t("addSegment")}
        </Button>
      </DashboardCommandActions> : null}
    </DashboardCommandPanel>

    {activeView === "arrangement" ? <ArrangementView
      data={data}
      locale={locale}
      canManage={canManage}
      canUseCourseware={canUseCourseware}
      pending={pending}
      onEdit={setEditingSegment}
      onCourseware={setCoursewareSegment}
      run={run}
    /> : null}
    {activeView === "roster" ? <RosterView
      data={data}
      locale={locale}
      segment={selectedSegment}
      canRecord={canRecord}
      pending={pending}
      run={run}
    /> : null}
    {activeView === "print" ? <PrintView data={data} /> : null}
    {activeView === "conversion" && canLinkClass ? <ConversionView data={data} pending={pending} run={run} /> : null}

    {editingSegment ? <SegmentDialog
      activity={data.activity}
      segment={editingSegment === "new" ? null : editingSegment}
      rooms={data.roomOptions}
      staff={data.staffOptions}
      pending={pending}
      close={() => setEditingSegment(null)}
      run={run}
    /> : null}
    {coursewareSegment ? <MicrocourseDialog
      segment={coursewareSegment}
      options={data.microcourseOptions}
      familyId={data.microcourseFamilyId}
      pending={pending}
      close={() => setCoursewareSegment(null)}
      run={run}
    /> : null}
  </div>;
}

function ArrangementView({
  data,
  locale,
  canManage,
  canUseCourseware,
  pending,
  onEdit,
  onCourseware,
  run,
}: {
  data: PublicClassWorkbenchData;
  locale: string;
  canManage: boolean;
  canUseCourseware: boolean;
  pending: boolean;
  onEdit: (segment: PublicClassSegment) => void;
  onCourseware: (segment: PublicClassSegment) => void;
  run: Run;
}) {
  const t = useTranslations("school.publicClass");
  return <DashboardSection title={t("arrangementTitle")} description={t("activityNotClassHint")}>
    <div className="divide-y divide-line border-y border-line">
      {data.segments.map((segment, index) => {
        const Icon = segmentIcon(segment.kind);
        const place = segmentPlace(segment);
        const coursewareHref = segment.microcourseFamilyId && segment.microcourseCourseId
          ? `/dashboard/courses/${segment.microcourseFamilyId}/microcourses/${segment.microcourseCourseId}?course=${segment.microcourseCourseId}${segment.microcourseLectureId ? `&lecture=${segment.microcourseLectureId}` : ""}`
          : null;
        return <article key={segment.id} className="grid gap-3 px-3 py-4 @3xl/page:grid-cols-[minmax(0,1.3fr)_minmax(18rem,1fr)_auto] @3xl/page:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-moon/20 text-crater">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-muted">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="font-medium text-ink">{segment.title}</h3>
                <Badge variant="outline">{t(`kind_${segment.kind}`)}</Badge>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{formatDateTime(locale, segment.scheduledAt)} · {t("minutes", { count: segment.durationMin })}</span>
                <span className={cn("inline-flex items-center gap-1", !place && "text-amber-700")}><MapPin className="size-3.5" />{place || t("roomUnassigned")}</span>
              </p>
            </div>
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="min-w-0 border-l border-line pl-3">
              <p className="text-muted">{t("teachingStaff")}</p>
              <p className="mt-1 truncate text-ink">
                {segment.primaryTeacherName || t("teacherUnassigned")}
                {segment.assistantTeacherName ? ` · ${segment.assistantTeacherName}` : ""}
              </p>
            </div>
            <div className="min-w-0 border-l border-line pl-3">
              <p className="text-muted">{t("courseware")}</p>
              <p className={cn("mt-1 truncate", segment.microcourseLectureTitle ? "text-ink" : "text-amber-700")}>
                {segment.microcourseLectureTitle
                  ? `${segment.microcourseCourseTitle} · ${segment.microcourseLectureTitle}`
                  : t("coursewareUnassigned")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {canUseCourseware && coursewareHref ? <Link href={coursewareHref} className={buttonVariants({ size: "sm", variant: "secondary" })}>
              <ExternalLink className="size-3.5" />{t("openMicrocourse")}
            </Link> : null}
            {canManage ? <>
              <Button size="sm" variant="ghost" onClick={() => onCourseware(segment)}><BookOpenCheck className="size-3.5" />{t("chooseCourseware")}</Button>
              <Button size="sm" variant="ghost" onClick={() => onEdit(segment)}><Pencil className="size-3.5" />{t("editSegment")}</Button>
              {data.segments.length > 1 ? <Button
                size="sm"
                variant="ghost"
                className="size-8 p-0"
                aria-label={t("deleteSegment")}
                disabled={pending}
                onClick={() => run(() => deletePublicClassSegmentAction(segment.id), t("segmentDeleted"))}
              ><Trash2 className="size-3.5 text-rose" /></Button> : null}
            </> : null}
            <Link href={`/dashboard/activities/${data.activity.id}?view=roster&segment=${segment.id}`} className={buttonVariants({ size: "sm" })}>
              {t("enterRoster")}<ArrowRight className="size-3.5" />
            </Link>
          </div>
        </article>;
      })}
    </div>
  </DashboardSection>;
}

function SegmentDialog({
  activity,
  segment,
  rooms,
  staff,
  pending,
  close,
  run,
}: {
  activity: PublicClassWorkbenchData["activity"];
  segment: PublicClassSegment | null;
  rooms: PublicClassWorkbenchData["roomOptions"];
  staff: PublicClassWorkbenchData["staffOptions"];
  pending: boolean;
  close: () => void;
  run: Run;
}) {
  const t = useTranslations("school.publicClass");
  const [kind, setKind] = useState<PublicClassSegmentKind>(segment?.kind ?? "trial_lesson");
  const [title, setTitle] = useState(segment?.title ?? t("defaultTrialTitle"));
  const [scheduledAt, setScheduledAt] = useState((segment?.scheduledAt ?? activity.scheduledAt).slice(0, 16));
  const [durationMin, setDurationMin] = useState(segment?.durationMin ?? 60);
  const [roomId, setRoomId] = useState(segment?.roomId ?? NONE);
  const [location, setLocation] = useState(segment?.location ?? activity.location);
  const [primaryTeacherId, setPrimaryTeacherId] = useState(segment?.primaryTeacherId ?? NONE);
  const [assistantTeacherId, setAssistantTeacherId] = useState(segment?.assistantTeacherId ?? NONE);
  const save = () => run(() => savePublicClassSegmentAction({
    activityId: activity.id,
    segmentId: segment?.id ?? null,
    kind,
    title,
    scheduledAt,
    durationMin,
    roomId: roomId === NONE ? null : roomId,
    location,
    primaryTeacherId: primaryTeacherId === NONE ? null : primaryTeacherId,
    assistantTeacherId: assistantTeacherId === NONE ? null : assistantTeacherId,
  }), t("segmentSaved"), close);
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{segment ? t("editSegment") : t("addSegment")}</DialogTitle>
        <DialogDescription>{t("segmentDialogHint")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="grid gap-1.5 text-sm">{t("segmentKind")}
          <Select value={kind} onValueChange={(value) => setKind(value as PublicClassSegmentKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="trial_lesson">{t("kind_trial_lesson")}</SelectItem>
              <SelectItem value="group_assessment">{t("kind_group_assessment")}</SelectItem>
              <SelectItem value="parent_talk">{t("kind_parent_talk")}</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5 text-sm">{t("segmentTitle")}
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} />
        </Label>
        <Label className="grid gap-1.5 text-sm">{t("segmentTime")}
          <DateTimePicker mode="datetime" value={scheduledAt} onValueChange={setScheduledAt} />
        </Label>
        <Label className="grid gap-1.5 text-sm">{t("duration")}
          <Input type="number" min={1} max={600} value={durationMin} onChange={(event) => setDurationMin(Number(event.target.value))} />
        </Label>
        <Label className="grid gap-1.5 text-sm">{t("teachingRoom")}
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("roomUnassigned")}</SelectItem>
              {rooms.map((room) => <SelectItem key={room.id} value={room.id}>{room.campusName} · {room.name}{room.capacity ? ` · ${t("capacity", { count: room.capacity })}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5 text-sm">{t("fallbackLocation")}
          <Input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={100} placeholder={t("fallbackLocationHint")} />
        </Label>
        <Label className="grid gap-1.5 text-sm">{t("primaryTeacher")}
          <Select value={primaryTeacherId} onValueChange={setPrimaryTeacherId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>{t("teacherUnassigned")}</SelectItem>{staff.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5 text-sm">{t("assistantTeacher")}
          <Select value={assistantTeacherId} onValueChange={setAssistantTeacherId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>{t("teacherUnassigned")}</SelectItem>{staff.filter((person) => person.id !== primaryTeacherId).map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={close}>{t("cancel")}</Button>
        <Button disabled={pending || !title.trim() || !scheduledAt || !durationMin} onClick={save}>
          {pending && <LoaderCircle className="size-4 animate-spin" />}{t("save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function MicrocourseDialog({
  segment,
  options,
  familyId,
  pending,
  close,
  run,
}: {
  segment: PublicClassSegment;
  options: PublicClassWorkbenchData["microcourseOptions"];
  familyId: string | null;
  pending: boolean;
  close: () => void;
  run: Run;
}) {
  const t = useTranslations("school.publicClass");
  const [query, setQuery] = useState("");
  const current = segment.microcourseCourseId && segment.microcourseLectureId
    ? `${segment.microcourseCourseId}:${segment.microcourseLectureId}`
    : NONE;
  const [selection, setSelection] = useState(current);
  const filtered = options.filter((option) => `${option.courseTitle} ${option.lectureTitle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const save = () => {
    const option = options.find((item) => `${item.courseId}:${item.lectureId}` === selection);
    run(() => linkPublicClassSegmentMicrocourseAction({
      segmentId: segment.id,
      courseId: option?.courseId ?? null,
      lectureId: option?.lectureId ?? null,
    }), t("coursewareSaved"), close);
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t("chooseCoursewareFor", { title: segment.title })}</DialogTitle>
        <DialogDescription>{t("microcourseReuseHint")}</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchMicrocourse")} />
      </div>
      <div className="max-h-80 divide-y divide-line overflow-y-auto border-y border-line">
        <button type="button" onClick={() => setSelection(NONE)} className={cn("flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-moon/10", selection === NONE && "bg-moon/15")}>
          <span className="flex size-5 items-center justify-center">{selection === NONE && <Check className="size-4" />}</span>
          <span>{t("noCourseware")}</span>
        </button>
        {filtered.map((option) => {
          const value = `${option.courseId}:${option.lectureId}`;
          return <button key={value} type="button" onClick={() => setSelection(value)} className={cn("flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-moon/10", selection === value && "bg-moon/15")}>
            <span className="flex size-5 items-center justify-center">{selection === value && <Check className="size-4" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{option.courseTitle}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">{t("lectureLabel", { no: option.lectureNo, title: option.lectureTitle })}</span>
            </span>
            <Badge variant={option.ready ? "secondary" : "outline"}>{option.ready ? t("published") : t("draft")}</Badge>
          </button>;
        })}
      </div>
      <DialogFooter className="sm:justify-between">
        <div>{familyId ? <Link href={`/dashboard/courses/${familyId}`} className={buttonVariants({ variant: "ghost" })}><Plus className="size-4" />{t("openMicrocourseSystem")}</Link> : null}</div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={close}>{t("cancel")}</Button>
          <Button disabled={pending} onClick={save}>{pending && <LoaderCircle className="size-4 animate-spin" />}{t("useSelection")}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function RosterView({
  data,
  locale,
  segment,
  canRecord,
  pending,
  run,
}: {
  data: PublicClassWorkbenchData;
  locale: string;
  segment: PublicClassSegment | null;
  canRecord: boolean;
  pending: boolean;
  run: Run;
}) {
  const t = useTranslations("school.publicClass");
  if (!segment) return <DashboardSection title={t("rosterTitle")} description={t("noSegments")} />;
  const active = data.participants.filter((participant) => participant.status !== "cancelled");
  const attended = active.filter((participant) => {
    const record = recordFor(participant, segment.id);
    const value = segment.kind === "parent_talk" ? record?.guardianPresence : record?.studentPresence;
    return value === "attended" || value === "late";
  }).length;
  return <div className="space-y-4">
    <DashboardSection title={t("chooseSegment")} description={t("chooseSegmentHint")}>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {data.segments.map((item) => <Link
          key={item.id}
          href={`/dashboard/activities/${data.activity.id}?view=roster&segment=${item.id}`}
          className={cn(buttonVariants({ size: "sm", variant: item.id === segment.id ? "primary" : "secondary" }), "shrink-0")}
        >{t(`kind_${item.kind}`)} · {new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(item.scheduledAt))}</Link>)}
      </div>
    </DashboardSection>
    <DashboardSection
      title={t("rosterFor", { title: segment.title })}
      description={t("rosterRoleHint")}
      actions={<div className="flex items-center gap-2 text-xs text-muted"><UsersRound className="size-4" />{t("attendanceSummary", { attended, total: active.length })}</div>}
    >
      <DashboardTableShell>
        <Table className="min-w-[68rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
          <TableHeader><TableRow>
            <TableHead className="sticky left-0 top-0 z-30 h-9 w-60 border-r border-line bg-card px-2">{t("participant")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-72 bg-card px-2">{segment.kind === "parent_talk" ? t("guardianAttendance") : t("studentAttendance")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 bg-card px-2">{t("recordSummary")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-28 bg-card px-2">{t("recordState")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {active.map((participant) => <ParticipantRows
              key={participant.registrationId}
              participant={participant}
              segment={segment}
              canRecord={canRecord}
              pending={pending}
              run={run}
            />)}
            {active.length === 0 ? <TableRow><TableCell colSpan={4} className="h-40 text-center text-muted">{t("emptyRoster")}</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </DashboardSection>
  </div>;
}

function ParticipantRows({
  participant,
  segment,
  canRecord,
  pending,
  run,
}: {
  participant: PublicClassParticipant;
  segment: PublicClassSegment;
  canRecord: boolean;
  pending: boolean;
  run: Run;
}) {
  const t = useTranslations("school.publicClass");
  const existing = recordFor(participant, segment.id);
  const [expanded, setExpanded] = useState(false);
  const [studentPresence, setStudentPresence] = useState<PublicClassPresence>(existing?.studentPresence ?? (segment.kind === "parent_talk" ? "not_applicable" : "expected"));
  const [guardianPresence, setGuardianPresence] = useState<PublicClassPresence>(existing?.guardianPresence ?? (segment.kind === "parent_talk" ? "expected" : "not_applicable"));
  const [learningObservation, setLearningObservation] = useState(existing?.learningObservation ?? "");
  const [assessmentSummary, setAssessmentSummary] = useState(existing?.assessmentSummary ?? "");
  const [parentFeedback, setParentFeedback] = useState(existing?.parentFeedback ?? "");
  const [recommendation, setRecommendation] = useState(existing?.recommendation ?? "");
  const primaryPresence = segment.kind === "parent_talk" ? guardianPresence : studentPresence;
  const setPrimaryPresence = (value: PublicClassPresence) => {
    const nextStudent = segment.kind === "parent_talk" ? studentPresence : value;
    const nextGuardian = segment.kind === "parent_talk" ? value : guardianPresence;
    setStudentPresence(nextStudent);
    setGuardianPresence(nextGuardian);
    run(() => savePublicClassParticipantRecordAction({
      segmentId: segment.id,
      registrationId: participant.registrationId,
      studentPresence: nextStudent,
      guardianPresence: nextGuardian,
      learningObservation,
      assessmentSummary,
      parentFeedback,
      recommendation,
    }), t("attendanceSaved"));
  };
  const save = () => run(() => savePublicClassParticipantRecordAction({
    segmentId: segment.id,
    registrationId: participant.registrationId,
    studentPresence,
    guardianPresence,
    learningObservation,
    assessmentSummary,
    parentFeedback,
    recommendation,
  }), t("recordSaved"));
  const summary = [assessmentSummary, learningObservation, parentFeedback, recommendation].find((value) => value.trim()) ?? "";
  return <Fragment>
    <TableRow aria-expanded={expanded} className={cn(expanded && "bg-moon/10 hover:bg-moon/10")}>
      <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2">
        <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted" />}
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{participant.name}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : t("gradePending"))}
              {` · ${t(`identity_${participant.identity}`)}`}
              {participant.phone ? ` · ${participant.phone}` : ""}
            </span>
          </span>
        </button>
      </TableCell>
      <TableCell className="px-2 py-2">
        <div className="flex gap-1" role="radiogroup" aria-label={segment.kind === "parent_talk" ? t("guardianAttendance") : t("studentAttendance")}>
          {(["expected", "attended", "late", "absent"] as const).map((value) => <Button
            key={value}
            type="button"
            size="sm"
            variant={primaryPresence === value ? "primary" : "secondary"}
            className="h-7 px-2 text-xs"
            aria-pressed={primaryPresence === value}
            disabled={!canRecord || pending}
            onClick={() => setPrimaryPresence(value)}
          >{t(`presence_${value}`)}</Button>)}
        </div>
      </TableCell>
      <TableCell className="truncate px-2 py-2 text-muted">{summary || t("recordEmpty")}</TableCell>
      <TableCell className="px-2 py-2">{summary ? <Badge variant="secondary">{t("recorded")}</Badge> : <Badge variant="outline">{t("notRecorded")}</Badge>}</TableCell>
    </TableRow>
    {expanded ? <TableRow className="bg-moon/10 hover:bg-moon/10">
      <TableCell colSpan={4} className="p-0">
        <div className="grid gap-3 border-l-2 border-crater/40 px-4 py-4 @3xl/page:grid-cols-2">
          {segment.kind !== "parent_talk" ? <>
            <Label className="grid gap-1.5 text-xs text-muted">{t("learningObservation")}
              <Textarea rows={3} value={learningObservation} disabled={!canRecord} onChange={(event) => setLearningObservation(event.target.value)} placeholder={t("learningObservationHint")} />
            </Label>
            <Label className="grid gap-1.5 text-xs text-muted">{t("assessmentSummary")}
              <Textarea rows={3} value={assessmentSummary} disabled={!canRecord} onChange={(event) => setAssessmentSummary(event.target.value)} placeholder={t("assessmentSummaryHint")} />
            </Label>
          </> : null}
          <Label className="grid gap-1.5 text-xs text-muted">{t("parentFeedback")}
            <Textarea rows={3} value={parentFeedback} disabled={!canRecord} onChange={(event) => setParentFeedback(event.target.value)} placeholder={t("parentFeedbackHint")} />
          </Label>
          <Label className="grid gap-1.5 text-xs text-muted">{t("recommendation")}
            <Textarea rows={3} value={recommendation} disabled={!canRecord} onChange={(event) => setRecommendation(event.target.value)} placeholder={t("recommendationHint")} />
          </Label>
          <div className="flex items-center justify-between gap-3 @3xl/page:col-span-2">
            <p className="text-xs text-muted">{t("sharedRecordHint")}</p>
            {canRecord ? <Button size="sm" disabled={pending} onClick={save}>{pending && <LoaderCircle className="size-4 animate-spin" />}{t("saveRecord")}</Button> : null}
          </div>
        </div>
      </TableCell>
    </TableRow> : null}
  </Fragment>;
}

function PrintView({ data }: { data: PublicClassWorkbenchData }) {
  const t = useTranslations("school.publicClass");
  const firstSegment = data.segments[0];
  const printKinds = [
    { kind: "signin", icon: ClipboardCheck, title: t("printSignin"), hint: t("printSigninHint") },
    { kind: "badge", icon: UserRound, title: t("printBadge"), hint: t("printBadgeHint") },
    { kind: "desk", icon: GraduationCap, title: t("printDesk"), hint: t("printDeskHint") },
  ] as const;
  return <div className="grid gap-4 @3xl/page:grid-cols-[minmax(0,1fr)_20rem]">
    <DashboardSection title={t("printTitle")} description={t("printHint")}>
      <div className="divide-y divide-line border-y border-line">
        {printKinds.map(({ kind, icon: Icon, title, hint }) => <div key={kind} className="flex flex-wrap items-center gap-3 px-3 py-4">
          <span className="flex size-9 items-center justify-center rounded-full bg-moon/20 text-crater"><Icon className="size-4" /></span>
          <div className="min-w-0 flex-1"><p className="font-medium text-ink">{title}</p><p className="mt-0.5 text-xs text-muted">{hint}</p></div>
          <Link
            href={`/dashboard/activities/${data.activity.id}/print?kind=${kind}${firstSegment ? `&segment=${firstSegment.id}` : ""}`}
            className={buttonVariants({ size: "sm", variant: "secondary" })}
          ><FileDown className="size-4" />{t("openPrintPreview")}</Link>
        </div>)}
      </div>
    </DashboardSection>
    <DashboardSection title={t("defaultBackground")} description={t("backgroundCanReplace")}>
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {/* A generated, low-ink image is intentionally rendered as content so print templates can replace it per event later. */}
        <Image src={data.activity.printBackgroundPath} alt="" width={1_200} height={800} className="aspect-[3/2] w-full object-cover" />
      </div>
    </DashboardSection>
  </div>;
}

function ConversionView({ data, pending, run }: { data: PublicClassWorkbenchData; pending: boolean; run: Run }) {
  const t = useTranslations("school.publicClass");
  const [classroomId, setClassroomId] = useState(NONE);
  const available = data.classroomOptions.filter((item) => !data.classroomLinks.some((link) => link.classroomId === item.id));
  const link = () => {
    if (classroomId === NONE) return;
    run(() => linkPublicClassroomAction({ activityId: data.activity.id, classroomId }), t("classLinked"), () => setClassroomId(NONE));
  };
  return <DashboardSection
    title={t("conversionTitle")}
    description={t("conversionBoundary")}
    actions={<div className="flex min-w-80 gap-2">
      <Select value={classroomId} onValueChange={setClassroomId}>
        <SelectTrigger className="h-9 min-w-56"><SelectValue placeholder={t("chooseExistingClass")} /></SelectTrigger>
        <SelectContent><SelectItem value={NONE}>{t("chooseExistingClass")}</SelectItem>{available.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" disabled={pending || classroomId === NONE} onClick={link}><Plus className="size-4" />{t("linkClass")}</Button>
    </div>}
  >
    <div className="space-y-4">
      <div className="border-l-2 border-crater/40 bg-moon/10 px-4 py-3 text-sm text-muted">
        <p className="font-medium text-ink">{t("noTemporaryClassTitle")}</p>
        <p className="mt-1">{t("noTemporaryClassHint")}</p>
      </div>
      {data.classroomLinks.map((linkItem) => <ClassCandidateLink key={linkItem.classroomId} data={data} link={linkItem} pending={pending} run={run} />)}
      {data.classroomLinks.length === 0 ? <div className="py-12 text-center text-sm text-muted">{t("noLinkedClasses")}</div> : null}
    </div>
  </DashboardSection>;
}

function ClassCandidateLink({
  data,
  link,
  pending,
  run,
}: {
  data: PublicClassWorkbenchData;
  link: PublicClassWorkbenchData["classroomLinks"][number];
  pending: boolean;
  run: Run;
}) {
  const t = useTranslations("school.publicClass");
  const eligible = data.participants.filter((participant) => participant.studentId && participant.status !== "cancelled");
  const [selected, setSelected] = useState(() => new Set(link.candidateRegistrationIds));
  const toggle = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const save = () => run(() => syncPublicClassroomCandidatesAction({
    activityId: data.activity.id,
    classroomId: link.classroomId,
    registrationIds: [...selected],
  }), t("candidateLinksSaved", { count: selected.size }));
  return <div className="border-y border-line">
    <div className="flex flex-wrap items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><GraduationCap className="size-4 text-crater" /><Link href={`/dashboard/classes/${link.classroomId}`} className="font-medium text-ink hover:underline">{link.classroomName}</Link></div>
        <p className="mt-1 text-xs text-muted">{t("candidateLinkHint")}</p>
      </div>
      <Button size="sm" variant="secondary" disabled={pending} onClick={save}>{t("saveCandidateLinks")}</Button>
      <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={t("unlinkClass")} disabled={pending} onClick={() => run(() => unlinkPublicClassroomAction({ activityId: data.activity.id, classroomId: link.classroomId }), t("classUnlinked"))}><Trash2 className="size-4 text-rose" /></Button>
    </div>
    <div className="grid gap-px bg-line sm:grid-cols-2 @4xl/page:grid-cols-3">
      {eligible.map((participant) => <Label key={participant.registrationId} className="flex items-center gap-2 bg-card px-3 py-2 text-sm font-normal">
        <Checkbox checked={selected.has(participant.registrationId)} onCheckedChange={(checked) => toggle(participant.registrationId, checked === true)} />
        <span className="min-w-0 flex-1 truncate">{participant.name}</span>
        <span className="text-xs text-muted">{participant.grade ? t("gradeValue", { grade: participant.grade }) : "—"}</span>
      </Label>)}
      {eligible.length === 0 ? <p className="bg-card px-3 py-8 text-center text-sm text-muted sm:col-span-2 @4xl/page:col-span-3">{t("noStudentIdentity")}</p> : null}
    </div>
  </div>;
}
