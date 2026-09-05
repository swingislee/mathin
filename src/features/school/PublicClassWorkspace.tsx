"use client";

import {
  ArrowRight,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileDown,
  GitBranch,
  GraduationCap,
  LoaderCircle,
  MonitorPlay,
  Pencil,
  Plus,
  Presentation,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState, useTransition } from "react";
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
  PublicClassView,
  PublicClassWorkbenchData,
} from "./public-class";
import type { PublicClassTeachingCourseware } from "./public-class-teaching-contract";
import type { PublicClassPreparationData } from "./public-class-preparation";
import { PublicClassTeachingPreparation } from "./PublicClassTeachingPreparation";
import {
  DashboardCommandActions,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardSection,
  DashboardTableColumnHeader,
  DashboardTableShell,
  type DashboardTableColumnDefinition,
  useDashboardTableView,
} from "./dashboard-page";
import { StageNavigation } from "./object-workspace";
import { Student360Trigger } from "./Student360Sheet";
import { EnrollmentHandoffButton } from "./EnrollmentHandoffButton";
import { TeachingPostworkSection, TeachingPostworkStatus } from "./TeachingPostworkSurface";

const NONE = "__none__";
const EMPTY_VALUE = "$empty";
type PublicClassReviewColumn = "participant" | "attendance" | "assessment" | "feedback" | "recommendation";
type PublicClassRosterColumn = "participant" | "summary" | "state";

type Run = (
  action: () => Promise<ActionResult>,
  success: string,
  after?: () => void,
) => void;

function recordFor(participant: PublicClassParticipant, segmentId: string): PublicClassParticipantRecord | null {
  return participant.records.find((record) => record.segmentId === segmentId) ?? null;
}

function recordSummary(participant: PublicClassParticipant, segmentId: string): string {
  const record = recordFor(participant, segmentId);
  return [record?.assessmentSummary, record?.learningObservation, record?.parentFeedback, record?.recommendation]
    .find((item) => item?.trim()) ?? "";
}

function participantAttended(participant: PublicClassParticipant): boolean {
  return participant.status === "attended"
    || participant.records.some((record) => record.studentPresence === "attended" || record.studentPresence === "late");
}

function SegmentKindIcon({ kind, className }: { kind: PublicClassSegmentKind; className?: string }) {
  if (kind === "group_assessment") return <ClipboardCheck className={className} />;
  if (kind === "parent_talk") return <Presentation className={className} />;
  return <BookOpenCheck className={className} />;
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
  teachingProgram,
  locale,
  activeView,
  activeSegmentId,
  canManage,
  canRecord,
  canLinkClass,
  canFollowUp,
  canUseCourseware,
  canAuthorMicrocourse,
  canPrepareTeaching,
  currentUserId,
}: {
  data: PublicClassWorkbenchData;
  teachingProgram: Array<{
    segment: PublicClassSegment;
    courseware: PublicClassTeachingCourseware;
    preparation: PublicClassPreparationData;
  }>;
  locale: string;
  activeView: PublicClassView;
  activeSegmentId: string | null;
  canManage: boolean;
  canRecord: boolean;
  canLinkClass: boolean;
  canFollowUp: boolean;
  canUseCourseware: boolean;
  canAuthorMicrocourse: boolean;
  canPrepareTeaching: boolean;
  currentUserId: string;
}) {
  const t = useTranslations("school.publicClass");
  const sessionT = useTranslations("school.session");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingSegment, setEditingSegment] = useState<PublicClassSegment | "new" | null>(null);
  const assessmentSegment = data.segments.find((item) => item.kind === "group_assessment") ?? null;
  const selectedSegment = data.segments.find((item) => item.id === activeSegmentId)
    ?? assessmentSegment
    ?? data.segments[0]
    ?? null;
  const presentationSegments = data.segments.filter((item) => item.kind !== "group_assessment");
  const startedSegments = presentationSegments.filter((item) => item.teachingStartedAt);
  const runState = startedSegments.length === 0
    ? "preparing"
    : startedSegments.every((item) => item.teachingEndedAt)
      ? "ended"
      : "live";
  const recordedParticipants = data.participants.filter((participant) => participant.records.some((record) => (
    record.studentPresence !== "expected"
    || record.guardianPresence === "attended"
    || Boolean(record.learningObservation.trim())
    || Boolean(record.assessmentSummary.trim())
    || Boolean(record.parentFeedback.trim())
    || Boolean(record.recommendation.trim())
  ))).length;

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
  const activeStage = activeView === "live" ? "live" : activeView === "review" ? "post" : "pre";
  const stageItems = [
    { value: "pre", label: sessionT("stage_pre"), href: `${baseHref}?view=${activeStage === "pre" ? activeView : "teaching"}` },
    { value: "live", label: sessionT("stage_live"), href: `/activity/${data.activity.id}/live?mode=host` },
    { value: "post", label: sessionT("stage_post"), href: `/dashboard/activities?activity=${data.activity.id}` },
  ];
  return <div className="space-y-5">
    <DashboardCommandPanel>
      <DashboardCommandState>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {activeView === "onsite" ? (
            <span className="px-1 text-sm font-medium text-ink">{t("viewOnsitePreparation")}</span>
          ) : (
          <StageNavigation ariaLabel={sessionT("stageNavLabel")} activeValue={activeStage} items={stageItems} />
          )}
        </div>
      </DashboardCommandState>
      <DashboardCommandActions>
        {activeView === "onsite" ? <>
          <Link href={`${baseHref}?view=onsite#print-materials`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
            <FileDown className="size-4" />{t("printMaterials")}
          </Link>
          {canManage ? <Button size="sm" variant="secondary" onClick={() => setEditingSegment("new")}>
            <Plus className="size-4" />{t("addProgramBlock")}
          </Button> : null}
        </> : null}
        {activeView === "teaching" && canPrepareTeaching ? <Link
          href={`/activity/${data.activity.id}/live?mode=host`}
          className={buttonVariants({ size: "sm" })}
        >
          <MonitorPlay className="size-4" />
          {runState === "live" ? t("returnToLiveRun") : runState === "ended" ? t("reviewCompletedRun") : t("enterRunCandidate")}
        </Link> : null}
        {activeView === "onsite" && canRecord ? <Link
          href={`/activity/${data.activity.id}/live?mode=roster`}
          className={buttonVariants({ size: "sm" })}
        >
          <UsersRound className="size-4" />{t("enterOnsiteWorkspace")}
        </Link> : null}
      </DashboardCommandActions>
    </DashboardCommandPanel>

    {activeView === "teaching" ? <PublicClassTeachingPreparation
      key={teachingProgram.map(({ segment }) => `${segment.id}:${segment.teachingCheckpointPageIds.join(",")}`).join("|")}
      data={data}
      program={teachingProgram}
      canPrepare={canPrepareTeaching}
      canUseCourseware={canUseCourseware}
      canAuthorMicrocourse={canAuthorMicrocourse}
      currentUserId={currentUserId}
    /> : null}
    {activeView === "onsite" ? <>
      <OnsitePreparationView
        data={data}
        locale={locale}
        canManage={canManage}
        pending={pending}
        onEdit={setEditingSegment}
        run={run}
      />
      <div id="print-materials" className="scroll-mt-24"><PrintView data={data} /></div>
    </> : null}
    {activeView === "live" ? <>
      <LiveRunOverview data={data} runState={runState} />
      <div id="onsite-records" className="scroll-mt-24">
        <PublicClassRosterView
          data={data}
          locale={locale}
          segment={selectedSegment}
          canRecord={canRecord}
          pending={pending}
          run={run}
        />
      </div>
    </> : null}
    {activeView === "review" ? <>
      <ReviewOverview data={data} recordedParticipants={recordedParticipants} canFollowUp={canFollowUp} />
      {canLinkClass ? <ConversionView data={data} pending={pending} run={run} /> : null}
    </> : null}

    {editingSegment ? <SegmentDialog
      activity={data.activity}
      segment={editingSegment === "new" ? null : editingSegment}
      rooms={data.roomOptions}
      staff={data.staffOptions}
      pending={pending}
      close={() => setEditingSegment(null)}
      run={run}
    /> : null}
  </div>;
}

function OnsitePreparationView({
  data,
  locale,
  canManage,
  pending,
  onEdit,
  run,
}: {
  data: PublicClassWorkbenchData;
  locale: string;
  canManage: boolean;
  pending: boolean;
  onEdit: (segment: PublicClassSegment) => void;
  run: Run;
}) {
  const t = useTranslations("school.publicClass");
  return <DashboardSection title={t("onsitePreparationTitle")} description={t("onsitePreparationHint")}>
      <div className="divide-y divide-line">
        {data.segments.map((segment, index) => {
          const place = segmentPlace(segment);
          return <article key={segment.id} className="grid gap-3 px-2 py-3 @3xl/page:grid-cols-[minmax(17rem,1.1fr)_minmax(20rem,1fr)_minmax(15rem,0.9fr)_auto] @3xl/page:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-moon/20 text-crater"><SegmentKindIcon kind={segment.kind} className="size-4" /></span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink"><span className="text-xs tabular-nums text-muted">{String(index + 1).padStart(2, "0")}</span>{segment.title}<Badge variant="outline">{t(`kind_${segment.kind}`)}</Badge></p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(locale, segment.scheduledAt)} · {t("minutes", { count: segment.durationMin })}</p>
              </div>
            </div>
            <div className="min-w-0 text-xs">
              <p className="text-muted">{t("onsiteRoom")}</p>
              <p className={cn("mt-1 truncate", place ? "text-ink" : "text-amber-700")}>{place || t("roomUnassigned")}</p>
            </div>
            <div className="min-w-0 text-xs">
              <p className="text-muted">{t("onsiteStaff")}</p>
              <p className={cn("mt-1 truncate", segment.primaryTeacherName ? "text-ink" : "text-amber-700")}>{segment.primaryTeacherName || t("teacherUnassigned")}{segment.assistantTeacherName ? ` · ${segment.assistantTeacherName}` : ""}</p>
            </div>
            <div className="flex justify-end gap-1">
              {canManage ? <Button size="sm" variant="ghost" onClick={() => onEdit(segment)}><Pencil className="size-3.5" />{t("editSegment")}</Button> : null}
              {canManage && data.segments.length > 1 ? <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={t("deleteSegment")} disabled={pending} onClick={() => run(() => deletePublicClassSegmentAction(segment.id), t("segmentDeleted"))}><Trash2 className="size-3.5 text-rose" /></Button> : null}
            </div>
          </article>;
        })}
        {data.segments.length === 0 ? <p className="py-12 text-center text-sm text-muted">{t("noSegments")}</p> : null}
      </div>
  </DashboardSection>;
}

function LiveRunOverview({
  data,
  runState,
}: {
  data: PublicClassWorkbenchData;
  runState: "preparing" | "live" | "ended";
}) {
  const t = useTranslations("school.publicClass");
  const trialCount = data.segments.filter((segment) => segment.kind === "trial_lesson").length;
  const assessment = data.segments.find((segment) => segment.kind === "group_assessment");
  const talk = data.segments.find((segment) => segment.kind === "parent_talk");
  const roles = [
    {
      mode: "host",
      icon: MonitorPlay,
      title: t("hostWorkspace"),
      detail: t("hostWorkspaceHint", { count: trialCount }),
      meta: t(`runStatus_${runState}`),
    },
    {
      mode: "assessment",
      icon: ClipboardCheck,
      title: t("assessmentWorkspace"),
      detail: assessment ? t("assessmentWorkspaceHint", { title: assessment.title }) : t("noGroupAssessment"),
      meta: assessment ? segmentPlace(assessment) || t("roomUnassigned") : "—",
    },
    {
      mode: "roster",
      icon: UsersRound,
      title: t("supportWorkspace"),
      detail: t("supportWorkspaceHint"),
      meta: t("participantCountValue", { count: data.participants.filter((item) => item.status !== "cancelled").length }),
    },
  ] as const;
  return <DashboardSection title={t("liveRunTitle")} description={t("liveRunHint")}>
    <div className="grid border-y border-line @3xl/page:grid-cols-3 @3xl/page:divide-x @3xl/page:divide-line">
      {roles.map(({ mode, icon: Icon, title, detail, meta }) => <Link
        key={mode}
        href={`/activity/${data.activity.id}/live?mode=${mode}`}
        className="group flex min-w-0 items-start gap-3 border-b border-line px-3 py-4 last:border-b-0 hover:bg-moon/10 @3xl/page:border-b-0"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-moon/20 text-crater"><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{title}</span><ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" /></span>
          <span className="mt-1 block text-xs leading-5 text-muted">{detail}</span>
          <span className="mt-2 block truncate text-[11px] text-crater">{meta}</span>
        </span>
      </Link>)}
    </div>
    {talk && assessment ? <p className="mt-3 flex items-center gap-2 text-xs text-muted"><GitBranch className="size-4 text-crater" />{t("parallelLiveHint", { talk: talk.title, assessment: assessment.title })}</p> : null}
  </DashboardSection>;
}

function ReviewOverview({ data, recordedParticipants, canFollowUp }: { data: PublicClassWorkbenchData; recordedParticipants: number; canFollowUp: boolean }) {
  const t = useTranslations("school.publicClass");
  const tableT = useTranslations("school.table");
  const locale = useLocale();
  const active = useMemo(
    () => data.participants.filter((participant) => participant.status !== "cancelled"),
    [data.participants],
  );
  const pendingRecords = Math.max(0, active.length - recordedParticipants);
  const assessmentId = data.segments.find((segment) => segment.kind === "group_assessment")?.id;
  const talkId = data.segments.find((segment) => segment.kind === "parent_talk")?.id;
  const columns = useMemo<Record<PublicClassReviewColumn, DashboardTableColumnDefinition<PublicClassParticipant>>>(() => ({
    participant: {
      filterValues: (participant) => [
        { value: `name:${participant.name}`, label: participant.name, group: tableT("fieldName") },
        {
          value: participant.gradeText || participant.grade
            ? `grade:${participant.gradeText || participant.grade}`
            : `grade:${EMPTY_VALUE}`,
          label: participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : t("gradePending")),
          group: tableT("fieldGrade"),
        },
      ],
      sortValue: (participant) => participant.name,
    },
    attendance: {
      filterValues: (participant) => {
        const attended = participantAttended(participant);
        return { value: attended ? "attended" : "expected", label: t(attended ? "presence_attended" : "presence_expected") };
      },
      sortValue: (participant) => participantAttended(participant) ? 1 : 0,
    },
    assessment: {
      filterValues: (participant) => {
        const record = assessmentId ? recordFor(participant, assessmentId) : null;
        const value = record?.assessmentSummary || record?.learningObservation || "";
        return { value: value ? `assessment:${value}` : EMPTY_VALUE, label: value || tableT("emptyValue") };
      },
      sortValue: (participant) => {
        const record = assessmentId ? recordFor(participant, assessmentId) : null;
        return record?.assessmentSummary || record?.learningObservation || "";
      },
    },
    feedback: {
      filterValues: (participant) => {
        const assessmentRecord = assessmentId ? recordFor(participant, assessmentId) : null;
        const talkRecord = talkId ? recordFor(participant, talkId) : null;
        const value = talkRecord?.parentFeedback || assessmentRecord?.parentFeedback || "";
        return { value: value ? `feedback:${value}` : EMPTY_VALUE, label: value || tableT("emptyValue") };
      },
      sortValue: (participant) => {
        const assessmentRecord = assessmentId ? recordFor(participant, assessmentId) : null;
        const talkRecord = talkId ? recordFor(participant, talkId) : null;
        return talkRecord?.parentFeedback || assessmentRecord?.parentFeedback || "";
      },
    },
    recommendation: {
      filterValues: (participant) => {
        const assessmentRecord = assessmentId ? recordFor(participant, assessmentId) : null;
        const talkRecord = talkId ? recordFor(participant, talkId) : null;
        const value = assessmentRecord?.recommendation || talkRecord?.recommendation || "";
        return { value: value ? `recommendation:${value}` : EMPTY_VALUE, label: value || tableT("emptyValue") };
      },
      sortValue: (participant) => {
        const assessmentRecord = assessmentId ? recordFor(participant, assessmentId) : null;
        const talkRecord = talkId ? recordFor(participant, talkId) : null;
        return assessmentRecord?.recommendation || talkRecord?.recommendation || "";
      },
    },
  }), [assessmentId, t, tableT, talkId]);
  const table = useDashboardTableView({ rows: active, columns, locale });
  return <div className="space-y-5">
    <TeachingPostworkStatus
      complete={pendingRecords === 0}
      label={pendingRecords === 0 ? t("postworkRecordsComplete") : t("postworkRecordsPending", { count: pendingRecords })}
      done={recordedParticipants}
      total={active.length}
      progressLabel={t("recordedParticipantsValue", { recorded: recordedParticipants, total: active.length })}
    />
    <TeachingPostworkSection title={t("reviewTitle")} description={t("reviewHint")}>
      <div className="mt-4">
        <DashboardTableShell>
          <Table className="min-w-[52rem] table-fixed text-xs">
            <TableHeader><TableRow>
              <TableHead className="h-9 w-56 px-2"><DashboardTableColumnHeader label={t("participant")} {...table.columnProps("participant")} /></TableHead>
              <TableHead className="h-9 w-28 px-2"><DashboardTableColumnHeader label={t("attendanceResult")} {...table.columnProps("attendance")} /></TableHead>
              <TableHead className="h-9 px-2"><DashboardTableColumnHeader label={t("assessmentSummary")} {...table.columnProps("assessment")} /></TableHead>
              <TableHead className="h-9 px-2"><DashboardTableColumnHeader label={t("parentFeedback")} {...table.columnProps("feedback")} /></TableHead>
              <TableHead className="h-9 px-2"><DashboardTableColumnHeader label={t("recommendation")} {...table.columnProps("recommendation")} /></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {table.visibleRows.map((participant) => {
                const assessmentRecord = assessmentId ? recordFor(participant, assessmentId) : null;
                const talkRecord = talkId ? recordFor(participant, talkId) : null;
                const attended = participantAttended(participant);
                return <TableRow key={participant.registrationId}>
                  <TableCell className="px-2 py-2">
                    <Student360Trigger
                      subject={{ studentId: participant.studentId, leadId: participant.leadId }}
                      fallback={{ name: participant.name, grade: participant.grade, gradeText: participant.gradeText, phone: participant.phone }}
                      className="block max-w-full truncate"
                    >
                      {participant.name}
                    </Student360Trigger>
                    <p className="mt-0.5 truncate text-[11px] text-muted">{participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : t("gradePending"))}</p>
                  </TableCell>
                  <TableCell className="px-2 py-2"><Badge variant={attended ? "secondary" : "outline"}>{attended ? t("presence_attended") : t("presence_expected")}</Badge></TableCell>
                  <TableCell className="truncate px-2 py-2 text-muted">{assessmentRecord?.assessmentSummary || assessmentRecord?.learningObservation || "—"}</TableCell>
                  <TableCell className="truncate px-2 py-2 text-muted">{talkRecord?.parentFeedback || assessmentRecord?.parentFeedback || "—"}</TableCell>
                  <TableCell className="px-2 py-2 text-muted"><p className="truncate">{assessmentRecord?.recommendation || talkRecord?.recommendation || "—"}</p>{canFollowUp && attended ? <div className="mt-2"><EnrollmentHandoffButton source={{ registrationId: participant.registrationId, invitationId: null }} name={participant.name} /></div> : null}</TableCell>
                </TableRow>;
              })}
              {table.visibleRows.length === 0 ? <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted">{active.length === 0 ? t("emptyRoster") : tableT("filteredEmpty")}</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </DashboardTableShell>
      </div>
    </TeachingPostworkSection>
  </div>;
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

export function PublicClassRosterView({
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
  return <PublicClassRosterTable
    data={data}
    locale={locale}
    segment={segment}
    canRecord={canRecord}
    pending={pending}
    run={run}
  />;
}

function PublicClassRosterTable({
  data,
  locale,
  segment,
  canRecord,
  pending,
  run,
}: {
  data: PublicClassWorkbenchData;
  locale: string;
  segment: PublicClassSegment;
  canRecord: boolean;
  pending: boolean;
  run: Run;
}) {
  const t = useTranslations("school.publicClass");
  const tableT = useTranslations("school.table");
  const active = useMemo(
    () => data.participants.filter((participant) => participant.status !== "cancelled"),
    [data.participants],
  );
  const columns = useMemo<Record<PublicClassRosterColumn, DashboardTableColumnDefinition<PublicClassParticipant>>>(() => ({
    participant: {
      filterValues: (participant) => [
        { value: `name:${participant.name}`, label: participant.name, group: tableT("fieldName") },
        {
          value: participant.phone ? `phone:${participant.phone}` : `phone:${EMPTY_VALUE}`,
          label: participant.phone || tableT("emptyValue"),
          group: tableT("fieldPhone"),
        },
        {
          value: participant.gradeText || participant.grade
            ? `grade:${participant.gradeText || participant.grade}`
            : `grade:${EMPTY_VALUE}`,
          label: participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : t("gradePending")),
          group: tableT("fieldGrade"),
        },
        {
          value: `identity:${participant.identity}`,
          label: t(`identity_${participant.identity}`),
          group: tableT("fieldIdentity"),
        },
      ],
      sortValue: (participant) => participant.name,
    },
    summary: {
      filterValues: (participant) => {
        const value = recordSummary(participant, segment.id);
        return { value: value || EMPTY_VALUE, label: value || tableT("emptyValue") };
      },
      sortValue: (participant) => recordSummary(participant, segment.id),
    },
    state: {
      filterValues: (participant) => ({
        value: recordSummary(participant, segment.id) ? "recorded" : "pending",
        label: t(recordSummary(participant, segment.id) ? "recorded" : "notRecorded"),
      }),
      sortValue: (participant) => recordSummary(participant, segment.id) ? 1 : 0,
    },
  }), [segment.id, t, tableT]);
  const table = useDashboardTableView({ rows: active, columns, locale });
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
          href={`/dashboard/activities/${data.activity.id}?view=live&segment=${item.id}#onsite-records`}
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
            <TableHead className="sticky left-0 top-0 z-30 h-9 w-60 border-r border-line bg-card px-2"><DashboardTableColumnHeader label={t("participant")} {...table.columnProps("participant")} /></TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-72 bg-card px-2">{segment.kind === "parent_talk" ? t("guardianAttendance") : t("studentAttendance")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={t("recordSummary")} {...table.columnProps("summary")} /></TableHead>
            <TableHead className="sticky top-0 z-20 h-9 w-28 bg-card px-2"><DashboardTableColumnHeader label={t("recordState")} {...table.columnProps("state")} /></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {table.visibleRows.map((participant) => <ParticipantRows
              key={participant.registrationId}
              participant={participant}
              segment={segment}
              canRecord={canRecord}
              pending={pending}
              run={run}
            />)}
            {table.visibleRows.length === 0 ? <TableRow><TableCell colSpan={4} className="h-40 text-center text-muted">{active.length === 0 ? t("emptyRoster") : tableT("filteredEmpty")}</TableCell></TableRow> : null}
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
        <div className="flex w-full items-start gap-2 text-left">
          <button
            type="button"
            className="mt-0.5 shrink-0 rounded-sm text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crater"
            aria-label={t("expandParticipant", { name: participant.name })}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <span className="min-w-0">
            <Student360Trigger
              subject={{ studentId: participant.studentId, leadId: participant.leadId }}
              fallback={{
                name: participant.name,
                grade: participant.grade,
                gradeText: participant.gradeText,
                phone: participant.phone,
              }}
              className="block max-w-full truncate"
            >
              {participant.name}
            </Student360Trigger>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {participant.gradeText || (participant.grade ? t("gradeValue", { grade: participant.grade }) : t("gradePending"))}
              {` · ${t(`identity_${participant.identity}`)}`}
              {participant.phone ? ` · ${participant.phone}` : ""}
            </span>
          </span>
        </div>
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
