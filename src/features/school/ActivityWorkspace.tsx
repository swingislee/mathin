"use client";

import { CircleAlert, CircleCheck, LoaderCircle, Search, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import {
  beginActivityAssessmentAction,
  bookActivityAction,
  markActivityResultAction,
  saveActivityAssessmentAction,
  saveActivityRouteAction,
  searchStudentsForActivity,
} from "./activity-actions";
import {
  ACTIVITY_ROUTES,
  ASSESSMENT_BANDS,
  type ActivityRouteKind,
  type ActivityWorkspaceNode,
  type AssessmentBand,
  type StoredAssessmentBand,
} from "./activity-workflow-contract";
import type { ActivityRegistration, ActivityRow } from "./activities";
import {
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardSection,
  DashboardTableShell,
  StatusStrip,
} from "./dashboard-page";

type ParticipationStatus = ActivityRegistration["status"];
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface AssessmentDraft {
  assessmentBand: StoredAssessmentBand | null;
  score: number | null;
  strengths: string;
  focusAreas: string;
  parentConcerns: string;
  teacherRecommendation: string;
  recommendedClass: string;
}

interface RouteDraft {
  route: ActivityRouteKind | "";
  note: string;
}

export function ActivityWorkspace({
  activity,
  activeNode,
  canRegister,
  canAssess,
  canViewOutcome,
  canRecordOutcome,
}: {
  activity: ActivityRow;
  activeNode: ActivityWorkspaceNode;
  canRegister: boolean;
  canAssess: boolean;
  canViewOutcome: boolean;
  canRecordOutcome: boolean;
}) {
  const t = useTranslations("school.activities");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [autoAttendedIds, setAutoAttendedIds] = useState<Set<string>>(() => new Set());
  const [autoAttendancePendingIds, setAutoAttendancePendingIds] = useState<Set<string>>(() => new Set());
  const registrations = activity.registrations.map((registration) => autoAttendedIds.has(registration.id)
    ? { ...registration, status: "attended" as const }
    : registration);
  const attended = registrations.filter((registration) => registration.status === "attended").length;
  const assessed = registrations.filter((registration) => registration.assessment !== null).length;
  const awaitingRoute = registrations.filter((registration) =>
    registration.status === "attended" && registration.assessment !== null && registration.route === null
  ).length;

  const run = (action: () => Promise<ActionResult>, successMessage: string, onSuccess?: () => void) => {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(successMessage);
        onSuccess?.();
        router.refresh();
        return;
      }
      toast.error(actionErrorMessage(t, result.code));
    });
  };

  const markAttendedWhenEditing = (registration: ActivityRegistration) => {
    if (registration.status === "attended" || autoAttendancePendingIds.has(registration.id)) return;
    if (registration.status === "cancelled") return;

    setAutoAttendedIds((current) => new Set(current).add(registration.id));
    setAutoAttendancePendingIds((current) => new Set(current).add(registration.id));
    void beginActivityAssessmentAction(registration.id).then((result) => {
      setAutoAttendancePendingIds((current) => without(current, registration.id));
      if (result.ok) return;
      setAutoAttendedIds((current) => without(current, registration.id));
      toast.error(actionErrorMessage(t, result.code));
    }).catch(() => {
      setAutoAttendancePendingIds((current) => without(current, registration.id));
      setAutoAttendedIds((current) => without(current, registration.id));
      toast.error(actionErrorMessage(t, "UNKNOWN"));
    });
  };

  const nodeItems = [
    { value: "participation", label: t("nodeParticipation"), href: `/dashboard/activities/${activity.id}?node=participation` },
    ...((canAssess || canViewOutcome)
      ? [{ value: "assessment", label: t("nodeAssessment"), href: `/dashboard/activities/${activity.id}?node=assessment` }]
      : []),
  ];

  return <div className="space-y-6">
    <StatusStrip items={[
      { label: t("activeRoster"), value: registrations.filter((registration) => registration.status !== "cancelled").length },
      { label: t("attended"), value: attended },
      { label: t("assessmentEntered"), value: assessed },
      ...(canViewOutcome ? [{ label: t("awaitingRoute"), value: awaitingRoute }] : []),
    ]} />

    <DashboardCommandPanel>
      <DashboardCommandState className="gap-3">
        <span className="text-xs font-medium text-muted">{t("entryNode")}</span>
        <DashboardCommandTabs
          ariaLabel={t("entryNode")}
          activeValue={activeNode}
          items={nodeItems}
        />
      </DashboardCommandState>
    </DashboardCommandPanel>

    {activeNode === "participation" ? <ParticipationTable
      activity={{ ...activity, registrations }}
      pending={pending}
      canRegister={canRegister}
      run={run}
      statusPendingIds={autoAttendancePendingIds}
      onStatusEdit={(registrationId) => setAutoAttendedIds((current) => without(current, registrationId))}
    /> : null}

    {activeNode === "assessment" ? <AssessmentTable
      registrations={registrations}
      canAssess={canAssess}
      canViewOutcome={canViewOutcome}
      canRecordOutcome={canRecordOutcome}
      attendancePendingIds={autoAttendancePendingIds}
      onEdit={markAttendedWhenEditing}
    /> : null}
  </div>;
}

function ParticipationTable({
  activity,
  pending,
  canRegister,
  run,
  statusPendingIds,
  onStatusEdit,
}: {
  activity: ActivityRow;
  pending: boolean;
  canRegister: boolean;
  run: (action: () => Promise<ActionResult>, successMessage: string, onSuccess?: () => void) => void;
  statusPendingIds: ReadonlySet<string>;
  onStatusEdit: (registrationId: string) => void;
}) {
  const t = useTranslations("school.activities");

  const setStatus = (registration: ActivityRegistration, status: ParticipationStatus) => {
    onStatusEdit(registration.id);
    if (status === "booked") {
      run(() => bookActivityAction(activity.id, registration.studentId), t("resultMarked"));
      return;
    }
    run(() => markActivityResultAction(registration.id, status, registration.outcome), t("resultMarked"));
  };

  return <DashboardSection
    title={t("participationNodeTitle")}
    description={t("participationNodeHint")}
    actions={canRegister ? <StudentSearch activity={activity} pending={pending} run={run} /> : undefined}
  >
    <DashboardTableShell>
      <Table className="min-w-[58rem]">
        <TableHeader><TableRow>
          <TableHead>{t("student")}</TableHead>
          <TableHead>{t("participation")}</TableHead>
          <TableHead>{t("onSiteNote")}</TableHead>
          <TableHead>{t("assessment")}</TableHead>
          <TableHead>{t("routingResult")}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {activity.registrations.map((registration) => <TableRow key={registration.id}>
            <StudentCell registration={registration} />
            <TableCell>
              {canRegister ? <Select
                value={registration.status}
                disabled={pending || statusPendingIds.has(registration.id)}
                onValueChange={(value) => setStatus(registration, value as ParticipationStatus)}
              >
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="booked">{t("status_booked")}</SelectItem>
                  <SelectItem value="attended">{t("status_attended")}</SelectItem>
                  <SelectItem value="no_show">{t("status_no_show")}</SelectItem>
                  <SelectItem value="cancelled">{t("status_cancelled")}</SelectItem>
                </SelectContent>
              </Select> : <Badge variant="outline">{t(`status_${registration.status}`)}</Badge>}
            </TableCell>
            <TableCell className="max-w-80 whitespace-normal text-sm text-muted">{registration.outcome || "—"}</TableCell>
            <TableCell>{registration.assessment
              ? <Badge variant="secondary">{registration.assessment.assessmentBand ? t(`band_${registration.assessment.assessmentBand}`) : t("assessmentEntered")}</Badge>
              : <span className="text-xs text-muted">{t("notEntered")}</span>}</TableCell>
            <TableCell>{registration.route
              ? <Badge variant="outline">{t(`route_${registration.route.route}`)}</Badge>
              : <span className="text-xs text-muted">{t("route_pending")}</span>}</TableCell>
          </TableRow>)}
          {activity.registrations.length === 0 ? <TableRow><TableCell colSpan={5} className="h-40 text-center text-muted">{t("noParticipants")}</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </DashboardTableShell>
  </DashboardSection>;
}

function StudentSearch({
  activity,
  pending,
  run,
}: {
  activity: ActivityRow;
  pending: boolean;
  run: (action: () => Promise<ActionResult>, successMessage: string, onSuccess?: () => void) => void;
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

  return <div className="relative w-full min-w-56 sm:w-72">
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
  </div>;
}

function AssessmentTable({
  registrations,
  canAssess,
  canViewOutcome,
  canRecordOutcome,
  attendancePendingIds,
  onEdit,
}: {
  registrations: ActivityRegistration[];
  canAssess: boolean;
  canViewOutcome: boolean;
  canRecordOutcome: boolean;
  attendancePendingIds: ReadonlySet<string>;
  onEdit: (registration: ActivityRegistration) => void;
}) {
  const t = useTranslations("school.activities");
  const rows = registrations.filter((registration) => registration.status !== "cancelled");
  const columnCount = canViewOutcome ? 12 : 10;

  return <DashboardSection
    title={t("assessmentNodeTitle")}
    description={t("assessmentNodeHint")}
    actions={<span className="text-xs text-muted">{t("entryKeyboardHint")}</span>}
  >
    <DashboardTableShell>
      <Table className="min-w-[128rem] table-fixed">
        <TableHeader className="bg-card">
          <TableRow className="border-b border-line/60 hover:bg-transparent">
            <TableHead rowSpan={2} className="sticky left-0 z-30 w-44 border-r border-line bg-card">{t("student")}</TableHead>
            <TableHead rowSpan={2} className="sticky left-44 z-30 w-28 border-r border-line bg-card">{t("participation")}</TableHead>
            <TableHead scope="colgroup" colSpan={4} className="h-8 text-center">{t("assessmentGroup")}</TableHead>
            <TableHead scope="colgroup" colSpan={3} className="h-8 text-center">{t("familyDecisionGroup")}</TableHead>
            {canViewOutcome ? <TableHead scope="colgroup" colSpan={2} className="h-8 text-center">{t("conversationOutcome")}</TableHead> : null}
            <TableHead rowSpan={2} className="w-24">{t("saveState")}</TableHead>
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-32">{t("assessmentBand")}</TableHead>
            <TableHead className="w-24">{t("scoreShort")}</TableHead>
            <TableHead className="w-52">{t("strengths")}</TableHead>
            <TableHead className="w-52">{t("focusAreas")}</TableHead>
            <TableHead className="w-52">{t("parentConcerns")}</TableHead>
            <TableHead className="w-44">{t("recommendedClass")}</TableHead>
            <TableHead className="w-56">{t("teacherRecommendation")}</TableHead>
            {canViewOutcome ? <>
              <TableHead className="w-52">{t("routingResult")}</TableHead>
              <TableHead className="w-56">{t("routingNote")}</TableHead>
            </> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((registration) => <AssessmentRow
            key={registration.id}
            registration={registration}
            canAssess={canAssess}
            canViewOutcome={canViewOutcome}
            canRecordOutcome={canRecordOutcome}
            attendancePending={attendancePendingIds.has(registration.id)}
            onEdit={onEdit}
          />)}
          {rows.length === 0 ? <TableRow><TableCell colSpan={columnCount} className="h-40 text-center text-muted">{t("noAssessmentRows")}</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </DashboardTableShell>
  </DashboardSection>;
}

function AssessmentRow({
  registration,
  canAssess,
  canViewOutcome,
  canRecordOutcome,
  attendancePending,
  onEdit,
}: {
  registration: ActivityRegistration;
  canAssess: boolean;
  canViewOutcome: boolean;
  canRecordOutcome: boolean;
  attendancePending: boolean;
  onEdit: (registration: ActivityRegistration) => void;
}) {
  const t = useTranslations("school.activities");
  const assessment = registration.assessment;
  const assessmentAutosave = useAutosavedDraft<AssessmentDraft>({
    initial: {
      assessmentBand: assessment?.assessmentBand ?? null,
      score: assessment?.score ?? null,
      strengths: assessment?.strengths ?? "",
      focusAreas: assessment?.focusAreas ?? "",
      parentConcerns: assessment?.parentConcerns ?? "",
      teacherRecommendation: assessment?.teacherRecommendation ?? "",
      recommendedClass: assessment?.recommendedClass ?? "",
    },
    enabled: canAssess && registration.status !== "cancelled" && !attendancePending,
    save: (draft) => saveActivityAssessmentAction({ registrationId: registration.id, ...draft }),
    errorMessage: t("assessmentAutosaveFailed"),
  });
  const routeAutosave = useAutosavedDraft<RouteDraft>({
    initial: {
      route: registration.route?.route ?? "",
      note: registration.route?.note ?? "",
    },
    enabled: canViewOutcome
      && canRecordOutcome
      && registration.status === "attended"
      && !attendancePending,
    save: (draft) => draft.route
      ? saveActivityRouteAction({ registrationId: registration.id, route: draft.route, note: draft.note })
      : Promise.resolve({ ok: false, code: "VALIDATION" as const }),
    errorMessage: t("routeAutosaveFailed"),
  });
  const update = <K extends keyof AssessmentDraft>(key: K, value: AssessmentDraft[K]) => {
    onEdit(registration);
    assessmentAutosave.update(key, value);
  };
  const disabled = !canAssess || registration.status === "cancelled";
  const outcomeDisabled = !canRecordOutcome
    || registration.status !== "attended"
    || attendancePending;
  const saveEntries = [
    ...(canAssess ? [{ state: assessmentAutosave.state, retry: assessmentAutosave.retry }] : []),
    ...(canViewOutcome && canRecordOutcome ? [{ state: routeAutosave.state, retry: routeAutosave.retry }] : []),
  ];
  const saveState = mergeSaveStates(saveEntries.map((entry) => entry.state));

  return <TableRow className="group">
    <StudentCell registration={registration} sticky />
    <TableCell className="sticky left-44 z-20 border-r border-line bg-card group-hover:bg-moon/15"><Badge variant={registration.status === "attended" ? "secondary" : "outline"}>{t(`status_${registration.status}`)}</Badge></TableCell>
    <TableCell className="p-2"><Select
      value={assessmentAutosave.draft.assessmentBand ?? "none"}
      disabled={disabled}
      onValueChange={(value) => update("assessmentBand", value === "none" ? null : value as AssessmentBand)}
    >
      <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t("notEntered")}</SelectItem>
        {assessmentAutosave.draft.assessmentBand === "below_a" ? (
          <SelectItem value="below_a" disabled>{t("band_below_a")}</SelectItem>
        ) : null}
        {ASSESSMENT_BANDS.map((band) => <SelectItem key={band} value={band}>{t(`band_${band}`)}</SelectItem>)}
      </SelectContent>
    </Select></TableCell>
    <TableCell className="p-2"><Input
      aria-label={t("scoreShort")}
      type="number"
      min={0}
      max={10000}
      value={assessmentAutosave.draft.score ?? ""}
      disabled={disabled}
      onChange={(event) => update("score", event.target.value === "" ? null : Number(event.target.value))}
      className="h-9"
    /></TableCell>
    <TableCell className="p-2"><CellTextarea value={assessmentAutosave.draft.strengths} disabled={disabled} label={t("strengths")} onChange={(value) => update("strengths", value)} /></TableCell>
    <TableCell className="p-2"><CellTextarea value={assessmentAutosave.draft.focusAreas} disabled={disabled} label={t("focusAreas")} onChange={(value) => update("focusAreas", value)} /></TableCell>
    <TableCell className="p-2"><CellTextarea value={assessmentAutosave.draft.parentConcerns} disabled={disabled} label={t("parentConcerns")} onChange={(value) => update("parentConcerns", value)} /></TableCell>
    <TableCell className="p-2"><Input
      aria-label={t("recommendedClass")}
      value={assessmentAutosave.draft.recommendedClass}
      disabled={disabled}
      maxLength={200}
      placeholder={t("recommendedClassPlaceholder")}
      onChange={(event) => update("recommendedClass", event.target.value)}
      className="h-9"
    /></TableCell>
    <TableCell className="p-2"><CellTextarea value={assessmentAutosave.draft.teacherRecommendation} disabled={disabled} label={t("teacherRecommendation")} onChange={(value) => update("teacherRecommendation", value)} /></TableCell>
    {canViewOutcome ? <>
      <TableCell className="p-2"><Select
        value={routeAutosave.draft.route || "pending"}
        disabled={outcomeDisabled}
        onValueChange={(value) => routeAutosave.update("route", value === "pending" ? "" : value as ActivityRouteKind)}
      >
        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="pending" disabled>{t("route_pending")}</SelectItem>
          {ACTIVITY_ROUTES.map((route) => <SelectItem key={route} value={route}>{t(`route_${route}`)}</SelectItem>)}
        </SelectContent>
      </Select></TableCell>
      <TableCell className="p-2"><CellTextarea
        value={routeAutosave.draft.note}
        disabled={outcomeDisabled || !routeAutosave.draft.route}
        label={t("routingNote")}
        onChange={(value) => routeAutosave.update("note", value)}
      /></TableCell>
    </> : null}
    <TableCell className="p-2"><AutosaveState
      state={saveState}
      retry={() => saveEntries.filter((entry) => entry.state === "error").forEach((entry) => entry.retry())}
    /></TableCell>
  </TableRow>;
}

function StudentCell({ registration, sticky = false }: { registration: ActivityRegistration; sticky?: boolean }) {
  const t = useTranslations("school.activities");
  return <TableCell className={cn(sticky && "sticky left-0 z-20 border-r border-line bg-card group-hover:bg-moon/15")}>
    <Link href={`/dashboard/students/${registration.studentId}`} className="font-medium text-ink hover:underline">{registration.studentName}</Link>
    {registration.studentGrade ? <p className="mt-0.5 text-xs text-muted">{t("gradeValue", { grade: registration.studentGrade })}</p> : null}
  </TableCell>;
}

function CellTextarea({
  value,
  disabled,
  label,
  onChange,
}: {
  value: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  return <Textarea
    aria-label={label}
    value={value}
    disabled={disabled}
    rows={2}
    maxLength={2_000}
    onChange={(event) => onChange(event.target.value)}
    className="min-h-16 resize-y px-2.5 py-2 text-xs leading-5"
  />;
}

function AutosaveState({ state, retry }: { state: SaveState; retry: () => void }) {
  const t = useTranslations("school.activities");
  if (state === "saving") return <span className="flex items-center gap-1 text-xs text-muted"><LoaderCircle className="size-3.5 animate-spin" />{t("autosave_saving")}</span>;
  if (state === "saved") return <span className="flex items-center gap-1 text-xs text-emerald-700"><CircleCheck className="size-3.5" />{t("autosave_saved")}</span>;
  if (state === "error") return <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-xs text-rose" onClick={retry}><CircleAlert className="size-3.5" />{t("autosave_retry")}</Button>;
  if (state === "dirty") return <span className="text-xs text-muted">{t("autosave_waiting")}</span>;
  return <span className="text-xs text-muted">—</span>;
}

function mergeSaveStates(states: SaveState[]): SaveState {
  if (states.includes("error")) return "error";
  if (states.includes("saving")) return "saving";
  if (states.includes("dirty")) return "dirty";
  if (states.includes("saved")) return "saved";
  return "idle";
}

function useAutosavedDraft<T extends object>({
  initial,
  enabled,
  save,
  errorMessage,
}: {
  initial: T;
  enabled: boolean;
  save: (draft: T) => Promise<ActionResult>;
  errorMessage: string;
}) {
  const [draft, setDraft] = useState<T>(initial);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<SaveState>("idle");
  const latestRevisionRef = useRef(0);
  const saveRef = useRef(save);
  const queueRef = useRef(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    if (!enabled || revision === 0) return;
    const snapshot = draft;
    const snapshotRevision = revision;
    const timer = window.setTimeout(() => {
      if (!mountedRef.current) return;
      setState("saving");
      queueRef.current = queueRef.current.then(async () => {
        const result = await saveRef.current(snapshot);
        if (!mountedRef.current) return;
        if (result.ok) {
          setState(latestRevisionRef.current === snapshotRevision ? "saved" : "dirty");
          return;
        }
        if (latestRevisionRef.current === snapshotRevision) {
          setState("error");
          toast.error(errorMessage);
        }
      }).catch(() => {
        if (mountedRef.current && latestRevisionRef.current === snapshotRevision) {
          setState("error");
          toast.error(errorMessage);
        }
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, enabled, errorMessage, revision]);

  const update = <K extends keyof T>(key: K, value: T[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setState("dirty");
    setRevision((current) => {
      const next = current + 1;
      latestRevisionRef.current = next;
      return next;
    });
  };

  const retry = () => {
    setState("dirty");
    setRevision((current) => {
      const next = current + 1;
      latestRevisionRef.current = next;
      return next;
    });
  };

  return { draft, state, update, retry };
}

function without(values: ReadonlySet<string>, id: string) {
  const next = new Set(values);
  next.delete(id);
  return next;
}

function actionErrorMessage(t: ReturnType<typeof useTranslations<"school.activities">>, code: string) {
  const map: Record<string, string> = {
    ACTIVITY_FULL: "full",
    INVALID_ASSESSMENT: "invalidAssessment",
    INVALID_ACTIVITY_ROUTE: "invalidRoute",
    PARTICIPATION_NOT_ATTENDED: "routeNeedsAttendance",
    PARTICIPATION_CANCELLED: "cancelledCannotAssess",
    VALIDATION: "invalidInput",
  };
  return t(map[code] ?? "actionFailed");
}
