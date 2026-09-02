"use client";

import { Check, LoaderCircle, Search, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import {
  beginActivityAssessmentAction,
  bookActivityAction,
  createActivityOpportunityAction,
  markActivityResultAction,
  saveActivityAssessmentAction,
  searchStudentsForActivity,
  updateSalesOpportunityAction,
} from "./activity-actions";
import { ASSESSMENT_LEVELS, OPPORTUNITY_STAGES, type OpportunityStage } from "./activity-funnel-contract";
import type { ActivityRegistration, ActivityRow, OpportunityOwnerOption } from "./activities";
import { DashboardSection, DashboardTableShell, StatusStrip } from "./dashboard-page";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

type ParticipationStatus = ActivityRegistration["status"];

export function ActivityWorkspace({
  activity,
  owners,
  currentUserId,
  timeZone,
  canRegister,
  canAssess,
  canManageOpportunity,
  initialRegistrationId,
}: {
  activity: ActivityRow;
  owners: OpportunityOwnerOption[];
  currentUserId: string;
  timeZone: string;
  canRegister: boolean;
  canAssess: boolean;
  canManageOpportunity: boolean;
  initialRegistrationId?: string;
}) {
  const t = useTranslations("school.activities");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [autoAttendedIds, setAutoAttendedIds] = useState<Set<string>>(() => new Set());
  const [autoAttendancePendingIds, setAutoAttendancePendingIds] = useState<Set<string>>(() => new Set());
  const registrations = activity.registrations.map((registration) => autoAttendedIds.has(registration.id)
    ? { ...registration, status: "attended" as const }
    : registration);
  const workspaceActivity = { ...activity, registrations };
  const [selectedId, setSelectedId] = useState(
    activity.registrations.some((registration) => registration.id === initialRegistrationId)
      ? initialRegistrationId ?? ""
      : activity.registrations[0]?.id ?? "",
  );
  const selected = registrations.find((registration) => registration.id === selectedId)
    ?? registrations[0]
    ?? null;

  const run = (action: () => Promise<ActionResult>, successMessage: string, onSuccess?: () => void) => {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(successMessage);
        onSuccess?.();
        router.refresh();
        return;
      }
      toast.error(errorMessage(t, result.code));
    });
  };

  const markAttendedWhenScoring = (registration: ActivityRegistration) => {
    if (registration.status === "attended" || autoAttendancePendingIds.has(registration.id)) return;

    setAutoAttendedIds((current) => new Set(current).add(registration.id));
    setAutoAttendancePendingIds((current) => new Set(current).add(registration.id));
    void beginActivityAssessmentAction(registration.id).then((result) => {
      setAutoAttendancePendingIds((current) => {
        const next = new Set(current);
        next.delete(registration.id);
        return next;
      });
      if (result.ok) {
        router.refresh();
        return;
      }
      setAutoAttendedIds((current) => {
        const next = new Set(current);
        next.delete(registration.id);
        return next;
      });
      toast.error(errorMessage(t, result.code));
    }).catch(() => {
      setAutoAttendancePendingIds((current) => {
        const next = new Set(current);
        next.delete(registration.id);
        return next;
      });
      setAutoAttendedIds((current) => {
        const next = new Set(current);
        next.delete(registration.id);
        return next;
      });
      toast.error(errorMessage(t, "UNKNOWN"));
    });
  };

  const attended = registrations.filter((registration) => registration.status === "attended").length;
  const assessed = registrations.filter((registration) => registration.assessment).length;
  const opportunities = registrations.filter((registration) => registration.opportunity).length;

  return <div className="space-y-8">
    <StatusStrip items={[
      { label: t("registered"), value: registrations.filter((registration) => registration.status !== "cancelled").length },
      { label: t("attended"), value: attended },
      { label: t("assessment"), value: assessed },
      { label: t("opportunity"), value: opportunities },
      { label: t("capacity"), value: activity.capacity ?? "∞" },
    ]} />

    <ParticipationRoster
      activity={workspaceActivity}
      selectedId={selected?.id ?? ""}
      pending={pending}
      canRegister={canRegister}
      onSelect={setSelectedId}
      onStatusEdit={(registrationId) => setAutoAttendedIds((current) => {
        const next = new Set(current);
        next.delete(registrationId);
        return next;
      })}
      run={run}
      statusPendingIds={autoAttendancePendingIds}
    />

    <DashboardSection
      title={selected ? t("studentWorkbench", { name: selected.studentName }) : t("studentWorkbenchEmpty")}
      description={selected ? t("studentWorkbenchHint") : t("selectParticipantHint")}
    >
      {selected ? <div className="grid min-w-0 gap-8 lg:grid-cols-2">
        <AssessmentEditor
          key={`assessment-${selected.id}`}
          registration={selected}
          pending={pending}
          canAssess={canAssess}
          run={run}
          attendancePending={autoAttendancePendingIds.has(selected.id)}
          onScoreEdit={markAttendedWhenScoring}
        />
        <OpportunityEditor
          key={`opportunity-${selected.id}-${selected.opportunity?.id ?? "new"}`}
          registration={selected}
          owners={owners}
          currentUserId={currentUserId}
          timeZone={timeZone}
          pending={pending}
          canManage={canManageOpportunity}
          run={run}
        />
      </div> : <div className="grid min-h-40 place-items-center text-sm text-muted">{t("selectParticipantHint")}</div>}
    </DashboardSection>
  </div>;
}

function ParticipationRoster({
  activity,
  selectedId,
  pending,
  canRegister,
  onSelect,
  onStatusEdit,
  run,
  statusPendingIds,
}: {
  activity: ActivityRow;
  selectedId: string;
  pending: boolean;
  canRegister: boolean;
  onSelect: (id: string) => void;
  onStatusEdit: (registrationId: string) => void;
  run: (action: () => Promise<ActionResult>, successMessage: string, onSuccess?: () => void) => void;
  statusPendingIds: ReadonlySet<string>;
}) {
  const t = useTranslations("school.activities");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; grade: number | null }>>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    const value = query.trim();
    if (!value) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      startSearch(async () => {
        const next = await searchStudentsForActivity(value);
        if (!cancelled) setResults(next.filter((student) => !activity.registrations.some((registration) => registration.studentId === student.id)));
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activity.registrations, query]);

  const setStatus = (registration: ActivityRegistration, status: ParticipationStatus) => {
    onStatusEdit(registration.id);
    if (status === "booked") {
      run(() => bookActivityAction(activity.id, registration.studentId), t("resultMarked"));
      return;
    }
    run(() => markActivityResultAction(registration.id, status, registration.outcome), t("resultMarked"));
  };

  return <DashboardSection
    title={t("participationRoster")}
    description={t("participationRosterHint")}
    actions={canRegister ? <div className="relative w-full min-w-56 sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" />
      <Input value={query} onChange={(event) => {
        const value = event.target.value;
        setQuery(value);
        if (!value.trim()) setResults([]);
      }} placeholder={t("searchStudent")} className="h-9 pl-9" />
      {query.trim() ? <div className="absolute right-2 top-2.5 text-muted">{searching ? <LoaderCircle className="size-4 animate-spin" /> : null}</div> : null}
      {results.length > 0 ? <div className="absolute right-0 top-11 z-20 w-full rounded-xl border border-line bg-card p-1 shadow-lg">
        {results.map((student) => <Button
          key={student.id}
          type="button"
          variant="ghost"
          className="w-full justify-start"
          disabled={pending}
          onClick={() => run(
            () => bookActivityAction(activity.id, student.id),
            t("bookSuccess"),
            () => { setQuery(""); setResults([]); },
          )}
        ><UserPlus className="size-4" />{student.name}{student.grade ? <span className="ml-auto text-xs text-muted">{t("gradeValue", { grade: student.grade })}</span> : null}</Button>)}
      </div> : null}
    </div> : undefined}
  >
    <DashboardTableShell>
      <Table>
        <TableHeader><TableRow>
          <TableHead>{t("student")}</TableHead>
          <TableHead>{t("participation")}</TableHead>
          <TableHead>{t("assessment")}</TableHead>
          <TableHead>{t("opportunity")}</TableHead>
          <TableHead className="text-right">{t("actions")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {activity.registrations.map((registration) => <TableRow key={registration.id} className={registration.id === selectedId ? "bg-crater/8" : undefined}>
            <TableCell>
              <Link href={`/dashboard/students/${registration.studentId}`} className="font-medium text-ink hover:underline">{registration.studentName}</Link>
              {registration.studentGrade ? <p className="mt-0.5 text-xs text-muted">{t("gradeValue", { grade: registration.studentGrade })}</p> : null}
            </TableCell>
            <TableCell>
              {canRegister ? <Select value={registration.status} disabled={pending || statusPendingIds.has(registration.id)} onValueChange={(value) => setStatus(registration, value as ParticipationStatus)}>
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="booked">{t("status_booked")}</SelectItem>
                  <SelectItem value="attended">{t("status_attended")}</SelectItem>
                  <SelectItem value="no_show">{t("status_no_show")}</SelectItem>
                  <SelectItem value="cancelled">{t("status_cancelled")}</SelectItem>
                </SelectContent>
              </Select> : <Badge variant="outline">{t(`status_${registration.status}`)}</Badge>}
            </TableCell>
            <TableCell>{registration.assessment
              ? <Badge variant="secondary"><Check className="size-3.5" />{t(`level_${registration.assessment.overallLevel}`)}</Badge>
              : <span className="text-xs text-muted">{t("notEntered")}</span>}</TableCell>
            <TableCell>{registration.opportunity
              ? <Badge variant={registration.opportunity.stage === "won" ? "secondary" : "outline"}>{t(`stage_${registration.opportunity.stage}`)}</Badge>
              : <span className="text-xs text-muted">{t("notCreated")}</span>}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant={registration.id === selectedId ? "secondary" : "ghost"} onClick={() => onSelect(registration.id)}>{t("handle")}</Button></TableCell>
          </TableRow>)}
          {activity.registrations.length === 0 ? <TableRow><TableCell colSpan={5} className="h-40 text-center text-muted">{t("noParticipants")}</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </DashboardTableShell>
  </DashboardSection>;
}

function AssessmentEditor({
  registration,
  pending,
  canAssess,
  run,
  attendancePending,
  onScoreEdit,
}: {
  registration: ActivityRegistration;
  pending: boolean;
  canAssess: boolean;
  run: (action: () => Promise<ActionResult>, successMessage: string) => void;
  attendancePending: boolean;
  onScoreEdit: (registration: ActivityRegistration) => void;
}) {
  const t = useTranslations("school.activities");
  const [overallLevel, setOverallLevel] = useState(registration.assessment?.overallLevel ?? "on_track");
  const [score, setScore] = useState<number | null>(registration.assessment?.score ?? null);
  const [strengths, setStrengths] = useState(registration.assessment?.strengths ?? "");
  const [focusAreas, setFocusAreas] = useState(registration.assessment?.focusAreas ?? "");
  const [teacherRecommendation, setTeacherRecommendation] = useState(registration.assessment?.teacherRecommendation ?? "");
  const canSave = canAssess && registration.status === "attended" && !attendancePending && teacherRecommendation.trim().length > 0;

  return <section className="min-w-0">
    <div className="mb-4">
      <h3 className="text-sm font-medium text-ink">{t("assessmentResult")}</h3>
      <p className="mt-0.5 text-xs leading-5 text-muted">{registration.status === "attended" ? t("assessmentResultHint") : t("attendedRequiredHint")}</p>
    </div>
    {registration.assessment && !canAssess ? <ReadOnlyAssessment registration={registration} /> : <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("overallLevel")}
          <Select value={overallLevel} onValueChange={(value) => setOverallLevel(value as typeof overallLevel)} disabled={!canAssess || pending}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{ASSESSMENT_LEVELS.map((level) => <SelectItem key={level} value={level}>{t(`level_${level}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("scoreOptional")}
          <Input type="number" min={0} max={100} value={score ?? ""} disabled={!canAssess || pending} onChange={(event) => {
            onScoreEdit(registration);
            setScore(event.target.value === "" ? null : Number(event.target.value));
          }} />
        </Label>
      </div>
      <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("strengths")}
        <Textarea value={strengths} onChange={(event) => setStrengths(event.target.value)} disabled={!canAssess || pending} maxLength={2_000} />
      </Label>
      <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("focusAreas")}
        <Textarea value={focusAreas} onChange={(event) => setFocusAreas(event.target.value)} disabled={!canAssess || pending} maxLength={2_000} />
      </Label>
      <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("teacherRecommendation")}
        <Textarea value={teacherRecommendation} onChange={(event) => setTeacherRecommendation(event.target.value)} disabled={!canAssess || pending} maxLength={2_000} placeholder={t("teacherRecommendationPlaceholder")} />
      </Label>
      {canAssess ? <div className="flex justify-end"><Button disabled={!canSave || pending} onClick={() => run(
        () => saveActivityAssessmentAction({
          registrationId: registration.id,
          overallLevel,
          score,
          strengths,
          focusAreas,
          teacherRecommendation,
        }),
        t("assessmentSaved"),
      )}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{registration.assessment ? t("saveAssessment") : t("completeAssessment")}</Button></div> : null}
    </div>}
  </section>;
}

function ReadOnlyAssessment({ registration }: { registration: ActivityRegistration }) {
  const t = useTranslations("school.activities");
  const assessment = registration.assessment;
  if (!assessment) return <p className="text-sm text-muted">{t("notEntered")}</p>;
  return <dl className="grid gap-4 text-sm sm:grid-cols-2">
    <ReadOnlyField label={t("overallLevel")} value={t(`level_${assessment.overallLevel}`)} />
    <ReadOnlyField label={t("scoreOptional")} value={assessment.score ?? "—"} />
    <ReadOnlyField label={t("strengths")} value={assessment.strengths || "—"} />
    <ReadOnlyField label={t("focusAreas")} value={assessment.focusAreas || "—"} />
    <ReadOnlyField className="sm:col-span-2" label={t("teacherRecommendation")} value={assessment.teacherRecommendation} />
  </dl>;
}

function OpportunityEditor({
  registration,
  owners,
  currentUserId,
  timeZone,
  pending,
  canManage,
  run,
}: {
  registration: ActivityRegistration;
  owners: OpportunityOwnerOption[];
  currentUserId: string;
  timeZone: string;
  pending: boolean;
  canManage: boolean;
  run: (action: () => Promise<ActionResult>, successMessage: string) => void;
}) {
  const t = useTranslations("school.activities");
  const locale = useLocale();
  const opportunity = registration.opportunity;
  const defaultOwner = opportunity?.ownerId ?? (owners.some((owner) => owner.userId === currentUserId) ? currentUserId : owners[0]?.userId ?? "");
  const [stage, setStage] = useState<OpportunityStage>(opportunity?.stage ?? "new");
  const [ownerId, setOwnerId] = useState(defaultOwner);
  const [nextAction, setNextAction] = useState(opportunity?.nextAction ?? "");
  const [nextActionAt, setNextActionAt] = useState(() => opportunity?.nextActionAt
    ? zonedDateTimeInputValue(new Date(opportunity.nextActionAt), timeZone)
    : zonedDateTimeInputValue(new Date(Date.now() + 24 * 60 * 60 * 1_000), timeZone));
  const [note, setNote] = useState(opportunity?.note ?? "");
  const closed = stage === "won" || stage === "lost";
  const nextActionInstant = nextActionAt ? dateTimeInputToInstant(nextActionAt, timeZone) : null;
  const canSave = Boolean(ownerId) && (closed || (nextAction.trim() && nextActionInstant));

  return <section className="min-w-0 lg:border-l lg:border-line/80 lg:pl-8">
    <div className="mb-4">
      <h3 className="text-sm font-medium text-ink">{t("salesOpportunity")}</h3>
      <p className="mt-0.5 text-xs leading-5 text-muted">{t("salesOpportunityHint")}</p>
    </div>
    {!registration.assessment ? <p className="text-sm text-muted">{t("assessmentBeforeOpportunity")}</p> : !canManage ? (
      opportunity ? <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <ReadOnlyField label={t("opportunityStage")} value={t(`stage_${opportunity.stage}`)} />
        <ReadOnlyField label={t("opportunityOwner")} value={opportunity.ownerName} />
        <ReadOnlyField label={t("nextAction")} value={opportunity.nextAction || "—"} />
        <ReadOnlyField label={t("nextActionAt")} value={opportunity.nextActionAt ? new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(opportunity.nextActionAt)) : "—"} />
        <ReadOnlyField className="sm:col-span-2" label={t("opportunityNote")} value={opportunity.note || "—"} />
      </dl> : <p className="text-sm text-muted">{t("notCreated")}</p>
    ) : <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {opportunity ? <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("opportunityStage")}
          <Select value={stage} onValueChange={(value) => setStage(value as OpportunityStage)} disabled={pending}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{OPPORTUNITY_STAGES.map((value) => <SelectItem key={value} value={value}>{t(`stage_${value}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Label> : <div><p className="text-xs text-muted">{t("opportunityStage")}</p><Badge className="mt-2" variant="outline">{t("stage_new")}</Badge></div>}
        <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("opportunityOwner")}
          <Select value={ownerId} onValueChange={setOwnerId} disabled={pending || owners.length === 0}>
            <SelectTrigger><SelectValue placeholder={t("selectOwner")} /></SelectTrigger>
            <SelectContent>{owners.map((owner) => <SelectItem key={owner.userId} value={owner.userId}>{owner.displayName}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
      </div>
      <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("nextAction")}
        <Input value={nextAction} onChange={(event) => setNextAction(event.target.value)} disabled={pending} maxLength={500} placeholder={closed ? t("closedNextActionOptional") : t("nextActionPlaceholder")} />
      </Label>
      <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("nextActionAt")} · {timeZone}
        <DateTimePicker mode="datetime" value={nextActionAt} onValueChange={setNextActionAt} disabled={pending} />
      </Label>
      <Label className="grid gap-1.5 text-xs font-normal text-muted">{t("opportunityNote")}
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={pending} maxLength={2_000} />
      </Label>
      <div className="flex justify-end"><Button disabled={!canSave || pending} onClick={() => {
        const instant = nextActionInstant?.toISOString() ?? null;
        if (opportunity) {
          run(() => updateSalesOpportunityAction({
            opportunityId: opportunity.id,
            stage,
            ownerId,
            nextAction,
            nextActionAt: instant,
            note,
          }), t("opportunitySaved"));
        } else if (instant) {
          run(() => createActivityOpportunityAction({
            registrationId: registration.id,
            ownerId,
            nextAction,
            nextActionAt: instant,
            note,
          }), t("opportunityCreated"));
        }
      }}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{opportunity ? t("saveOpportunity") : t("createOpportunity")}</Button></div>
    </div>}
  </section>;
}

function ReadOnlyField({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return <div className={className}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-ink">{value}</dd></div>;
}

function errorMessage(t: ReturnType<typeof useTranslations<"school.activities">>, code: string): string {
  const mapped: Record<string, string> = {
    ACTIVITY_FULL: "full",
    PARTICIPATION_NOT_ATTENDED: "attendedRequiredHint",
    ASSESSMENT_REQUIRED: "assessmentBeforeOpportunity",
    INVALID_OWNER: "invalidOwner",
    INVALID_ASSESSMENT: "invalidAssessment",
    INVALID_OPPORTUNITY: "invalidOpportunity",
    VALIDATION: "invalidInput",
  };
  return t(mapped[code] ?? "actionFailed");
}
