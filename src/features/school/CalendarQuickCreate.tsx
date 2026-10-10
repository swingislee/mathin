"use client";

import { useRef, useState } from "react";
import { AlignLeft, CalendarDays, Clock3, LoaderCircle, MapPin, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { assessmentAvailabilityError, assessmentSlotInput, type AssessmentAvailabilitySlot, type AssessmentSlotManagement } from "./assessment-availability-contract";
import { saveAssessmentSlotAction } from "./assessment-availability-actions";
import { saveCalendarEventAction } from "./calendar-actions";
import { CALENDAR_EVENT_KINDS, type CalendarEvent, type CalendarWorkspace } from "./calendar-contract";
import { calendarCreatePreview, calendarCreateSlotDraft, type CalendarCreateDraft } from "./calendar-create-draft";
import { CALENDAR_TONES, calendarRange } from "./calendar-layout";
import { calendarErrorKey } from "./CalendarEventDialog";
import { cn } from "@/lib/utils";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

interface Props {
  draft: CalendarCreateDraft;
  onChange: (draft: CalendarCreateDraft) => void;
  timeZone: string;
  workspace: CalendarWorkspace | null;
  availability: AssessmentSlotManagement | null;
  campuses: { id: string; name: string }[];
  onBusyChange: (busy: boolean) => void;
  onMore: () => void;
  onClose: () => void;
  onEventSaved: (event: CalendarEvent) => void;
  onSlotSaved: (slot: AssessmentAvailabilitySlot) => void;
}

export function CalendarQuickCreate({ draft, onChange, timeZone, workspace, availability, campuses, onBusyChange, onMore, onClose, onEventSaved, onSlotSaved }: Props) {
  const t = useTranslations("school.calendar");
  const a = useTranslations("school.assessmentAvailability");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peopleSearch, setPeopleSearch] = useState("");
  const lock = useRef(false);
  const isSlot = draft.kind === "availability";
  const patch = (value: Partial<CalendarCreateDraft>) => { if (!lock.current) { onChange({ ...draft, ...value }); setError(null); } };
  const people = workspace?.people.filter(person => person.id !== workspace.currentUserId) ?? [];
  const selectedNames = people.filter(person => draft.attendeeIds.includes(person.id)).map(person => person.displayName).join("、");
  const inputClass = "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500";

  function changeStart(value: string) {
    const before = dateTimeInputToInstant(draft.start, timeZone);
    const after = dateTimeInputToInstant(value, timeZone);
    const end = dateTimeInputToInstant(draft.end, timeZone);
    patch({ start: value, ...(before && after && end && end > before ? { end: zonedDateTimeInputValue(new Date(after.getTime() + end.getTime() - before.getTime()), timeZone) } : {}) });
  }

  function changeKind(kind: CalendarCreateDraft["kind"]) {
    const year = calendarRange(draft.start.slice(0, 10), "year", timeZone);
    const start = dateTimeInputToInstant(draft.start, timeZone);
    patch({ kind, ...(kind === "strategy" ? { start: zonedDateTimeInputValue(year.start, timeZone), end: zonedDateTimeInputValue(year.end, timeZone) }
      : start && (draft.kind === "strategy" || kind === "milestone") ? { end: zonedDateTimeInputValue(new Date(start.getTime() + 30 * 60_000), timeZone) } : {}),
    ...(kind === "availability" && !draft.campusId ? { campusId: availability?.campuses[0]?.id ?? "" } : {}) });
  }

  async function save() {
    if (lock.current) return;
    const preview = calendarCreatePreview(draft, timeZone);
    if (!preview || (!isSlot && !draft.title.trim())) { setError(t("errorValidation")); return; }
    const slotInput = isSlot ? assessmentSlotInput(calendarCreateSlotDraft(draft), timeZone) : null;
    if (isSlot && !slotInput) { setError(t("errorValidation")); return; }
    lock.current = true;
    setPending(true);
    onBusyChange(true);
    setError(null);
    try {
      if (draft.kind === "availability" && slotInput) {
        const result = await saveAssessmentSlotAction(slotInput);
        if (!result.ok) { setError(a(assessmentAvailabilityError(result.code))); return; }
        onSlotSaved(result.data);
      } else if (draft.kind !== "availability") {
        const result = await saveCalendarEventAction({ id: draft.id, kind: draft.kind, title: draft.title.trim(), description: draft.description,
          startsAt: preview.startsAt, endsAt: preview.endsAt, location: draft.location, campusId: draft.campusId || null,
          attendeeIds: draft.attendeeIds, expectedUpdatedAt: null });
        if (!result.ok) { setError(t(calendarErrorKey(result.code))); return; }
        onEventSaved(result.data);
      }
      toast.success(t("saved"));
      onClose();
    } catch { setError(t("errorFailed")); }
    finally { lock.current = false; setPending(false); onBusyChange(false); }
  }

  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }} aria-busy={pending}>
    <div className="flex items-center gap-2">
      <h2 className="sr-only">{t("quickCreate")}</h2>
      {isSlot ? <p className="flex-1 text-lg font-medium">{t("kind_availability")}</p> :
        <Input aria-label={t("eventTitle")} autoFocus value={draft.title} required maxLength={160} placeholder={t("quickTitle")}
          className={cn(inputClass, "h-11 flex-1 border-0 px-0 text-lg shadow-none focus-visible:ring-0")} disabled={pending} onChange={event => patch({ title: event.target.value })} />}
      <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t("close")} disabled={pending} onClick={onClose}><X className="size-4" /></button>
    </div>
    <fieldset disabled={pending} className="space-y-4">
      {isSlot && availability ? <div className="flex items-center gap-3">
        <Users className="size-4 shrink-0 text-slate-500" />
        <Select value={draft.teacherId} disabled={pending || !availability.canManageAll} onValueChange={teacherId => patch({ teacherId })}>
          <SelectTrigger className={cn(inputClass, "flex-1")} aria-label={a("teacher")}><SelectValue placeholder={a("selectTeacher")} /></SelectTrigger>
          <SelectContent>{availability.teachers.map(person => <SelectItem key={person.id} value={person.id}>{person.displayName}</SelectItem>)}</SelectContent>
        </Select>
      </div> : <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 text-sm text-slate-500">
          <Users className="size-4 shrink-0" /><span className="truncate">{selectedNames || t("quickPeople")}</span>
        </summary>
        <div className="ml-7 mt-2 space-y-2">
          <Input className={inputClass} aria-label={t("findPeople")} placeholder={t("findPeople")} value={peopleSearch} onChange={event => setPeopleSearch(event.target.value)} />
          <div className="max-h-32 overflow-y-auto">{people.filter(person => person.displayName.toLocaleLowerCase().includes(peopleSearch.toLocaleLowerCase())).map(person =>
            <Label key={person.id} className="flex min-h-8 cursor-pointer items-center gap-2 font-normal"><Checkbox checked={draft.attendeeIds.includes(person.id)}
              onCheckedChange={checked => patch({ attendeeIds: checked ? [...draft.attendeeIds, person.id] : draft.attendeeIds.filter(id => id !== person.id) })} />{person.displayName}</Label>)}</div>
        </div>
      </details>}
      <div className="flex items-start gap-3">
        <Clock3 className="mt-2.5 size-4 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <Input className={inputClass} type="datetime-local" step={60} required aria-label={t("startsAt")} value={draft.start} onChange={event => changeStart(event.target.value)} />
          {draft.kind !== "milestone" ? <Input className={inputClass} type="datetime-local" step={60} required aria-label={t("endsAt")} min={draft.start} value={draft.end} onChange={event => patch({ end: event.target.value })} /> : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <MapPin className="size-4 shrink-0 text-slate-500" />
        {isSlot ? <Select value={draft.campusId} disabled={pending} onValueChange={campusId => patch({ campusId })}>
          <SelectTrigger className={cn(inputClass, "flex-1")} aria-label={t("campus")}><SelectValue placeholder={a("selectCampus")} /></SelectTrigger>
          <SelectContent>{campuses.map(campus => <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>)}</SelectContent>
        </Select> : <Input className={cn(inputClass, "flex-1")} aria-label={t("location")} placeholder={t("quickLocation")} maxLength={240} value={draft.location} onChange={event => patch({ location: event.target.value })} />}
      </div>
      {isSlot ? <div className="ml-7 flex flex-wrap gap-4">{(availability?.topics ?? []).filter(topic => topic.enabled).map(topic => { const subject = topic.id; return <Label key={subject} className="flex cursor-pointer items-center gap-2 font-normal">
        <Checkbox checked={draft.subjects.includes(subject)} onCheckedChange={checked => patch({ subjects: checked ? [...draft.subjects, subject] : draft.subjects.filter(value => value !== subject) })} />{topic.name}
      </Label>; })}</div> : null}
      {!isSlot ? <div className="flex items-start gap-3"><AlignLeft className="mt-2.5 size-4 shrink-0 text-slate-500" />
        <Textarea className={cn(inputClass, "min-h-16 flex-1")} rows={2} maxLength={4000} aria-label={t("description")} placeholder={t("description")} value={draft.description} onChange={event => patch({ description: event.target.value })} />
      </div> : null}
      <div className="flex items-center gap-3">
        <CalendarDays className="size-4 shrink-0 text-slate-500" />
        <Select value={draft.kind} disabled={pending} onValueChange={kind => changeKind(kind as CalendarCreateDraft["kind"])}>
          <SelectTrigger aria-label={t("kind")} className={cn(inputClass, "w-auto min-w-36 border-0 px-0 shadow-none")}><SelectValue /></SelectTrigger>
          <SelectContent>{[...(workspace?.canCreate ? CALENDAR_EVENT_KINDS : []), ...(availability ? ["availability" as const] : [])].map(kind =>
            <SelectItem key={kind} value={kind}><span className="flex items-center gap-2"><span className={cn("size-2.5 rounded-sm", CALENDAR_TONES[kind].dot)} />{t(`kind_${kind}`)}</span></SelectItem>)}</SelectContent>
        </Select>
      </div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    <div className="flex items-center gap-2 pt-2">
      <button type="button" className="mr-auto text-sm text-blue-600 hover:underline disabled:opacity-50" disabled={pending} onClick={onMore}>{t("moreOptions")}</button>
      <Button type="button" variant="secondary" size="sm" className="border border-slate-200 bg-white text-slate-700 hover:bg-slate-50" disabled={pending} onClick={onClose}>{t("discard")}</Button>
      <Button type="submit" size="sm" disabled={pending} className="bg-blue-600 text-white hover:bg-blue-700">{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("save")}</Button>
    </div>
  </form>;
}
