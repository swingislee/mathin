"use client";

import { ArrowRight, ChevronDown, ChevronRight, LoaderCircle, Plus, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
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
import { BusinessRecordRevisionButton } from './BusinessRecordRevisionButton';
import { inputClass } from "./controls";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import type { PublicClassRegistrationData } from "./public-class-registration-contract";
import { getStudentBusinessHistoryMessages } from "./student-business-history-messages";
import { BusinessRecordStateFilter, HistoricalRecordBadge, useBusinessSearchQuery } from './BusinessRecordStateFilter';
import { businessRecordMessages, isCurrentBusinessRecord, matchesBusinessRecordState, type BusinessRecordStateFilter as StateFilter } from './business-record-state-contract';
import { FilterSearchInput } from './FilterBar';
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

function activityCounts(activity: ActivityRow) {
  const booked = activity.registrations.filter((registration) => registration.status !== "cancelled").length;
  const attended = activity.registrations.filter((registration) => registration.status === "attended").length;
  const assessed = activity.registrations.filter((registration) => registration.assessment).length;
  const awaitingRoute = activity.recordState==='historical'?0:activity.registrations.filter((registration) =>
    registration.status === "attended" && registration.assessment !== null && registration.route === null
  ).length;
  return { booked, attended, assessed, awaitingRoute };
}

export function ActivitiesManager({
  title,
  activities,
  canManage,
  initialActivityId,
  teachingActivityIds,
  initialRegistrationData,
  initialQuery,
  initialRecordState='current',
}: {
  title: string;
  activities: ActivityRow[];
  canManage: boolean;
  initialActivityId?: string;
  teachingActivityIds: string[];
  initialRegistrationData?: PublicClassRegistrationData;
  initialQuery?: string;
  initialRecordState?: StateFilter;
}) {
  const t = useTranslations("school.activities");
  const tableT = useTranslations("school.table");
  const gradeT = useTranslations("school.activityGrades");
  const assessmentT = useTranslations("school.teacherAssessment");
  const locale = useLocale();
  const recordM=businessRecordMessages(locale);
  const [query,setQuery]=useBusinessSearchQuery('activities',initialQuery);
  const [recordState,setRecordState]=useState(initialRecordState);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ActivityRow | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<ActivityRow | null>(null);
  const [gradeTarget, setGradeTarget] = useState<ActivityRow | null>(null);
  const [activeActivityId, setActiveActivityId] = useState<string | null>(initialActivityId ?? null);
  const toggleActivity = (activityId: string) => setActiveActivityId((current) => current === activityId ? null : activityId);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  const tableColumns = useMemo<Record<ActivityTableColumn, DashboardTableColumnDefinition<ActivityRow>>>(() => ({
    time: {
      filterValues: (activity) => {
        const scheduledDate = new Date(activity.scheduledAt);
        const value = activity.recordState !== 'historical' && Number.isFinite(scheduledDate.getTime())
          ? dateFormatter.format(scheduledDate)
          : activity.occurredOn || null;
        return { value: value ?? EMPTY_VALUE, label: value ?? recordM.unknown };
      },
      sortValue: (activity) => activity.scheduledAt || activity.occurredOn || '',
    },
    activity: {
      filterValues: (activity) => [
        { value: `title:${activity.id}`, label: activity.title, group: tableT("fieldTitle") },
        { value: `kind:${activity.kind}`, label: t(`kind_${activity.kind}`), group: tableT("fieldType") },
        ...(activity.tags ?? []).map(tag => ({ value: `tag:${tag}`, label: tag, group: t("tags") })),
        {
          value: activity.location ? `location:${activity.location}` : `location:${EMPTY_VALUE}`,
          label: activity.location || tableT("emptyValue"),
          group: tableT("fieldLocation"),
        },
      ],
      sortValue: (activity) => activity.title,
    },
    participation: {
      filterValues: (activity) => {
        const { booked, attended } = activityCounts(activity);
        return [
          { value: `booked:${booked}`, label: String(booked), group: tableT("fieldBooked") },
          { value: `attended:${attended}`, label: String(attended), group: tableT("fieldAttended") },
        ];
      },
      sortValue: (activity) => {
        const { booked, attended } = activityCounts(activity);
        return booked * 10_000 + attended;
      },
    },
    assessment: {
      filterValues: (activity) => {
        const value = activityCounts(activity).assessed;
        return { value: String(value), label: String(value) };
      },
      sortValue: (activity) => activityCounts(activity).assessed,
    },
    awaitingRoute: {
      filterValues: (activity) => {
        const value = activityCounts(activity).awaitingRoute;
        return { value: String(value), label: String(value) };
      },
      sortValue: (activity) => activityCounts(activity).awaitingRoute,
    },
  }), [dateFormatter, t, tableT,recordM.unknown]);
  const visibleActivities=activities.filter(activity=>matchesBusinessRecordState(activity.recordState,recordState)&&[activity.title,activity.remark,...(activity.tags ?? []),...activity.registrations.flatMap(row=>[row.studentName,row.reportedResult??''])].join(' ').toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)));
  const activityTable = useDashboardTableView({ rows: visibleActivities, columns: tableColumns, locale });
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
  const registrations = activities.filter(activity=>activity.recordState!=='historical').flatMap((activity) => activity.registrations);
  const funnel = {
    booked: registrations.filter((registration) => registration.status !== "cancelled").length,
    attended: registrations.filter((registration) => registration.status === "attended").length,
    assessed: registrations.filter((registration) => registration.assessment !== null).length,
    awaitingRoute: registrations.filter((registration) =>
      registration.status === "attended" && registration.assessment !== null && registration.route === null
    ).length,
  };

  return <DashboardPage
    title={title}
    description={t("intro")}
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandFilters><BusinessRecordStateFilter value={recordState} onChange={setRecordState} locale={locale}/><FilterSearchInput value={query} onChange={event=>setQuery(event.target.value)} placeholder={recordM.search} aria-label={recordM.search}/></DashboardCommandFilters>
      <DashboardCommandActions>
        {canManage && <Button size="sm" onClick={() => setEditing("new")} className="gap-1"><Plus size={15} />{t("new")}</Button>}
      </DashboardCommandActions>
    </DashboardCommandPanel>}
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
              <TableHead><DashboardTableColumnHeader label={`${t("awaitingRoute")} / ${getStudentBusinessHistoryMessages(locale).result}`} {...activityTable.columnProps("awaitingRoute")} /></TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activityTable.visibleRows.map((activity) => {
              const current = isCurrentBusinessRecord(activity.recordState);
              const { booked, attended, assessed, awaitingRoute } = activityCounts(activity);
              const expanded = activeActivityId === activity.id;
              const publicClass = activity.kind === "public_class";
              const canRegister = current && publicClass;
              const registrationFacts = activity.registrations.filter(row => row.registeredOn || row.reportedResult || row.assessment?.assessmentBand && row.assessment.score === null);
              return <Fragment key={activity.id}><TableRow data-record-state={activity.recordState ?? 'current'} data-activity-row={activity.id} aria-expanded={canRegister ? expanded : undefined} className={canRegister ? `cursor-pointer ${expanded ? "bg-moon/10 hover:bg-moon/10" : ""}` : undefined} onClick={canRegister ? () => toggleActivity(activity.id) : undefined}>
                <TableCell mobileLabel={t("time")} className="whitespace-nowrap text-sm">
                  {businessDisplayDate(activity.scheduledAt,activity.occurredOn,locale)}
                </TableCell>
                <TableCell mobileSpan="primary">
                  {canRegister ? <Button size="sm" variant="ghost" className="h-auto justify-start gap-1 p-0 text-left text-ink" onClick={(event) => { event.stopPropagation(); toggleActivity(activity.id); }}>{expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{activity.title}</Button> : current ? <Link href={`/dashboard/activities/${activity.id}`} className="font-medium text-ink hover:underline">
                    {activity.title}
                  </Link> : <span className="font-medium text-ink">{activity.title}</span>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge variant="outline">{t(`kind_${activity.kind}`)}</Badge>
                    {(activity.tags ?? []).map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                    {!current ? <HistoricalRecordBadge locale={locale} /> : null}
                    <span>{activity.location || "—"}</span>
                    <span>{activity.targetGrades == null ? gradeT("unknown") : activity.targetGrades.length
                      ? activity.targetGrades.map((grade) => gradeT("grade", { grade })).join("、") : gradeT("all")}</span>
                  </div>
                </TableCell>
                <TableCell mobileLabel={t("participation")} className="tabular-nums">{t("participationCounts", { booked, attended })}{registrationFacts.map(row => <div key={row.id} className="mt-1 text-xs"><p>{row.studentName}</p>{row.registeredOn ? <p className="text-muted">{recordM.registeredOn} {row.registeredOn}</p> : null}</div>)}</TableCell>
                <TableCell mobileLabel={t("assessment")} className="tabular-nums">{assessed}{registrationFacts.map(row => row.assessment?.assessmentBand ? <p key={row.id} className="mt-1 text-xs">{assessmentT(`band_${row.assessment.assessmentBand}`)}</p> : null)}</TableCell>
                <TableCell mobileLabel={`${t("awaitingRoute")} / ${getStudentBusinessHistoryMessages(locale).result}`} className="tabular-nums">{current ? awaitingRoute : '—'}{registrationFacts.map(row => row.reportedResult ? <div key={row.id} className="mt-1 text-xs"><p>{row.reportedResult}</p>{row.resultLinkStatus === 'edition_unconfirmed' ? <p className="text-muted">{getStudentBusinessHistoryMessages(locale).reportedResult} · {getStudentBusinessHistoryMessages(locale).editionPending}</p> : null}</div> : null)}</TableCell>
                <TableCell mobileLabel={t("actions")} data-table-mobile-actions>
                  <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                    {current && canManage ? <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(activity)}>{t("edit")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setGradeTarget(activity)}>{gradeT("title")}</Button>
                      <Link href={`/dashboard/activities/${activity.id}/registration`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{locale === "en" ? "Public listing / pre-registration" : "对外展示 / 预报名"}</Link>
                      <Button size="sm" variant="ghost" className="text-rose" aria-label={t("delete")} disabled={pending} onClick={() => setDeleteTarget(activity)}><Trash2 size={15} /></Button>
                    </> : null}
                    {canRegister ? <Button size="sm" variant="secondary" onClick={() => toggleActivity(activity.id)}>{t("inlineRegistration")}</Button> : null}
                    {current && canRegister && !canManage ? <Link href={`/dashboard/activities/${activity.id}/registration`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{locale === "en" ? "Pre-registrations" : "预报名"}</Link> : null}
                    {!current ? activity.registrations.map(row => <BusinessRecordRevisionButton key={row.id} kind="activity" recordId={row.id} subject={row.studentName} label={activity.registrations.length > 1 ? `${row.studentName} · ${locale==='zh'?'修订':'Revise'}` : undefined}/>) : null}
                    {current && (!publicClass || teachingActivityIds.includes(activity.id)) ? <Link href={`/dashboard/activities/${activity.id}${publicClass ? "?view=teaching" : ""}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                      {t(publicClass ? "teacherWorkspace" : "openWorkspace")}<ArrowRight size={15} />
                    </Link> : !current ? activity.registrations.map(row => row.studentId ? <Link key={row.id} href={`/dashboard/students/${row.studentId}?tab=history`} className={buttonVariants({ size: "sm", variant: "secondary" })}>{recordM.viewStudent}<ArrowRight size={15} /></Link> : null) : null}
                  </div>
                </TableCell>
              </TableRow>{canRegister ? <FollowupInlineDetails open={expanded} onOpenChange={open => setActiveActivityId(open ? activity.id : null)} colSpan={6} flush title={activity.title} closeLabel={t("closeRegistration")}>
                <PublicClassRegistrationPanel activityId={activity.id} initialData={initialRegistrationData?.activity.id === activity.id ? initialRegistrationData : undefined} />
              </FollowupInlineDetails> : null}</Fragment>;
            })}
            {activityTable.visibleRows.length === 0 ? <TableRow><TableCell colSpan={6} className="h-40 text-center text-muted">{activities.length === 0 ? t("empty") : tableT("filteredEmpty")}</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </DashboardSection>
    {editing && <ActivityDialog
      initial={editing === "new" ? null : editing}
      availableTags={[...new Set(activities.filter(activity => isCurrentBusinessRecord(activity.recordState)).flatMap(activity => activity.tags ?? []))]}
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
            {availableTags.filter(tag => !tags.includes(tag)).map(tag => <Button key={tag} type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" disabled={tags.length >= 10} onClick={() => setTagsText([...tags, tag].join("，"))}>{tag}</Button>)}
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
