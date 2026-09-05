"use client";

import {
  ArrowUpRight,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  History,
  LoaderCircle,
  MapPinned,
  MessageSquareText,
  PanelRightClose,
  RefreshCw,
  UserRoundSearch,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getStudent360Action } from "./actions/student-360";
import {
  STUDENT_360_PHASES,
  STUDENT_360_REFRESH_EVENT,
  type Student360Event,
  type Student360Fact,
  type Student360FallbackIdentity,
  type Student360Phase,
  type Student360Snapshot,
  type Student360SubjectRef,
} from "./student-360-contract";

type TimelineFilter = "all" | "business" | "teaching" | "notes";

const BUSINESS_PHASES = new Set<Student360Phase>([
  "source",
  "contact",
  "invitation",
  "experience",
  "assessment",
]);

const STATUS_KEYS: Record<string, string> = {
  "lead.unassigned": "status_lead_unassigned",
  "lead.uncontacted": "status_lead_uncontacted",
  "lead.contacted": "status_lead_contacted",
  "lead.nurture": "status_lead_nurture",
  "lead.intent_confirmed": "status_lead_intent_confirmed",
  "lead.invalid": "status_lead_invalid",
  "lead.converted": "status_lead_converted",
  "identity.student": "status_identity_student",
  "contact.unreachable": "status_contact_unreachable",
  "contact.connected": "status_contact_connected",
  "contact.declined": "status_contact_declined",
  "contact.invalid_number": "status_contact_invalid_number",
  "next_action.open": "status_next_action_open",
  "next_action.completed": "status_next_action_completed",
  "next_action.cancelled": "status_next_action_cancelled",
  "invitation.coordinating_time": "status_invitation_coordinating_time",
  "invitation.awaiting_teacher": "status_invitation_awaiting_teacher",
  "invitation.awaiting_parent": "status_invitation_awaiting_parent",
  "invitation.confirmed": "status_invitation_confirmed",
  "invitation.waiting_activity": "status_invitation_waiting_activity",
  "invitation.completed": "status_invitation_completed",
  "invitation.cancelled": "status_invitation_cancelled",
  "registration.booked": "status_registration_booked",
  "registration.attended": "status_registration_attended",
  "registration.no_show": "status_registration_no_show",
  "registration.cancelled": "status_registration_cancelled",
  "assessment.below_a": "status_assessment_below_a",
  "assessment.a": "status_assessment_a",
  "assessment.a_plus": "status_assessment_a_plus",
  "assessment.g_plus": "status_assessment_g_plus",
  "assessment.s": "status_assessment_s",
  "assessment.x_plus": "status_assessment_x_plus",
  "assessment.needs_support": "status_assessment_needs_support",
  "assessment.developing": "status_assessment_developing",
  "assessment.on_track": "status_assessment_on_track",
  "assessment.advanced": "status_assessment_advanced",
  "route.continue_follow_up": "status_route_continue_follow_up",
  "route.await_product": "status_route_await_product",
  "route.closed": "status_route_closed",
  "presence.expected": "status_presence_expected",
  "presence.attended": "status_presence_attended",
  "presence.late": "status_presence_late",
  "presence.absent": "status_presence_absent",
  "presence.not_applicable": "status_presence_not_applicable",
  "followup.note": "status_followup_note",
  "followup.call": "status_followup_call",
  "followup.class": "status_followup_class",
  "followup.visit": "status_followup_visit",
  "followup.activity": "status_followup_activity",
  "enrollment.active": "status_enrollment_active",
  "enrollment.completed": "status_enrollment_completed",
  "enrollment.transferred_out": "status_enrollment_transferred_out",
  "enrollment.withdrawn": "status_enrollment_withdrawn",
  "attendance.present": "status_attendance_present",
  "attendance.absent": "status_attendance_absent",
  "attendance.late": "status_attendance_late",
  "attendance.leave": "status_attendance_leave",
  "lesson.reviewed": "status_lesson_reviewed",
};

const POSITIVE_STATUSES = new Set([
  "identity.student",
  "contact.connected",
  "invitation.confirmed",
  "invitation.completed",
  "registration.attended",
  "presence.attended",
  "enrollment.active",
  "attendance.present",
  "lesson.reviewed",
]);
const RISK_STATUSES = new Set([
  "lead.invalid",
  "contact.declined",
  "contact.invalid_number",
  "invitation.cancelled",
  "registration.no_show",
  "registration.cancelled",
  "presence.absent",
  "enrollment.withdrawn",
  "attendance.absent",
]);

const CODE_KEYS: Partial<Record<Student360Fact["label"], Record<string, string>>> = {
  channel: {
    phone: "code_channel_phone",
    wechat: "code_channel_wechat",
    in_person: "code_channel_in_person",
    other: "code_channel_other",
  },
  next_action_kind: {
    initial_contact: "code_next_action_kind_initial_contact",
    retry: "code_next_action_kind_retry",
    wechat_followup: "code_next_action_kind_wechat_followup",
    visit_confirmation: "code_next_action_kind_visit_confirmation",
    invitation_followup: "code_next_action_kind_invitation_followup",
    nurture: "code_next_action_kind_nurture",
    other: "code_next_action_kind_other",
  },
  invitation_kind: {
    assessment_1v1: "code_invitation_kind_assessment_1v1",
    activity: "code_invitation_kind_activity",
    waiting_activity: "code_invitation_kind_waiting_activity",
  },
  activity_kind: {
    trial_class: "code_activity_kind_trial_class",
    assessment_1v1: "code_activity_kind_assessment_1v1",
    sanbanfu: "code_activity_kind_sanbanfu",
    lecture: "code_activity_kind_lecture",
    competition: "code_activity_kind_competition",
    public_class: "code_activity_kind_public_class",
  },
  band: {
    below_a: "status_assessment_below_a",
    a: "status_assessment_a",
    a_plus: "status_assessment_a_plus",
    g_plus: "status_assessment_g_plus",
    s: "status_assessment_s",
    x_plus: "status_assessment_x_plus",
    needs_support: "status_assessment_needs_support",
    developing: "status_assessment_developing",
    on_track: "status_assessment_on_track",
    advanced: "status_assessment_advanced",
  },
  student_presence: {
    expected: "status_presence_expected",
    attended: "status_presence_attended",
    late: "status_presence_late",
    absent: "status_presence_absent",
    not_applicable: "status_presence_not_applicable",
  },
  guardian_presence: {
    expected: "status_presence_expected",
    attended: "status_presence_attended",
    late: "status_presence_late",
    absent: "status_presence_absent",
    not_applicable: "status_presence_not_applicable",
  },
};

const PHASE_ICONS = {
  source: MapPinned,
  contact: MessageSquareText,
  invitation: CalendarClock,
  experience: UserRoundSearch,
  assessment: ClipboardCheck,
  enrollment: GraduationCap,
  learning: BookOpenCheck,
} satisfies Record<Student360Phase, typeof History>;

interface Student360WorkspaceContextValue {
  openStudent: (subject: Student360SubjectRef, fallback: Student360FallbackIdentity) => void;
}

interface ActiveStudent360 {
  subject: Student360SubjectRef;
  fallback: Student360FallbackIdentity;
}

const Student360WorkspaceContext = createContext<Student360WorkspaceContextValue | null>(null);

function errorKey(code: string): string {
  if (code === "NOT_FOUND") return "error_not_found";
  if (code === "FORBIDDEN" || code === "UNAUTHENTICATED") return "error_forbidden";
  if (code === "SUBJECT_MISMATCH") return "error_mismatch";
  return "error_unknown";
}

/**
 * Dashboard 级学生档案工作区。
 *
 * 宽屏时档案栏参与真实水平布局，主业务页因此缩窄但仍保持完整交互；窄屏没有可靠的
 * 并排空间，才退化成覆盖层。Provider 放在 DashboardShell 而不是每一张业务表里，
 * 这样切换学生时只有一份档案状态，也不会为每一行挂一套抽屉 Portal。
 */
export function Student360Workspace({ children }: { children: ReactNode }) {
  const t = useTranslations("school.student360");
  const locale = useLocale();
  const [active, setActive] = useState<ActiveStudent360 | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<Student360Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const loadSnapshot = useCallback((subject: Student360SubjectRef, resetSnapshot: boolean) => {
    const version = ++requestVersion.current;
    if (resetSnapshot) setSnapshot(null);
    setError(null);
    setLoading(true);
    void getStudent360Action(subject).then((result) => {
      if (requestVersion.current !== version) return;
      setLoading(false);
      if (result.ok) {
        setSnapshot(result.data);
        setError(null);
        return;
      }
      if (resetSnapshot) setSnapshot(null);
      setError(result.code);
    }).catch(() => {
      if (requestVersion.current !== version) return;
      setLoading(false);
      if (resetSnapshot) setSnapshot(null);
      setError("UNKNOWN");
    });
  }, []);

  const openStudent = useCallback((subject: Student360SubjectRef, fallback: Student360FallbackIdentity) => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setActive({ subject, fallback });
    setExpanded(true);
    loadSnapshot(subject, true);
  }, [loadSnapshot]);

  const close = useCallback(() => {
    requestVersion.current += 1;
    setExpanded(false);
    setLoading(false);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setActive(null);
      setSnapshot(null);
      setError(null);
      closeTimer.current = null;
    }, 200);
  }, []);

  const retry = useCallback(() => {
    if (active) loadSnapshot(active.subject, true);
  }, [active, loadSnapshot]);

  const refresh = useCallback(() => {
    if (active) loadSnapshot(active.subject, false);
  }, [active, loadSnapshot]);

  useEffect(() => {
    window.addEventListener(STUDENT_360_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(STUDENT_360_REFRESH_EVENT, refresh);
  }, [refresh]);

  const contextValue = useMemo<Student360WorkspaceContextValue>(() => ({ openStudent }), [openStudent]);

  return (
    <Student360WorkspaceContext.Provider value={contextValue}>
      <div data-student-360-workspace className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
        {active ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("close")}
            className={cn(
              "absolute inset-0 z-40 bg-ink/35 transition-opacity duration-200 motion-reduce:transition-none xl:hidden",
              expanded ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            onClick={close}
          />
        ) : null}
        <aside
          data-student-360-side-page
          aria-labelledby={active ? "student-360-heading" : undefined}
          aria-describedby={active ? "student-360-description" : undefined}
          aria-hidden={!expanded}
          inert={!expanded || undefined}
          className={cn(
            "absolute inset-y-0 right-0 z-50 flex w-[min(94vw,46rem)] flex-col overflow-x-hidden overflow-y-auto border-l border-line bg-paper shadow-xl transition-[width,transform,opacity,border-color] duration-200 ease-out motion-reduce:transition-none xl:relative xl:inset-auto xl:z-auto xl:shrink-0 xl:shadow-none",
            expanded
              ? "translate-x-0 opacity-100 xl:w-[clamp(26rem,40%,46rem)]"
              : "pointer-events-none translate-x-full border-l-transparent opacity-0 xl:w-0",
          )}
        >
          {active ? (
            <Student360PanelBody
              snapshot={snapshot}
              fallback={active.fallback}
              locale={locale}
              loading={loading}
              error={error}
              retry={retry}
              refresh={refresh}
              close={close}
            />
          ) : null}
        </aside>
      </div>
    </Student360WorkspaceContext.Provider>
  );
}

export function Student360Trigger({
  subject,
  fallback,
  children,
  className,
}: {
  subject: Student360SubjectRef;
  fallback: Student360FallbackIdentity;
  children?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("school.student360");
  const workspace = useContext(Student360WorkspaceContext);

  if (!workspace) throw new Error("Student360Trigger must be rendered inside Student360Workspace");

  return (
    <button
      type="button"
      className={cn(
        "min-w-0 rounded-sm text-left font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        className,
      )}
      aria-label={t("openFor", { name: fallback.name })}
      onClick={(event) => {
        event.stopPropagation();
        workspace.openStudent(subject, fallback);
      }}
    >
      {children ?? fallback.name}
    </button>
  );
}

function Student360PanelBody({
  snapshot,
  fallback,
  locale,
  loading,
  error,
  retry,
  refresh,
  close,
}: {
  snapshot: Student360Snapshot | null;
  fallback: Student360FallbackIdentity;
  locale: string;
  loading: boolean;
  error: string | null;
  retry: () => void;
  refresh: () => void;
  close: () => void;
}) {
  const t = useTranslations("school.student360");
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const month = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const day = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const identity = snapshot?.identity;
  const name = identity?.name || fallback.name;
  const grade = identity?.grade ?? fallback.grade;
  const gradeLabel = identity?.gradeText || fallback.gradeText || (grade ? t("gradeValue", { grade }) : t("gradePending"));
  const phone = identity?.phone || fallback.phone || "";
  const visibleEvents = useMemo(() => {
    if (!snapshot) return [];
    if (filter === "business") return snapshot.events.filter((event) => BUSINESS_PHASES.has(event.phase));
    if (filter === "teaching") return snapshot.events.filter((event) => !BUSINESS_PHASES.has(event.phase));
    if (filter === "notes") return snapshot.events.filter((event) => event.notes.length > 0);
    return snapshot.events;
  }, [filter, snapshot]);
  const groups = useMemo(() => {
    const result: Array<{ key: string; label: string; events: Student360Event[] }> = [];
    for (const event of visibleEvents) {
      const date = new Date(event.occurredAt);
      const label = month.format(date);
      const key = label;
      const last = result[result.length - 1];
      if (last?.key === key) last.events.push(event);
      else result.push({ key, label, events: [event] });
    }
    return result;
  }, [month, visibleEvents]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 px-5 py-4 backdrop-blur sm:px-7">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="-ml-5 mt-0.5 h-8 w-9 shrink-0 rounded-l-none rounded-r-md border-l-0 bg-moon/45 p-0 shadow-sm sm:-ml-7"
            aria-label={t("close")}
            title={t("close")}
            onClick={close}
          >
            <PanelRightClose className="size-4" />
          </Button>
          <div className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="student-360-heading" className="font-display text-xl text-ink">{name}</h2>
              {identity ? <Badge variant={identity.identityState === "student" ? "secondary" : "outline"}>
                {t(`identity_${identity.identityState}`)}
              </Badge> : null}
              {identity?.accessScope === "journey" ? <Badge variant="outline">{t("journeyScope")}</Badge> : null}
            </div>
            <p id="student-360-description" className="mt-1 text-sm text-muted">{t("description")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-9 rounded-full p-0"
              aria-label={t("refresh")}
              disabled={loading}
              onClick={refresh}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>{gradeLabel}</span>
          {phone ? <a href={`tel:${phone}`} className="font-mono hover:text-ink hover:underline">{phone}</a> : null}
          {identity?.school ? <span>{identity.school}</span> : null}
          {identity?.assignedName ? <span>{t("ownerValue", { name: identity.assignedName })}</span> : null}
          {identity?.nextActionAt ? <span className="font-medium text-rose">{t("nextActionValue", { time: dateTime.format(new Date(identity.nextActionAt)) })}</span> : null}
        </div>
      </header>

      {loading && !snapshot ? <Student360Loading /> : null}
      {error && !snapshot ? (
        <div className="grid min-h-[55dvh] place-items-center px-6 py-16 text-center">
          <div className="max-w-sm">
            <UserRoundSearch className="mx-auto size-9 text-muted" />
            <p className="mt-4 text-sm font-medium text-ink">{t(errorKey(error))}</p>
            <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={retry}>{t("retry")}</Button>
          </div>
        </div>
      ) : null}
      {snapshot ? (
        <div>
          {error ? (
            <div role="alert" className="flex items-center justify-between gap-3 border-b border-line bg-rose/5 px-5 py-3 text-xs text-rose sm:px-7">
              <span>{t(errorKey(error))}</span>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={retry}>{t("retry")}</Button>
            </div>
          ) : null}
          <Student360PhaseRail snapshot={snapshot} locale={locale} />

          {snapshot.identity.profileRemark ? (
            <section className="border-y border-line bg-moon/10 px-5 py-4 sm:px-7" aria-labelledby="student-360-profile-remark">
              <p id="student-360-profile-remark" className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{t("profileRemark")}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{snapshot.identity.profileRemark}</p>
            </section>
          ) : null}

          <section className="px-5 py-5 sm:px-7" aria-labelledby="student-360-history">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
              <div>
                <h2 id="student-360-history" className="font-display text-base text-ink">{t("historyTitle")}</h2>
                <p className="mt-0.5 text-xs text-muted">{t("historyCount", { count: snapshot.events.length })}</p>
              </div>
              <div className="flex flex-wrap gap-1" aria-label={t("filterLabel")}>
                {(["all", "business", "teaching", "notes"] as const).map((item) => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant={filter === item ? "secondary" : "ghost"}
                    className="h-8 px-2.5 text-xs"
                    aria-pressed={filter === item}
                    onClick={() => setFilter(item)}
                  >
                    {t(`filter_${item}`)}
                  </Button>
                ))}
              </div>
            </div>

            {snapshot.truncated ? <p className="border-b border-line py-3 text-xs text-rose">{t("truncated")}</p> : null}
            {groups.length ? (
              <div className="mt-2" data-student-360-timeline>
                {groups.map((group) => (
                  <section key={group.key} className="grid gap-3 py-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
                    <h3 className="text-xs font-medium text-muted sm:sticky sm:top-32 sm:self-start">{group.label}</h3>
                    <ol className="relative before:absolute before:bottom-3 before:left-[0.4375rem] before:top-3 before:w-px before:bg-line">
                      {group.events.map((event) => (
                        <Student360TimelineEvent key={event.id} event={event} day={day} dateTime={dateTime} />
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            ) : (
              <div className="py-16 text-center text-sm text-muted">{t(filter === "all" ? "empty" : "filteredEmpty")}</div>
            )}
          </section>

          <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-paper/95 px-5 py-3 backdrop-blur sm:px-7">
            <p className="text-xs text-muted">{t(snapshot.identity.accessScope === "full" ? "fullScopeHint" : "journeyScopeHint")}</p>
            {snapshot.identity.studentId && snapshot.identity.accessScope === "full" ? (
              <Link href={`/dashboard/students/${snapshot.identity.studentId}`} className={buttonVariants({ size: "sm", variant: "secondary" })} onClick={close}>
                {t("openFullProfile")}<ArrowUpRight className="size-3.5" />
              </Link>
            ) : null}
          </footer>
        </div>
      ) : null}
    </>
  );
}

function Student360PhaseRail({ snapshot, locale }: { snapshot: Student360Snapshot; locale: string }) {
  const t = useTranslations("school.student360");
  const shortDate = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const currentIndex = STUDENT_360_PHASES.indexOf(snapshot.currentPhase);
  return (
    <section className="overflow-x-auto px-5 py-5 sm:px-7" aria-label={t("phaseRailLabel")}>
      <ol className="grid min-w-[46rem] grid-cols-7">
        {snapshot.phases.map((summary, index) => {
          const Icon = PHASE_ICONS[summary.phase];
          const reached = summary.count > 0;
          const current = summary.phase === snapshot.currentPhase;
          return (
            <li key={summary.phase} className="relative pr-2 text-left" aria-current={current ? "step" : undefined}>
              {index < snapshot.phases.length - 1 ? (
                <span className={cn("absolute left-6 right-0 top-4 h-px", index < currentIndex ? "bg-leaf-deep/50" : "bg-line")} />
              ) : null}
              <span className={cn(
                "relative z-10 flex size-8 items-center justify-center rounded-full border bg-paper",
                current ? "border-leaf-deep bg-leaf/30 text-leaf-deep" : reached ? "border-crater/50 text-ink" : "border-line text-muted",
              )}>
                <Icon className="size-3.5" />
              </span>
              <p className={cn("mt-2 text-xs font-medium", current ? "text-leaf-deep" : "text-ink")}>{t(`phase_${summary.phase}`)}</p>
              <p className="mt-0.5 text-[10px] text-muted">
                {summary.count
                  ? t("phaseSummary", { count: summary.count, date: shortDate.format(new Date(summary.latestAt!)) })
                  : t("phasePending")}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Student360TimelineEvent({
  event,
  day,
  dateTime,
}: {
  event: Student360Event;
  day: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
}) {
  const t = useTranslations("school.student360");
  const statusKey = event.status ? STATUS_KEYS[event.status] : null;
  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] pb-5 last:pb-0">
      <span className={cn(
        "relative z-10 mt-1 block rounded-full border-2 border-paper",
        event.important ? "size-4 bg-leaf-deep" : "ml-1 size-2.5 bg-crater/60",
      )} />
      <article className="min-w-0 border-b border-line/80 pb-5 last:border-b-0 last:pb-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <time className="text-[11px] tabular-nums text-muted" dateTime={event.occurredAt}>{day.format(new Date(event.occurredAt))}</time>
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">{t(`phase_${event.phase}`)}</span>
          <span className="text-xs font-medium text-ink">{t(`event_${event.kind}`)}</span>
          {statusKey ? <Badge
            variant="outline"
            className={cn(
              "h-5 px-1.5 text-[10px]",
              event.status && POSITIVE_STATUSES.has(event.status) && "border-leaf-deep/30 bg-leaf/20 text-leaf-deep",
              event.status && RISK_STATUSES.has(event.status) && "border-rose/30 bg-rose/5 text-rose",
            )}
          >{t(statusKey)}</Badge> : null}
        </div>
        {event.title ? <p className="mt-1 text-sm font-medium leading-5 text-ink">{event.title}</p> : null}
        {event.facts.length ? (
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {event.facts.map((item, index) => (
              <div key={`${item.label}:${index}`} className="flex min-w-0 gap-1">
                <dt className="shrink-0 text-muted">{t(`fact_${item.label}`)}</dt>
                <dd className="min-w-0 break-words text-ink">{formatFactValue(item, t, dateTime)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {event.notes.length ? (
          <div className="mt-3 space-y-2 border-l-2 border-crater/35 pl-3">
            {event.notes.map((item, index) => (
              <div key={`${item.label}:${index}`}>
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">{t(`note_${item.label}`)}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-ink">{item.content}</p>
              </div>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-[10px] text-muted">
          {event.actorName ? t("recordedBy", { name: event.actorName }) : t("systemRecord")}
        </p>
      </article>
    </li>
  );
}

function formatFactValue(
  factItem: Student360Fact,
  t: ReturnType<typeof useTranslations<"school.student360">>,
  dateTime: Intl.DateTimeFormat,
): string {
  if (factItem.format === "datetime") return dateTime.format(new Date(factItem.value));
  if (factItem.format === "boolean") return t(factItem.value === "true" ? "yes" : "no");
  if (factItem.format === "code") {
    const key = CODE_KEYS[factItem.label]?.[factItem.value];
    return key ? t(key) : factItem.value;
  }
  return factItem.value;
}

function Student360Loading() {
  const t = useTranslations("school.student360");
  return (
    <div className="px-5 py-6 sm:px-7" aria-busy="true" aria-label={t("loading")}>
      <div className="flex items-center gap-2 text-xs text-muted"><LoaderCircle className="size-3.5 animate-spin" /><Skeleton className="h-4 w-36" /></div>
      <div className="mt-7 grid min-w-0 grid-cols-4 gap-4 sm:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-16" />)}
      </div>
      <div className="mt-8 space-y-6">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="grid grid-cols-[1.5rem_1fr] gap-3"><Skeleton className="size-3 rounded-full" /><div className="space-y-2"><Skeleton className="h-4 w-44" /><Skeleton className="h-16 w-full" /></div></div>)}
      </div>
    </div>
  );
}
