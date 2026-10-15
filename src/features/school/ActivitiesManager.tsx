"use client";

import { ChevronDown, ChevronRight, LoaderCircle, MoreHorizontal, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import type { ActionResult } from "@/lib/action-result";
import {
  createActivityAction,
  deleteActivityAction,
  updateActivityAction,
  setActivityTargetGradesAction,
  type ActivityInput,
} from "./activity-actions";
import { ACTIVITY_KINDS } from "./activity-kinds";
import type { ActivityRow } from "./activities";
import { ActivityGradesDialog } from "./ActivityGradesDialog";
import { businessDisplayDate } from './business-source-contract';
import { businessRecordMessages } from './business-record-messages';
import { useBusinessSearchQuery } from './business-search-query';
import { inputClass } from "./controls";
import { DashboardIntentLink } from "./dashboard-page/DashboardIntentLink";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import type { PublicClassRegistrationData } from "./public-class-registration-contract";
import { getStudentBusinessHistoryMessages } from "./student-business-history-messages";
import { FilterSearchInput } from './FilterBar';
import { LeadPoolPagination } from "./LeadPoolPagination";
import { useFollowupPagination } from "./useFollowupPagination";
const PublicClassRegistrationPanel = dynamic(() => import("./PublicClassRegistrationPanel"));
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardPage,
  DashboardSection,
  DashboardTableColumnHeader,
  DashboardTableShell,
  StatusStrip,
  type DashboardTableColumnDefinition,
  useDashboardTableView,
} from "./dashboard-page";

const empty: ActivityInput = {
  kind: "trial_class",
  title: "",
  scheduledAt: "",
  durationMin: 60,
  location: "",
  capacity: null,
  remark: "",
  tags: [],
};

type RunAction = (
  action: () => Promise<ActionResult>,
  successMessage: string,
  onSuccess?: () => void,
) => void;

type ActivityTableColumn = "time" | "activity" | "participation" | "assessment" | "awaitingRoute";
const EMPTY_VALUE = "$empty";

/**
 * 列表的一行是一场活动。来源表导入时每条到访登记各建了一条活动，这里按“类型＋名称＋日期＋地点”合并为同一场，
 * 展开后逐人查看；系统内创建的活动仍各占一行。
 */
interface ActivitySession {
  key: string;
  day: string;
  primary: ActivityRow;
  activities: ActivityRow[];
  imported: boolean;
}

function activityDay(activity: ActivityRow) {
  if (activity.occurredOn) return activity.occurredOn;
  const at = new Date(activity.scheduledAt);
  return Number.isFinite(at.getTime()) ? at.toLocaleDateString("en-CA") : "";
}

function activitySessions(activities: readonly ActivityRow[]): ActivitySession[] {
  const sessions = new Map<string, ActivitySession>();
  for (const activity of activities) {
    const day = activityDay(activity);
    const imported = Boolean(activity.sourceRecordId);
    const key = imported ? JSON.stringify([activity.kind, activity.title, day, activity.location]) : activity.id;
    const session = sessions.get(key);
    if (session) session.activities.push(activity);
    else sessions.set(key, { key, day, primary: activity, activities: [activity], imported });
  }
  // 近的在前；没有日期的排在最后。
  return [...sessions.values()].sort((a, b) => (b.day || "").localeCompare(a.day || "") || a.primary.title.localeCompare(b.primary.title, "zh"));
}

function sessionCounts(session: ActivitySession) {
  const registrations = session.activities.flatMap(activity => activity.registrations);
  return {
    booked: registrations.filter((registration) => registration.status !== "cancelled").length,
    attended: registrations.filter((registration) => registration.status === "attended").length,
    assessed: registrations.filter((registration) => registration.assessment).length,
    awaitingRoute: registrations.filter((registration) =>
      registration.status === "attended" && registration.assessment !== null && registration.route === null
    ).length,
  };
}

function monthOf(day: string, locale: string) {
  const match = day.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return { value: `${match[1]}-${match[2]}`, label: locale.startsWith("en") ? `${match[1]}-${match[2]}` : `${match[1]}年${Number(match[2])}月` };
}

export function ActivitiesManager({
  title,
  activities,
  canManage,
  initialActivityId,
  teachingActivityIds,
  initialRegistrationData,
  initialQuery,
}: {
  title: string;
  activities: ActivityRow[];
  canManage: boolean;
  initialActivityId?: string;
  teachingActivityIds: string[];
  initialRegistrationData?: PublicClassRegistrationData;
  initialQuery?: string;
}) {
  const t = useTranslations("school.activities");
  const tableT = useTranslations("school.table");
  const gradeT = useTranslations("school.activityGrades");
  const stageT = useTranslations("school.assessmentAvailability");
  const assessmentT = useTranslations("school.teacherAssessment");
  const locale = useLocale();
  const en = locale.startsWith("en");
  const recordM = businessRecordMessages(locale);
  const historyM = getStudentBusinessHistoryMessages(locale);
  const [query,setQuery]=useBusinessSearchQuery('activities',initialQuery);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ActivityRow | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<ActivityRow | null>(null);
  const [gradeTarget, setGradeTarget] = useState<ActivityRow | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(initialActivityId ?? null);
  const toggle = (key: string) => setExpandedKey((current) => current === key ? null : key);
  const sessions = useMemo(() => activitySessions(activities), [activities]);
  const tableColumns = useMemo<Record<ActivityTableColumn, DashboardTableColumnDefinition<ActivitySession>>>(() => ({
    time: {
      filterValues: (session) => {
        const month = monthOf(session.day, locale);
        return month ?? { value: EMPTY_VALUE, label: recordM.dateUnknown };
      },
      sortValue: (session) => session.day,
    },
    activity: {
      filterValues: (session) => [
        { value: `title:${session.primary.title}`, label: session.primary.title, group: tableT("fieldTitle") },
        { value: `kind:${session.primary.kind}`, label: t(`kind_${session.primary.kind}`), group: tableT("fieldType") },
        ...(session.primary.tags ?? []).map(tag => ({ value: `tag:${tag}`, label: tag, group: t("tags") })),
        {
          value: session.primary.location ? `location:${session.primary.location}` : `location:${EMPTY_VALUE}`,
          label: session.primary.location || tableT("emptyValue"),
          group: tableT("fieldLocation"),
        },
      ],
      sortValue: (session) => session.primary.title,
    },
    participation: {
      filterValues: (session) => {
        const { booked, attended } = sessionCounts(session);
        return [
          { value: `booked:${booked}`, label: String(booked), group: tableT("fieldBooked") },
          { value: `attended:${attended}`, label: String(attended), group: tableT("fieldAttended") },
        ];
      },
      sortValue: (session) => {
        const { booked, attended } = sessionCounts(session);
        return booked * 10_000 + attended;
      },
    },
    assessment: {
      filterValues: (session) => {
        const value = sessionCounts(session).assessed;
        return { value: String(value), label: String(value) };
      },
      sortValue: (session) => sessionCounts(session).assessed,
    },
    awaitingRoute: {
      filterValues: (session) => {
        const value = sessionCounts(session).awaitingRoute;
        return { value: String(value), label: String(value) };
      },
      sortValue: (session) => sessionCounts(session).awaitingRoute,
    },
  }), [t, tableT, locale, recordM.dateUnknown]);
  const needle = query.trim().toLocaleLowerCase(locale);
  const searched = useMemo(() => needle ? sessions.filter(session => session.activities.some(activity =>
    [activity.title, activity.remark, ...(activity.tags ?? []), ...activity.registrations.flatMap(row => [row.studentName, row.reportedResult ?? ''])]
      .join(' ').toLocaleLowerCase(locale).includes(needle))) : sessions, [sessions, needle, locale]);
  const activityTable = useDashboardTableView({ rows: searched, columns: tableColumns, locale });
  const pagination = useFollowupPagination(activityTable.visibleRows, JSON.stringify([needle, activityTable.filters, activityTable.sort]));
  const run: RunAction = (action, successMessage, onSuccess) => startTransition(async () => {
    const result = await action();
    if (result.ok) {
      toast.success(successMessage);
      onSuccess?.();
      router.refresh();
    } else {
      toast.error(result.code === "ACTIVITY_FULL" ? t("full") : t("actionFailed"));
    }
  });
  // 汇总跟随当前筛选：选了哪些月份，就统计哪些月份。
  const funnel = activityTable.visibleRows.reduce((total, session) => {
    const counts = sessionCounts(session);
    return { booked: total.booked + counts.booked, attended: total.attended + counts.attended, assessed: total.assessed + counts.assessed, awaitingRoute: total.awaitingRoute + counts.awaitingRoute };
  }, { booked: 0, attended: 0, assessed: 0, awaitingRoute: 0 });
  const gradesLabel = (activity: ActivityRow) => activity.targetGrades == null ? gradeT("unknown") : activity.targetGrades.length
    ? activity.targetGrades.map((grade) => grade > 0 ? gradeT("grade", { grade }) : stageT(grade === 0 ? "kindergartenSenior" : "kindergartenMiddle")).join("、") : gradeT("all");
  const resultHeader = `${t("awaitingRoute")} / ${historyM.result}`;

  return <DashboardPage
    title={title}
    description={t("intro")}
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandFilters><FilterSearchInput value={query} onChange={event=>setQuery(event.target.value)} placeholder={recordM.search} aria-label={recordM.search}/></DashboardCommandFilters>
      <DashboardCommandActions>
        {canManage && <Button size="sm" onClick={() => setEditing("new")} className="gap-1"><Plus size={15} />{t("new")}</Button>}
      </DashboardCommandActions>
    </DashboardCommandPanel>}
    footer={<LeadPoolPagination baseHref="/dashboard/activities" currentPage={pagination.page} totalPages={pagination.totalPages} totalCount={pagination.count}
      pageSize={pagination.pageSize} onPageChange={(page, size) => { setExpandedKey(null); pagination.onPageChange(page, size); }} />}
  >
    <DashboardSection title={t("workspaceListTitle")} description={t("workspaceListHint")}>
      <StatusStrip
        className="mb-3"
        items={[
          { label: t("funnelBooked"), value: funnel.booked },
          { label: t("funnelAttended"), value: funnel.attended },
          { label: t("funnelAssessed"), value: funnel.assessed },
          { label: t("awaitingRoute"), value: funnel.awaitingRoute },
        ]}
      />
      <DashboardTableShell>
        <Table mobileLayout="stacked" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
          <TableHeader className="sticky top-0 z-30 bg-card">
            <TableRow>
              <TableHead><DashboardTableColumnHeader label={t("time")} {...activityTable.columnProps("time")} /></TableHead>
              <TableHead><DashboardTableColumnHeader label={t("activity")} {...activityTable.columnProps("activity")} /></TableHead>
              <TableHead><DashboardTableColumnHeader label={t("participation")} {...activityTable.columnProps("participation")} /></TableHead>
              <TableHead><DashboardTableColumnHeader label={t("assessment")} {...activityTable.columnProps("assessment")} /></TableHead>
              <TableHead><DashboardTableColumnHeader label={resultHeader} {...activityTable.columnProps("awaitingRoute")} /></TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.rows.map((session) => {
              const activity = session.primary;
              const { booked, attended, assessed, awaitingRoute } = sessionCounts(session);
              const publicClass = activity.kind === "public_class";
              const expandable = publicClass || session.imported;
              const expanded = expandedKey === session.key || (!session.imported && expandedKey === activity.id);
              const workspaceHref = `/dashboard/activities/${activity.id}${publicClass ? "?view=teaching" : ""}`;
              const facts = [activity.location || "—", gradesLabel(activity), ...(session.imported && session.activities.length > 1 ? [en ? `${session.activities.length} registrations` : `${session.activities.length} 条登记`] : [])].join(" · ");
              return <Fragment key={session.key}><TableRow data-activity-row={activity.id} data-activity-imported={session.imported || undefined} aria-expanded={expandable ? expanded : undefined}
                className={expandable ? `cursor-pointer ${expanded ? "bg-moon/10 hover:bg-moon/10" : ""}` : undefined} onClick={expandable ? () => toggle(session.key) : undefined}>
                <TableCell mobileLabel={t("time")} className="whitespace-nowrap text-sm">{session.imported ? session.day || recordM.dateUnknown : businessDisplayDate(activity.scheduledAt,activity.occurredOn,locale)}</TableCell>
                <TableCell mobileSpan="primary">
                  {expandable ? <button type="button" className="flex items-center gap-1 text-left font-medium text-ink" onClick={(event) => { event.stopPropagation(); toggle(session.key); }}>
                    {expanded ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}{activity.title}</button>
                    : <DashboardIntentLink href={`/dashboard/activities/${activity.id}`} className="font-medium text-ink hover:underline">{activity.title}</DashboardIntentLink>}
                  <p className="mt-1 text-xs text-muted">
                    <Badge variant="outline" className="mr-1.5">{t(`kind_${activity.kind}`)}</Badge>
                    {(activity.tags ?? []).length ? <span className="mr-1.5">{(activity.tags ?? []).join("、")} ·</span> : null}{facts}
                  </p>
                </TableCell>
                <TableCell mobileLabel={t("participation")} className="tabular-nums">{t("participationCounts", { booked, attended })}</TableCell>
                <TableCell mobileLabel={t("assessment")} className="tabular-nums">{assessed}</TableCell>
                <TableCell mobileLabel={resultHeader} className="tabular-nums">{awaitingRoute}</TableCell>
                <TableCell mobileLabel={t("actions")} data-table-mobile-actions>
                  {!session.imported ? <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                    {publicClass ? <Button size="sm" variant="secondary" onClick={() => toggle(session.key)}>{t("inlineRegistration")}</Button> : null}
                    {!publicClass || teachingActivityIds.includes(activity.id) ? <DashboardIntentLink href={workspaceHref} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                      {t(publicClass ? "teacherWorkspace" : "openWorkspace")}</DashboardIntentLink> : null}
                    {canManage || publicClass ? <Popover open={menuFor === activity.id} onOpenChange={open => setMenuFor(open ? activity.id : null)}>
                      <PopoverTrigger asChild><Button size="sm" variant="ghost" className="size-8 p-0" aria-label={en ? "More actions" : "更多操作"}><MoreHorizontal className="size-4" aria-hidden /></Button></PopoverTrigger>
                      <PopoverContent align="end" className="flex w-48 flex-col gap-0.5 p-1">
                        {canManage ? <>
                          <Button size="sm" variant="ghost" className="justify-start" onClick={() => { setMenuFor(null); setEditing(activity); }}>{t("edit")}</Button>
                          <Button size="sm" variant="ghost" className="justify-start" onClick={() => { setMenuFor(null); setGradeTarget(activity); }}>{gradeT("title")}</Button>
                        </> : null}
                        <DashboardIntentLink href={`/dashboard/activities/${activity.id}/registration`} className={`${buttonVariants({ variant: "ghost", size: "sm" })} justify-start`}>
                          {canManage ? en ? "Public listing / pre-registration" : "对外展示 / 预报名" : en ? "Pre-registrations" : "预报名"}</DashboardIntentLink>
                        {canManage ? <Button size="sm" variant="ghost" className="justify-start text-rose" disabled={pending} onClick={() => { setMenuFor(null); setDeleteTarget(activity); }}>{t("delete")}</Button> : null}
                      </PopoverContent>
                    </Popover> : null}
                  </div> : null}
                </TableCell>
              </TableRow>{publicClass && expanded ? <FollowupInlineDetails open onOpenChange={open => setExpandedKey(open ? session.key : null)} colSpan={6} flush title={activity.title} closeLabel={t("closeRegistration")}>
                <PublicClassRegistrationPanel activityId={activity.id} initialData={initialRegistrationData?.activity.id === activity.id ? initialRegistrationData : undefined} />
              </FollowupInlineDetails> : null}
              {session.imported && expanded ? <FollowupInlineDetails open onOpenChange={open => setExpandedKey(open ? session.key : null)} colSpan={6} flush title={activity.title} closeLabel={en ? "Collapse" : "收起"}>
                <SessionRegistrations session={session} locale={locale} statusLabel={status => t(`status_${status}`)} bandLabel={band => assessmentT(`band_${band}`)} />
              </FollowupInlineDetails> : null}</Fragment>;
            })}
            {pagination.rows.length === 0 ? <TableRow><TableCell colSpan={6} className="h-40 text-center text-muted">{activities.length === 0 ? t("empty") : tableT("filteredEmpty")}</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </DashboardSection>
    {editing && <ActivityDialog
      initial={editing === "new" ? null : editing}
      availableTags={[...new Set(activities.flatMap(activity => activity.tags ?? []))]}
      pending={pending}
      close={() => setEditing(null)}
      save={(input) => run(
        () => editing === "new" ? createActivityAction(input) : updateActivityAction(editing.id, input),
        editing === "new" ? t("activityCreated") : t("activitySaved"),
        () => setEditing(null),
      )}
    />}
    {gradeTarget ? <ActivityGradesDialog activity={gradeTarget} pending={pending} onClose={() => setGradeTarget(null)}
      onSave={(grades) => run(() => setActivityTargetGradesAction(gradeTarget.id, grades), gradeT("saved"), () => setGradeTarget(null))} /> : null}
    <ConfirmDialog
      open={deleteTarget !== null}
      onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      title={t("delete")}
      description={t("deleteConfirm")}
      confirmLabel={t("delete")}
      cancelLabel={t("cancel")}
      pending={pending}
      onConfirm={() => {
        const target = deleteTarget;
        setDeleteTarget(null);
        if (target) run(() => deleteActivityAction(target.id), t("activityDeleted"));
      }}
    />
  </DashboardPage>;
}

/** 合并后的一场活动：逐人列出到访、测评与结果，点姓名进入该学生的经历。 */
function SessionRegistrations({ session, locale, statusLabel, bandLabel }: {
  session: ActivitySession; locale: string; statusLabel: (status: string) => string; bandLabel: (band: string) => string;
}) {
  const recordM = businessRecordMessages(locale);
  const historyM = getStudentBusinessHistoryMessages(locale);
  const rows = session.activities.flatMap(activity => activity.registrations.map(registration => ({ activity, registration })))
    .sort((a, b) => a.registration.studentName.localeCompare(b.registration.studentName, "zh"));
  return <ul className="text-xs">{rows.map(({ activity, registration }) => <li key={registration.id} className="grid grid-cols-[minmax(6rem,10rem)_5rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-3 py-2 first:border-t-0">
    {registration.studentId ? <DashboardIntentLink href={`/dashboard/students/${registration.studentId}?tab=history`} className="truncate font-medium text-ink hover:underline">{registration.studentName}</DashboardIntentLink>
      : <span className="truncate font-medium">{registration.studentName}</span>}
    <span className="text-muted">{statusLabel(registration.status)}</span>
    <span className="min-w-0 truncate" title={registration.reportedResult || undefined}>{[
      registration.registeredOn ? `${recordM.registeredOn} ${registration.registeredOn}` : "",
      registration.assessment?.assessmentBand ? bandLabel(registration.assessment.assessmentBand) : "",
      registration.assessment?.score != null ? `${registration.assessment.score}` : "",
      registration.reportedResult ?? "",
      registration.resultLinkStatus === "edition_unconfirmed" ? `${historyM.reportedResult} · ${historyM.editionPending}` : "",
      session.activities.length > 1 && activity.remark ? activity.remark : "",
    ].filter(Boolean).join(" · ") || "—"}</span>
    <DashboardIntentLink href={`/dashboard/activities/${activity.id}`} className="text-muted hover:text-ink hover:underline">{locale.startsWith("en") ? "Workspace" : "工作台"}</DashboardIntentLink>
  </li>)}</ul>;
}

function ActivityDialog({
  initial,
  availableTags,
  pending,
  close,
  save,
}: {
  initial: ActivityRow | null;
  availableTags: string[];
  pending: boolean;
  close: () => void;
  save: (input: ActivityInput) => void;
}) {
  const t = useTranslations("school.activities");
  const [form, setForm] = useState<ActivityInput>(initial ? {
    kind: initial.kind,
    title: initial.title,
    scheduledAt: initial.scheduledAt.slice(0, 16),
    durationMin: initial.durationMin,
    location: initial.location,
    capacity: initial.capacity,
    remark: initial.remark,
    tags: initial.tags ?? [],
  } : empty);
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join("，"));
  const tags = [...new Set(tagsText.split(/[,，、;；\n]/).map(tag => tag.trim()).filter(Boolean))];
  const invalidTags = tags.length > 10 || tags.some(tag => tag.length > 40);
  const set = <K extends keyof ActivityInput>(key: K, value: ActivityInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{initial ? t("edit") : t("new")}</DialogTitle></DialogHeader>
      <p className="rounded-xl border border-line bg-moon/20 px-3 py-2 text-sm text-muted">{t("creationBoundary")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="grid gap-1 text-xs font-normal text-muted">
          {t("kind")}
          <Select value={form.kind} onValueChange={(value) => set("kind", value as ActivityInput["kind"])}>
            <SelectTrigger className="h-9 rounded-md shadow-none"><SelectValue /></SelectTrigger>
            <SelectContent>{ACTIVITY_KINDS.filter((kind) => kind !== 'assessment_1v1').map((kind) => <SelectItem key={kind} value={kind}>{t(`kind_${kind}`)}</SelectItem>)}</SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("titleLabel")}<Input value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={100} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
        <p className="rounded-xl bg-paper px-3 py-2 text-xs text-muted sm:col-span-2">{t(`kindHint_${form.kind}`)}</p>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="activity-tags" className="text-xs font-normal text-muted">{t("tags")}</Label>
          <Input id="activity-tags" value={tagsText} onChange={event => setTagsText(event.target.value)} placeholder={t("tagsPlaceholder")} aria-describedby="activity-tags-hint" aria-invalid={invalidTags} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} />
          <p id="activity-tags-hint" className={`text-xs ${invalidTags ? "text-rose" : "text-muted"}`}>{invalidTags ? t("tagsLimit") : t("tagsHint")}</p>
          {availableTags.some(tag => !tags.includes(tag)) ? <div className="flex flex-wrap gap-1" aria-label={t("existingTags")}>
            {availableTags.filter(tag => !tags.includes(tag)).map(tag => <Button key={tag} type="button" variant="secondary" size="sm" className="h-6 px-2 text-xs" disabled={tags.length >= 10} onClick={() => setTagsText([...tags, tag].join("，"))}>{tag}</Button>)}
          </div> : null}
        </div>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("time")}<DateTimePicker mode="datetime" value={form.scheduledAt} onValueChange={(value) => set("scheduledAt", value)} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("duration")}<Input type="number" min={1} max={32_767} value={form.durationMin ?? ""} onChange={(event) => set("durationMin", event.target.value ? Number(event.target.value) : null)} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("location")}<Input value={form.location} onChange={(event) => set("location", event.target.value)} maxLength={100} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
        <Label className="grid gap-1 text-xs font-normal text-muted">{t("capacity")}<Input type="number" min={1} max={32_767} value={form.capacity ?? ""} onChange={(event) => set("capacity", event.target.value ? Number(event.target.value) : null)} className={`${inputClass} h-9 rounded-md py-1.5 shadow-none`} /></Label>
      </div>
      <Textarea value={form.remark} onChange={(event) => set("remark", event.target.value)} placeholder={t("remark")} maxLength={1_000} />
      <DialogFooter>
        <Button size="sm" variant="secondary" onClick={close}>{t("cancel")}</Button>
        <Button size="sm" disabled={pending || !form.title.trim() || !form.scheduledAt || invalidTags} onClick={() => save({ ...form, tags })}>
          {pending && <LoaderCircle size={15} className="animate-spin" />}{t("save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
