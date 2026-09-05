"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardTableColumnHeader, DashboardTableShell, type DashboardTableColumnDefinition, useDashboardTableView } from "./dashboard-page";
import { DashboardInlineEntry } from "./dashboard-page/DashboardInlineEntry";
import { PostActivityHandoff } from "./EnrollmentHandoffButton";
import { Student360Trigger } from "./Student360Sheet";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import type { PublicClassParticipant, PublicClassPresence, PublicClassSegment } from "./public-class";
import { savePublicClassSegmentAction } from "./public-class-actions";
import { getPublicClassRegistrationAction, savePublicClassRegistrationBundleAction } from "./public-class-registration-actions";
import { publicClassParticipantSummary, publicClassRecordDraft, type PublicClassRecordDraft, type PublicClassRegistrationData } from "./public-class-registration-contract";

const REGISTRATION_COLUMNS = ["student", "attendance", "observation", "family", "recommendation"] as const;
type RegistrationColumn = typeof REGISTRATION_COLUMNS[number];

export default function PublicClassRegistrationPanel({ activityId, initialData }: { activityId: string; initialData?: PublicClassRegistrationData }) {
  const t = useTranslations("school.publicClassRegistration");
  const tableT = useTranslations("school.table");
  const locale = useLocale();
  const [data, setData] = useState<PublicClassRegistrationData | null>(initialData ?? null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState("students");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const router = useRouter();
  const rows = useMemo(() => (data?.participants ?? []).filter((participant) => !query || [participant.name, participant.phone, participant.gradeText].join(" ").toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale))), [data, locale, query]);
  const columns = useMemo(() => Object.fromEntries(REGISTRATION_COLUMNS.map((column) => {
    const valueFor = (participant: PublicClassParticipant) => {
      if (column === "student") return participant.name;
      const summary = publicClassParticipantSummary(participant);
      if (column === "attendance") return participant.status === "cancelled" ? t("cancelled") : summary.attended ? t("attended") : t("expected");
      return summary[column];
    };
    return [column, {
      filterValues: (participant: PublicClassParticipant) => ({ value: valueFor(participant) || "$empty", label: valueFor(participant) || tableT("emptyValue") }),
      sortValue: valueFor,
    }];
  })) as Record<RegistrationColumn, DashboardTableColumnDefinition<PublicClassParticipant>>, [t, tableT]);
  const table = useDashboardTableView({ rows, columns, locale });
  useEffect(() => {
    if (initialData?.activity.id === activityId && retry === 0) return;
    let current = true;
    getPublicClassRegistrationAction(activityId).then((result) => {
      if (!current) return;
      if (result.ok) { setData(result.data); setFailed(false); }
      else setFailed(true);
    });
    return () => { current = false; };
  }, [activityId, initialData, retry]);
  const refresh = async () => {
    const result = await getPublicClassRegistrationAction(activityId);
    if (result.ok) setData(result.data);
    else toast.error(t("loadFailed"));
    router.refresh();
  };
  if (!data) return <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted" role="status">{failed ? <><span>{t("loadFailed")}</span><Button size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>{t("retry")}</Button></> : <><LoaderCircle className="size-4 animate-spin" />{t("loading")}</>}</div>;
  return <div className="space-y-3 p-3">
    <DashboardCommandPanel>
      <DashboardCommandState><Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="students">{t("students", { count: data.participants.length })}</TabsTrigger><TabsTrigger value="arrangement">{t("arrangement")}</TabsTrigger></TabsList></Tabs></DashboardCommandState>
      {tab === "students" ? <DashboardCommandFilters><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-8 max-w-64 text-xs" /></DashboardCommandFilters> : null}
    </DashboardCommandPanel>
    {tab === "students" ? <DashboardTableShell><Table className="min-w-[800px] table-fixed text-xs" containerClassName="max-h-[65dvh] overflow-auto">
      <TableHeader><TableRow>{REGISTRATION_COLUMNS.map((key, index) => <TableHead key={key} className={cn("sticky top-0 z-20 h-8 bg-card px-2", index === 0 && "left-0 z-30 w-52 border-r border-line")}><DashboardTableColumnHeader label={t(key)} {...table.columnProps(key)} /></TableHead>)}</TableRow></TableHeader>
      <TableBody>{table.visibleRows.map((participant) => <ParticipantRow key={`${participant.registrationId}:${participant.records.map((record) => record.updatedAt).join(":")}`} participant={participant} data={data} active={activeId === participant.registrationId} toggle={() => setActiveId((value) => value === participant.registrationId ? null : participant.registrationId)} saved={(value) => { setData(value); router.refresh(); }} refresh={refresh} />)}{table.visibleRows.length === 0 ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted">{t("empty")}</TableCell></TableRow> : null}</TableBody>
    </Table></DashboardTableShell> : <div className="divide-y divide-line">{data.segments.map((segment) => <SegmentFields key={segment.id} segment={segment} data={data} saved={refresh} />)}</div>}
  </div>;
}

function ParticipantRow({ participant, data, active, toggle, saved, refresh }: {
  participant: PublicClassParticipant; data: PublicClassRegistrationData; active: boolean;
  toggle: () => void; saved: (data: PublicClassRegistrationData) => void; refresh: () => Promise<void>;
}) {
  const t = useTranslations("school.publicClassRegistration");
  const publicT = useTranslations("school.publicClass");
  const [pending, startSaving] = useTransition();
  const [drafts, setDrafts] = useState(() => participant.records.map(publicClassRecordDraft));
  const original = participant.records.map(publicClassRecordDraft);
  const changed = drafts.filter((draft) => JSON.stringify(draft) !== JSON.stringify(original.find((record) => record.segmentId === draft.segmentId)));
  const summary = publicClassParticipantSummary(participant);
  const edit = (segmentId: string, patch: Partial<PublicClassRecordDraft>) => setDrafts((rows) => rows.map((row) => row.segmentId === segmentId ? { ...row, ...patch } : row));
  const save = () => startSaving(async () => {
    const result = await savePublicClassRegistrationBundleAction({ activityId: data.activity.id, registrationId: participant.registrationId, records: changed });
    if (!result.ok) { toast.error(t(result.code === "PUBLIC_CLASS_RECORD_CHANGED" ? "changed" : "saveFailed")); return; }
    toast.success(t("saved")); window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); saved(result.data);
  });
  const editable = data.canRecord && participant.status !== "cancelled";
  return <Fragment>
    <TableRow onClick={toggle} aria-expanded={active} className={cn("cursor-pointer", active && "bg-moon/10 hover:bg-moon/10")}>
      <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2"><div className="flex items-center gap-1"><Button size="sm" variant="ghost" className="size-6 shrink-0 p-0" aria-label={t("expand", { name: participant.name })} onClick={(event) => { event.stopPropagation(); toggle(); }}>{active ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button><Student360Trigger subject={{ studentId: participant.studentId, leadId: participant.leadId }} fallback={{ name: participant.name, phone: participant.phone, grade: participant.grade, gradeText: participant.gradeText }}>{participant.name}</Student360Trigger>{changed.length ? <span className="text-[10px] text-muted">{t("unsaved")}</span> : null}</div><p className="pl-7 text-[11px] text-muted">{participant.gradeText || (participant.grade ? publicT("gradeValue", { grade: participant.grade }) : "")}{participant.phone ? ` · ${participant.phone}` : ""}</p></TableCell>
      <TableCell className="px-2">{participant.status === "cancelled" ? t("cancelled") : summary.attended ? t("attended") : t("expected")}</TableCell>
      <TableCell className="truncate px-2" title={summary.observation}>{summary.observation || "—"}</TableCell>
      <TableCell className="truncate px-2" title={summary.family}>{summary.family || "—"}</TableCell>
      <TableCell className="truncate px-2" title={summary.recommendation}>{summary.recommendation || "—"}</TableCell>
    </TableRow>
    {active ? <TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="p-0"><DashboardInlineEntry flush pending={pending} onSubmit={editable && changed.length ? save : undefined} onClose={toggle} closeLabel={t("close")}>
      <div className="grid divide-line xl:grid-cols-3 xl:divide-x">{data.segments.map((segment) => {
        const draft = drafts.find((record) => record.segmentId === segment.id);
        if (!draft) return null;
        return <section key={segment.id} className="min-w-0 space-y-2 p-3"><h4 className="text-xs font-medium">{segment.title}</h4>
          <div className="grid grid-cols-2 gap-2">{(["studentPresence", "guardianPresence"] as const).map((field) => <Label key={field} className="grid gap-1 text-[11px] text-muted">{publicT(field === "studentPresence" ? "studentAttendance" : "guardianAttendance")}<Select value={draft[field]} disabled={!editable || pending} onValueChange={(value) => edit(segment.id, { [field]: value as PublicClassPresence })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{(["expected", "attended", "late", "absent", "not_applicable"] as const).map((value) => <SelectItem key={value} value={value}>{publicT(`presence_${value}`)}</SelectItem>)}</SelectContent></Select></Label>)}</div>
          {(["learningObservation", "assessmentSummary", "parentFeedback", "recommendation"] as const).filter((field) => segment.kind !== "parent_talk" || ["parentFeedback", "recommendation"].includes(field)).map((field) => <Label key={field} className="grid gap-1 text-[11px] text-muted">{publicT(field)}<Textarea rows={2} value={draft[field]} maxLength={3000} disabled={!editable || pending} className="min-h-14 text-xs" onChange={(event) => edit(segment.id, { [field]: event.target.value })} /></Label>)}
        </section>;
      })}</div>
      <div className="flex items-center justify-between gap-3 px-3 pb-3"><span className="text-[11px] text-muted">{t("saveHint")}</span>{editable ? <Button size="sm" disabled={pending || changed.length === 0} onClick={save}>{pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{t("saveStudent")}</Button> : null}</div>
      {data.canFollowUp && participant.status !== "cancelled" ? <div className="border-t border-line p-3"><PostActivityHandoff source={{ registrationId: participant.registrationId, invitationId: null }} onSaved={() => { void refresh(); }} /></div> : null}
    </DashboardInlineEntry></TableCell></TableRow> : null}
  </Fragment>;
}

function SegmentFields({ segment, data, saved }: { segment: PublicClassSegment; data: PublicClassRegistrationData; saved: () => Promise<void> }) {
  const t = useTranslations("school.publicClass");
  const locale = useLocale();
  const [pending, startSaving] = useTransition();
  const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(segment.scheduledAt)).replace(" ", "T");
  const [draft, setDraft] = useState({ title: segment.title, scheduledAt: localDate, durationMin: segment.durationMin, roomId: segment.roomId, location: segment.location, primaryTeacherId: segment.primaryTeacherId, assistantTeacherId: segment.assistantTeacherId });
  const edit = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const save = () => startSaving(async () => {
    const result = await savePublicClassSegmentAction({ ...draft, scheduledAt: new Date(`${draft.scheduledAt}+08:00`).toISOString(), activityId: data.activity.id, segmentId: segment.id, kind: segment.kind });
    if (!result.ok) { toast.error(t("actionFailed", { code: result.code })); return; }
    toast.success(t("segmentSaved")); await saved();
  });
  return <section className="space-y-3 py-3" lang={locale}><h4 className="text-xs font-medium">{t(`kind_${segment.kind}`)}</h4><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Label className="grid gap-1 text-xs">{t("segmentTitle")}<Input value={draft.title} disabled={!data.canManage || pending} onChange={(event) => edit({ title: event.target.value })} maxLength={100} className="h-8 text-xs" /></Label>
    <Label className="grid gap-1 text-xs">{t("segmentTime")}<DateTimePicker mode="datetime" value={draft.scheduledAt} onValueChange={(scheduledAt) => edit({ scheduledAt })} disabled={!data.canManage || pending} /></Label>
    <Label className="grid gap-1 text-xs">{t("duration")}<Input type="number" min={1} max={600} value={draft.durationMin} disabled={!data.canManage || pending} onChange={(event) => edit({ durationMin: Number(event.target.value) })} className="h-8 text-xs" /></Label>
    <Label className="grid gap-1 text-xs">{t("teachingRoom")}<Select value={draft.roomId ?? "none"} disabled={!data.canManage || pending} onValueChange={(roomId) => edit({ roomId: roomId === "none" ? null : roomId })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("roomUnassigned")}</SelectItem>{data.roomOptions.map((room) => <SelectItem key={room.id} value={room.id}>{room.campusName} · {room.name}</SelectItem>)}</SelectContent></Select></Label>
    {(["primaryTeacherId", "assistantTeacherId"] as const).map((field) => <Label key={field} className="grid gap-1 text-xs">{t(field === "primaryTeacherId" ? "primaryTeacher" : "assistantTeacher")}<Select value={draft[field] ?? "none"} disabled={!data.canManage || pending} onValueChange={(id) => edit({ [field]: id === "none" ? null : id, ...(field === "primaryTeacherId" && id === draft.assistantTeacherId ? { assistantTeacherId: null } : {}) })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("teacherUnassigned")}</SelectItem>{data.staffOptions.filter((staff) => field !== "assistantTeacherId" || staff.id !== draft.primaryTeacherId).map((staff) => <SelectItem key={staff.id} value={staff.id}>{staff.name}</SelectItem>)}</SelectContent></Select></Label>)}
    <Label className="grid gap-1 text-xs">{t("fallbackLocation")}<Input value={draft.location} disabled={!data.canManage || pending} maxLength={100} onChange={(event) => edit({ location: event.target.value })} className="h-8 text-xs" /></Label>
    {data.canManage ? <div className="flex items-end"><Button size="sm" disabled={pending || !draft.title.trim() || !draft.scheduledAt} onClick={save}>{t("saveRecord")}</Button></div> : null}
  </div></section>;
}
