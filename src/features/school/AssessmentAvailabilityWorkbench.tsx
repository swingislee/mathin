"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { newId } from "@/lib/uuid";
import { cn } from "@/lib/utils";
import { loadAssessmentSlotManagementAction, saveAssessmentSlotAction } from "./assessment-availability-actions";
import {
  ASSESSMENT_SLOT_GRADES, ASSESSMENT_SLOT_SUBJECTS, assessmentAvailabilityError,
  assessmentSlotDraft, assessmentSlotInput, shiftAssessmentSlotDate,
  type AssessmentAvailabilitySlot, type AssessmentSlotDraft, type AssessmentSlotManagement,
} from "./assessment-availability-contract";
import {
  DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState,
  DashboardPage, DashboardTableShell,
} from "./dashboard-page";
import { DashboardRowDisclosure } from "./dashboard-page/DashboardRowDisclosure";
import { DashboardTablePagination } from "./dashboard-page/DashboardTablePagination";
import { FollowupRecordRow, FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { calendarDayKey, dateTimeInputToInstant } from "./schedule";

function SlotEditor({ draft, slot, data, pending, error, onChange, onSave, onReset }: {
  draft: AssessmentSlotDraft;
  slot?: AssessmentAvailabilitySlot;
  data: AssessmentSlotManagement;
  pending: boolean;
  error?: string | null;
  onChange: (draft: AssessmentSlotDraft) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const t = useTranslations("school.assessmentAvailability");
  const locked = pending || Boolean(slot?.booked);
  const prefix = `slot-${draft.slotId}`;
  const gradeLabel = (grade: number) => grade === -1 ? t("kindergartenMiddle") : grade === 0 ? t("kindergartenSenior") : t("grade", { grade });
  const patch = (value: Partial<AssessmentSlotDraft>) => onChange({ ...draft, ...value });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSave(); }}>
    {slot?.booked ? <p className="text-xs text-muted">{t("bookedHint")}</p> : null}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(9rem,1fr)_minmax(7rem,.7fr)_minmax(7rem,.7fr)]">
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${prefix}-teacher`}>{t("teacher")}</Label>
        <Select value={draft.teacherId} disabled={locked || !data.canManageAll} onValueChange={teacherId => patch({ teacherId })}>
          <SelectTrigger id={`${prefix}-teacher`}><SelectValue placeholder={t("selectTeacher")} /></SelectTrigger>
          <SelectContent>{data.teachers.map(teacher => <SelectItem key={teacher.id} value={teacher.id}>{teacher.displayName}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${prefix}-campus`}>{t("campus")}</Label>
        <Select value={draft.campusId} disabled={locked} onValueChange={campusId => patch({ campusId })}>
          <SelectTrigger id={`${prefix}-campus`}><SelectValue placeholder={t("selectCampus")} /></SelectTrigger>
          <SelectContent>{data.campuses.map(campus => <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-date`}>{t("date")}</Label>
        <Input id={`${prefix}-date`} type="date" required value={draft.date} disabled={locked} onChange={event => patch({ date: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-start`}>{t("startsAt")}</Label>
        <Input id={`${prefix}-start`} type="time" step={60} required value={draft.startTime} disabled={locked} onChange={event => patch({ startTime: event.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-end`}>{t("endsAt")}</Label>
        <Input id={`${prefix}-end`} type="time" step={60} required value={draft.endTime} disabled={locked} onChange={event => patch({ endTime: event.target.value })} />
      </div>
    </div>
    <fieldset disabled={locked} className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-ink">{t("subjects")}</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">{ASSESSMENT_SLOT_SUBJECTS.map(subject => <Label key={subject} className="flex cursor-pointer items-center gap-2">
        <Checkbox checked={draft.subjects.includes(subject)} onCheckedChange={checked => patch({ subjects: checked === true ? [...draft.subjects, subject] : draft.subjects.filter(value => value !== subject) })} />
        {t(`subject_${subject}`)}
      </Label>)}</div>
    </fieldset>
    <fieldset disabled={locked} className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-ink">{t("grades")}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={draft.grades.length === 0} onCheckedChange={checked => patch({ grades: checked === true ? [] : [...ASSESSMENT_SLOT_GRADES] })} />{t("allGrades")}
        </Label>
        {ASSESSMENT_SLOT_GRADES.map(grade => <Label key={grade} className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={draft.grades.includes(grade)} onCheckedChange={checked => patch({ grades: checked === true ? [...draft.grades, grade].sort((a, b) => a - b) : draft.grades.filter(value => value !== grade) })} />
          {gradeLabel(grade)}
        </Label>)}
      </div>
    </fieldset>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Label className="flex cursor-pointer items-center gap-2">
        <Checkbox checked={draft.enabled} disabled={pending} onCheckedChange={checked => patch({ enabled: checked === true })} />{t("enabled")}
      </Label>
      <span className="text-xs text-muted">{t("method")}</span>
    </div>
    {error ? <p role="alert" className="text-sm text-rose">{t(assessmentAvailabilityError(error))}</p> : null}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Save className="size-4" aria-hidden />}
        {t(pending ? "saving" : slot ? "save" : draft.enabled ? "publish" : "saveClosed")}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onReset}>{t(slot ? "useSaved" : "discardDraft")}</Button>
      <span className="text-xs text-muted">{t("saveHint")}</span>
    </div>
  </form>;
}

export function AssessmentAvailabilityWorkbench({ locale, timeZone, now, initialFrom, initialData, initialError, canViewAssessments }: {
  locale: string; timeZone: string; now: number; initialFrom: string;
  canViewAssessments: boolean;
  initialData: AssessmentSlotManagement | null; initialError: string | null;
}) {
  const t = useTranslations("school.assessmentAvailability");
  const [data, setData] = useState(initialData);
  const [from, setFrom] = useState(initialFrom);
  const [teacherId, setTeacherId] = useState(initialData?.canManageAll ? "all" : initialData?.currentUserId ?? "all");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(initialError);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AssessmentSlotDraft>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [newSlotId, setNewSlotId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const requestId = useRef(0);
  const today = calendarDayKey(new Date(now), timeZone);
  const to = shiftAssessmentSlotDate(from, 13, timeZone);
  const busy = loading || savingId !== null;
  const rows = useMemo(() => (data?.slots ?? []).filter(slot => teacherId === "all" || slot.teacherId === teacherId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.teacherId.localeCompare(b.teacherId)), [data, teacherId]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const dateFormatter = new Intl.DateTimeFormat(locale, { timeZone, month: "long", day: "numeric", weekday: "long" });
  const timeFormatter = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const gradeLabel = (grade: number) => grade === -1 ? t("kindergartenMiddle") : grade === 0 ? t("kindergartenSenior") : t("grade", { grade });
  const teacherName = (id: string) => data?.teachers.find(teacher => teacher.id === id)?.displayName ?? t("teacherUnavailableLabel");
  const campusName = (id: string) => data?.campuses.find(campus => campus.id === id)?.name ?? t("campusUnavailableLabel");

  async function loadWindow(nextFrom: string) {
    if (!dateTimeInputToInstant(`${nextFrom}T12:00`, timeZone)) return;
    const request = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await loadAssessmentSlotManagementAction({ from: nextFrom, to: shiftAssessmentSlotDate(nextFrom, 13, timeZone) });
      if (request !== requestId.current) return;
      if (!result.ok) { setLoadError(result.code); return; }
      setData(result.data);
      if (newSlotId && result.data.slots.some(slot => slot.id === newSlotId)) setNewSlotId(null);
      setFrom(nextFrom);
      if (!result.data.canManageAll) setTeacherId(result.data.currentUserId);
      if (nextFrom !== from) setPage(1);
    } catch { if (request === requestId.current) setLoadError("UNKNOWN"); }
    finally { if (request === requestId.current) setLoading(false); }
  }

  function updateDraft(draft: AssessmentSlotDraft) {
    setDrafts(current => ({ ...current, [draft.slotId]: draft }));
    setErrors(current => ({ ...current, [draft.slotId]: null }));
  }

  function openSlot(slot: AssessmentAvailabilitySlot, open: boolean) {
    if (busy) return;
    setActiveId(slot.id);
    setExpandedId(open ? slot.id : null);
    if (open) setDrafts(current => current[slot.id] ? current : { ...current, [slot.id]: assessmentSlotDraft(slot, timeZone) });
  }

  function addSlot() {
    if (!data || busy) return;
    if (newSlotId) { setExpandedId(newSlotId); setActiveId(newSlotId); return; }
    const id = newId();
    const clock = new Date();
    const clockDay = calendarDayKey(clock, timeZone);
    const afternoon = dateTimeInputToInstant(`${clockDay}T15:00`, timeZone)!;
    const nextDate = from > clockDay ? from : afternoon > clock ? clockDay : shiftAssessmentSlotDate(clockDay, 1, timeZone);
    const selectedTeacher = teacherId !== "all" ? teacherId : data.teachers.find(teacher => teacher.id === data.currentUserId)?.id ?? data.teachers[0]?.id ?? "";
    updateDraft({ slotId: id, teacherId: selectedTeacher, campusId: data.campuses[0]?.id ?? "", subjects: ["math"], grades: [],
      date: nextDate, startTime: "15:00", endTime: "15:40", enabled: true, expectedUpdatedAt: null });
    setNewSlotId(id);
    setActiveId(id);
    setExpandedId(id);
  }

  async function saveDraft(id: string) {
    const draft = drafts[id];
    if (!draft || busy) return;
    const input = assessmentSlotInput(draft, timeZone);
    if (!input) { setErrors(current => ({ ...current, [id]: "VALIDATION" })); return; }
    setSavingId(id);
    setErrors(current => ({ ...current, [id]: null }));
    try {
      const result = await saveAssessmentSlotAction(input);
      if (!result.ok) {
        setErrors(current => ({ ...current, [id]: result.code }));
        if (result.code === "CONFLICT" || result.code === "SLOT_BOOKED") await loadWindow(from);
        return;
      }
      const saved = result.data;
      const savedDay = calendarDayKey(new Date(saved.startsAt), timeZone);
      const savedInWindow = savedDay >= from && savedDay <= to;
      const nextTeacherId = teacherId !== "all" && teacherId !== saved.teacherId ? saved.teacherId : teacherId;
      const nextSlots = [...(data?.slots ?? []).filter(slot => slot.id !== saved.id), ...(savedInWindow ? [saved] : [])];
      updateDraft(assessmentSlotDraft(saved, timeZone));
      setData(current => current ? { ...current, slots: nextSlots } : current);
      if (newSlotId === id) setNewSlotId(null);
      if (!savedInWindow) await loadWindow(savedDay);
      setTeacherId(nextTeacherId);
      const savedIndex = nextSlots.filter(slot => nextTeacherId === "all" || slot.teacherId === nextTeacherId)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.teacherId.localeCompare(b.teacherId)).findIndex(slot => slot.id === saved.id);
      setPage(savedIndex < 0 ? 1 : Math.floor(savedIndex / pageSize) + 1);
      setExpandedId(null);
      toast.success(t((saved.activeBooked ?? saved.booked) ? "savedBooked" : saved.enabled ? "savedOpen" : "savedClosed"));
    } catch { setErrors(current => ({ ...current, [id]: "UNKNOWN" })); }
    finally { setSavingId(null); }
  }

  function renderEditor(id: string, slot?: AssessmentAvailabilitySlot) {
    const draft = drafts[id];
    if (!draft || !data) return null;
    return <SlotEditor draft={draft} slot={slot} data={data} pending={savingId === id} error={errors[id]}
      onChange={updateDraft} onSave={() => void saveDraft(id)} onReset={() => {
        if (slot) updateDraft(assessmentSlotDraft(slot, timeZone));
        else { setNewSlotId(null); setExpandedId(null); setDrafts(current => { const next = { ...current }; delete next[id]; return next; }); }
      }} />;
  }

  return <DashboardPage title={t("title")} density="compact" backHref={canViewAssessments ? "/dashboard/assessments" : "/dashboard"} backLabel={t(canViewAssessments ? "back" : "backDashboard")}
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandState>
        <Button type="button" size="sm" variant="ghost" className="size-8 p-0" disabled={busy} title={t("previous")} aria-label={t("previous")} onClick={() => void loadWindow(shiftAssessmentSlotDate(from, -14, timeZone))}><ChevronLeft className="size-4" aria-hidden /></Button>
        <Input type="date" className="h-8 w-36 text-xs" aria-label={t("rangeStart")} value={from} disabled={busy} onChange={event => void loadWindow(event.target.value)} />
        <span className="text-xs tabular-nums text-muted">— {to}</span>
        <Button type="button" size="sm" variant="ghost" className="size-8 p-0" disabled={busy} title={t("next")} aria-label={t("next")} onClick={() => void loadWindow(shiftAssessmentSlotDate(from, 14, timeZone))}><ChevronRight className="size-4" aria-hidden /></Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void loadWindow(today)}>{t("today")}</Button>
      </DashboardCommandState>
      <DashboardCommandFilters>
        {data?.canManageAll ? <Select value={teacherId} disabled={busy} onValueChange={value => { setTeacherId(value); setPage(1); }}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("filterTeacher")}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t("allTeachers")}</SelectItem>{data.teachers.map(teacher => <SelectItem key={teacher.id} value={teacher.id}>{teacher.displayName}</SelectItem>)}</SelectContent>
        </Select> : data ? <span className="text-sm text-ink">{teacherName(data.currentUserId)}</span> : null}
      </DashboardCommandFilters>
      <DashboardCommandActions>
        <Button type="button" size="sm" variant="ghost" className="size-8 p-0" disabled={busy} title={t("refresh")} aria-label={t("refresh")} onClick={() => void loadWindow(from)}><RefreshCw className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")} aria-hidden /></Button>
        <Button type="button" size="sm" disabled={busy || !data || !data.teachers.length || !data.campuses.length} onClick={addSlot}><CalendarPlus className="size-4" aria-hidden />{t(newSlotId ? "continueDraft" : "add")}</Button>
      </DashboardCommandActions>
    </DashboardCommandPanel>}
    footer={<DashboardTablePagination currentPage={currentPage} totalPages={totalPages} totalCount={rows.length} pageSize={pageSize} pageSizes={[20, 50, 100]}
      disabled={busy} pending={loading} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1); }} />}>
    {loadError ? <p role="alert" className="mb-3 text-sm text-rose">{t("loadFailed")} {t(assessmentAvailabilityError(loadError))}</p> : null}
    {data && !data.campuses.length ? <p role="status" className="mb-3 text-sm text-muted">{t("noCampuses")}</p> : null}
    {data && !data.teachers.length ? <p role="status" className="mb-3 text-sm text-muted">{t("noTeachers")}</p> : null}
    <DashboardTableShell data-followup-workbench data-assessment-slot-management aria-busy={busy}>
      <Table mobileLayout="stacked" className="min-w-[54rem] text-xs" containerClassName="overflow-auto [scrollbar-gutter:stable]">
        <TableHeader className="sticky top-0 z-20 bg-card"><TableRow className="hover:bg-transparent">
          <TableHead className="w-60">{t("dateTime")}</TableHead><TableHead>{t("teacher")}</TableHead><TableHead>{t("campus")}</TableHead>
          <TableHead>{t("subjects")}</TableHead><TableHead className="w-64">{t("grades")}</TableHead><TableHead className="w-32">{t("status")}</TableHead>
        </TableRow></TableHeader>
        <FollowupTableBody onNavigate={id => { setActiveId(id); return true; }}>
          {newSlotId ? <FollowupRecordRow rowKey={newSlotId} active={activeId === newSlotId} expanded={expandedId === newSlotId} pending={savingId === newSlotId}
            onActivate={() => setActiveId(newSlotId)} onExpandedChange={open => setExpandedId(open ? newSlotId : null)} detailsId={`assessment-slot-${newSlotId}`} title={t("newTitle")} colSpan={6}
            onSave={() => void saveDraft(newSlotId)} summary={<TableCell colSpan={6} mobileSpan="full"><div className="flex items-center gap-2"><DashboardRowDisclosure expanded={expandedId === newSlotId} label={t("newTitle")} controls={`assessment-slot-${newSlotId}`} onToggle={() => setExpandedId(expandedId === newSlotId ? null : newSlotId)} /><span className="font-medium text-ink">{t("newTitle")}</span><span className="text-muted">{t("unsaved")}</span></div></TableCell>}>
            {renderEditor(newSlotId)}
          </FollowupRecordRow> : null}
          {visibleRows.map(slot => {
            const detailsId = `assessment-slot-${slot.id}`;
            const expanded = expandedId === slot.id;
            const status = (slot.activeBooked ?? slot.booked) ? "booked" : slot.enabled ? "open" : "closed";
            return <FollowupRecordRow key={slot.id} rowKey={slot.id} active={activeId === slot.id} expanded={expanded} pending={savingId === slot.id}
              onActivate={() => setActiveId(slot.id)} onExpandedChange={open => openSlot(slot, open)} detailsId={detailsId} title={t("editTitle")} colSpan={6} onSave={() => void saveDraft(slot.id)}
              rowProps={{ className: "cursor-pointer focus-visible:outline-none" }} summary={<>
                <TableCell mobileSpan="primary"><div className="flex items-center gap-2"><DashboardRowDisclosure expanded={expanded} label={t("editTitle")} controls={detailsId} onToggle={() => openSlot(slot, !expanded)} /><div className="space-y-1"><time dateTime={slot.startsAt} className="block font-medium text-ink">{dateFormatter.format(new Date(slot.startsAt))}</time><span className="tabular-nums text-muted">{timeFormatter.format(new Date(slot.startsAt))}–{timeFormatter.format(new Date(slot.endsAt))}</span></div></div></TableCell>
                <TableCell mobileLabel={t("teacher")}>{teacherName(slot.teacherId)}</TableCell><TableCell mobileLabel={t("campus")}>{campusName(slot.campusId)}</TableCell>
                <TableCell mobileLabel={t("subjects")}>{slot.subjects.map(subject => t(`subject_${subject}`)).join(" · ")}</TableCell>
                <TableCell mobileLabel={t("grades")}><span className="leading-5">{slot.grades.length ? slot.grades.map(gradeLabel).join(" · ") : t("allGrades")}</span></TableCell>
                <TableCell mobileSpan="secondary"><div className="flex flex-wrap gap-1"><Badge variant="outline" className={cn("whitespace-nowrap", status === "open" ? "border-leaf-deep/35 bg-leaf/20 text-leaf-deep" : status === "booked" ? "border-crater/40 bg-moon/40 text-ink" : "border-line text-muted")}>{t(status)}</Badge>{status === "booked" && !slot.enabled ? <span className="text-muted">{t("closed")}</span> : null}</div></TableCell>
              </>}>
              {renderEditor(slot.id, slot)}
            </FollowupRecordRow>;
          })}
          {!visibleRows.length && !newSlotId ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-sm text-muted">{t(!data ? "unavailable" : "empty")}</TableCell></TableRow> : null}
        </FollowupTableBody>
      </Table>
    </DashboardTableShell>
  </DashboardPage>;
}
