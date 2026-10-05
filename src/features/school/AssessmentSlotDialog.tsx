"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { newId } from "@/lib/uuid";
import { loadAssessmentSlotManagementAction, saveAssessmentSlotAction } from "./assessment-availability-actions";
import { CalendarRecurrenceFields, calendarRecurrenceInput, newCalendarRecurrenceDraft } from "./CalendarRecurrenceFields";
import {
  ASSESSMENT_SLOT_GRADES,
  ASSESSMENT_SLOT_SUBJECTS,
  assessmentAvailabilityError,
  assessmentSlotDraft,
  assessmentSlotInput,
  shiftAssessmentSlotDate,
  type AssessmentAvailabilitySlot,
  type AssessmentSlotDraft,
  type AssessmentSlotManagement,
  type SaveAssessmentSlotInput,
} from "./assessment-availability-contract";
import { calendarDayKey } from "./schedule";

export interface AssessmentSlotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: AssessmentSlotManagement;
  timeZone: string;
  slot: AssessmentAvailabilitySlot | null;
  initialDate: string;
  initialStartTime: string;
  teacherId?: string;
  campusId?: string;
  initialDraft?: AssessmentSlotDraft;
  onDraftChange?: (draft: AssessmentSlotDraft) => void;
  onSaved: (slot: AssessmentAvailabilitySlot) => void;
}

function newSlotDraft({ data, initialDate, initialStartTime, teacherId, campusId, timeZone }: AssessmentSlotDialogProps): AssessmentSlotDraft {
  const startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(initialStartTime) ? initialStartTime : "15:00";
  const [hour, minute] = startTime.split(":").map(Number);
  const endMinutes = (hour * 60 + minute + 40) % (24 * 60);
  const preferredTeacher = data.canManageAll && data.teachers.some(teacher => teacher.id === teacherId)
    ? teacherId : data.currentUserId;
  return {
    slotId: newId(),
    teacherId: data.teachers.find(teacher => teacher.id === preferredTeacher)?.id
      ?? (data.canManageAll ? data.teachers[0]?.id : "") ?? "",
    campusId: data.campuses.find(campus => campus.id === campusId)?.id ?? data.campuses[0]?.id ?? "",
    subjects: ["math"],
    grades: [],
    date: initialDate,
    endDate: hour * 60 + minute + 40 >= 24 * 60 ? shiftAssessmentSlotDate(initialDate, 1, timeZone) : initialDate,
    startTime,
    endTime: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
    enabled: true,
    expectedUpdatedAt: null,
  };
}

/** Each opening gets its own draft; ordinary renders never allocate another slot ID. */
export function AssessmentSlotDialog(props: AssessmentSlotDialogProps) {
  return props.open ? <AssessmentSlotDialogSession key={props.slot?.id ?? "new"} {...props} /> : null;
}

function AssessmentSlotDialogSession(props: AssessmentSlotDialogProps) {
  const { onOpenChange, data, timeZone, slot, onSaved } = props;
  const t = useTranslations("school.assessmentAvailability");
  const common = useTranslations("school.classes");
  const calendar = useTranslations("school.calendar");
  const [draft, setDraft] = useState(() => slot ? assessmentSlotDraft(slot, timeZone) : props.initialDraft ?? newSlotDraft(props));
  const [repeat, setRepeat] = useState(() => newCalendarRecurrenceDraft(draft.date));
  const [restoredSlot, setRestoredSlot] = useState<AssessmentAvailabilitySlot | null>(null);
  const [restoredData, setRestoredData] = useState<AssessmentSlotManagement | null>(null);
  const [operation, setOperation] = useState<"save" | "reload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const currentSlot = restoredSlot ?? slot;
  const options = restoredData ?? data;
  const busy = operation !== null;
  const booked = Boolean(currentSlot?.booked || currentSlot?.activeBooked);
  const activeBooked = currentSlot?.activeBooked ?? currentSlot?.booked ?? false;
  const locked = busy || booked || needsRefresh;
  const prefix = `assessment-slot-${draft.slotId}`;
  const status = activeBooked ? "booked" : currentSlot?.enabled ? "open" : "closed";
  const ended = currentSlot ? Date.parse(currentSlot.endsAt) <= openedAt : false;
  const gradeLabel = (grade: number) => grade === -1 ? t("kindergartenMiddle")
    : grade === 0 ? t("kindergartenSenior") : t("grade", { grade });

  function patch(value: Partial<AssessmentSlotDraft>) {
    if (busyRef.current || needsRefresh) return;
    setDraft(current => ({ ...current, ...value }));
    if (!slot) props.onDraftChange?.({ ...draft, ...value });
    setError(null);
  }

  function close() {
    if (!busyRef.current) onOpenChange(false);
  }

  async function restoreSaved() {
    if (!currentSlot || busyRef.current) return;
    busyRef.current = true;
    setOperation("reload");
    setError(null);
    try {
      const from = calendarDayKey(new Date(currentSlot.startsAt), timeZone);
      const result = await loadAssessmentSlotManagementAction({ from, to: from });
      if (!mountedRef.current) return;
      if (!result.ok) { setError(result.code); return; }
      const latest = result.data.slots.find(item => item.id === currentSlot.id);
      if (!latest) { setError("NOT_FOUND"); return; }
      setRestoredSlot(latest);
      setRestoredData(result.data);
      setDraft(assessmentSlotDraft(latest, timeZone));
      setNeedsRefresh(false);
    } catch {
      if (mountedRef.current) setError("UNKNOWN");
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setOperation(null);
    }
  }

  async function save() {
    if (busyRef.current || needsRefresh) return;
    // Publication changes retain a booked slot's exact instants and immutable identity.
    const input: SaveAssessmentSlotInput | null = booked && currentSlot ? {
      slotId: currentSlot.id,
      teacherId: currentSlot.teacherId,
      campusId: currentSlot.campusId,
      subjects: [...currentSlot.subjects],
      grades: [...currentSlot.grades],
      startsAt: currentSlot.startsAt,
      endsAt: currentSlot.endsAt,
      enabled: draft.enabled,
      expectedUpdatedAt: draft.expectedUpdatedAt,
    } : assessmentSlotInput(draft, timeZone);
    if (!input) { setError("VALIDATION"); return; }
    const recurrence = currentSlot ? null : calendarRecurrenceInput(repeat, draft.date, timeZone);
    if (recurrence === undefined) { setError("REPEAT_VALIDATION"); return; }
    const saveInput: SaveAssessmentSlotInput = currentSlot ? input : { ...input, recurrence };

    busyRef.current = true;
    setOperation("save");
    setError(null);
    let saved: AssessmentAvailabilitySlot | null = null;
    try {
      const result = await saveAssessmentSlotAction(saveInput);
      if (!result.ok) {
        if (mountedRef.current) {
          setError(result.code);
          setNeedsRefresh(result.code === "CONFLICT" || result.code === "SLOT_BOOKED");
        }
        return;
      }
      saved = result.data;
    } catch {
      if (mountedRef.current) setError("UNKNOWN");
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setOperation(null);
    }
    if (!saved) return;
    toast.success(t((saved.activeBooked ?? saved.booked) ? "savedBooked" : saved.enabled ? "savedOpen" : "savedClosed"));
    onSaved(saved);
    if (mountedRef.current) onOpenChange(false);
  }

  return <Sheet open onOpenChange={next => { if (!next) close(); }}>
    <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg" closeLabel={common("cancel")}
      onEscapeKeyDown={event => { if (busyRef.current) event.preventDefault(); }}
      onInteractOutside={event => { if (busyRef.current) event.preventDefault(); }}>
      <SheetHeader className="shrink-0 px-6 pb-4 pr-16 pt-6 text-left">
        <SheetTitle>{t(slot ? "editTitle" : "newTitle")}</SheetTitle>
        <SheetDescription>{t("method")}</SheetDescription>
        {currentSlot ? <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className={cn("whitespace-nowrap", status === "open" && !currentSlot.blocked && !ended
            ? "border-leaf-deep/35 bg-leaf/20 text-leaf-deep"
            : status === "booked" ? "border-crater/40 bg-moon/40 text-ink" : "border-line text-muted")}>{status === "open" && ended ? calendar("slotPast") : status === "open" && currentSlot.blocked ? calendar("slotBlocked") : t(status)}</Badge>
          {activeBooked && !currentSlot.enabled ? <span className="text-muted">{t("closed")}</span> : null}
        </div> : null}
      </SheetHeader>

      <form className="flex min-h-0 flex-1 flex-col" aria-busy={busy}
        onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 pb-6 pt-1">
          {booked ? <p className="text-sm text-muted">{t("bookedHint")}</p> : null}
          {!options.teachers.length ? <p role="status" className="text-sm text-muted">{t("noTeachers")}</p> : null}
          {!options.campuses.length ? <p role="status" className="text-sm text-muted">{t("noCampuses")}</p> : null}

          <div className="grid min-w-0 grid-cols-2 gap-4">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${prefix}-teacher`}>{t("teacher")}</Label>
              <Select value={draft.teacherId} disabled={locked || !options.canManageAll}
                onValueChange={teacherId => patch({ teacherId })}>
                <SelectTrigger id={`${prefix}-teacher`}><SelectValue placeholder={t("selectTeacher")} /></SelectTrigger>
                <SelectContent>
                  {draft.teacherId && !options.teachers.some(teacher => teacher.id === draft.teacherId)
                    ? <SelectItem value={draft.teacherId} disabled>{t("teacherUnavailableLabel")}</SelectItem> : null}
                  {options.teachers.map(teacher => <SelectItem key={teacher.id} value={teacher.id}>{teacher.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${prefix}-campus`}>{t("campus")}</Label>
              <Select value={draft.campusId} disabled={locked} onValueChange={campusId => patch({ campusId })}>
                <SelectTrigger id={`${prefix}-campus`}><SelectValue placeholder={t("selectCampus")} /></SelectTrigger>
                <SelectContent>
                  {draft.campusId && !options.campuses.some(campus => campus.id === draft.campusId)
                    ? <SelectItem value={draft.campusId} disabled>{t("campusUnavailableLabel")}</SelectItem> : null}
                  {options.campuses.map(campus => <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${prefix}-date`}>{calendar("startDate")}</Label>
              <Input id={`${prefix}-date`} type="date" required value={draft.date} disabled={locked}
                onChange={event => patch({ date: event.target.value, endDate: !draft.endDate || draft.endDate === draft.date ? event.target.value : shiftAssessmentSlotDate(event.target.value, 1, timeZone) })} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${prefix}-end-date`}>{calendar("endDate")}</Label>
              <Input id={`${prefix}-end-date`} type="date" required value={draft.endDate ?? draft.date} disabled={locked}
                onChange={event => patch({ endDate: event.target.value })} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${prefix}-start`}>{t("startsAt")}</Label>
              <Input id={`${prefix}-start`} type="time" step={60} required value={draft.startTime} disabled={locked}
                onChange={event => patch({ startTime: event.target.value })} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={`${prefix}-end`}>{t("endsAt")}</Label>
              <Input id={`${prefix}-end`} type="time" step={60} required value={draft.endTime} disabled={locked}
                onChange={event => patch({ endTime: event.target.value })} />
            </div>
          </div>

          <p className="text-xs text-muted">{timeZone}</p>
          {currentSlot ? <p className="text-xs text-muted">{calendar("slotSingleEditHint")}</p>
            : <CalendarRecurrenceFields prefix={`${prefix}-repeat`} draft={repeat} startDate={draft.date} disabled={locked}
              onChange={value => { if (!busyRef.current) { setRepeat(value); setError(null); } }} />}

          <fieldset disabled={locked}>
            <legend className="mb-3 text-sm font-medium text-ink">{t("subjects")}</legend>
            <div className="grid grid-cols-2 gap-3">{ASSESSMENT_SLOT_SUBJECTS.map(subject => <Label key={subject} className="flex min-h-6 cursor-pointer items-center gap-2">
              <Checkbox checked={draft.subjects.includes(subject)} disabled={locked}
                onCheckedChange={checked => patch({ subjects: checked === true
                  ? [...new Set([...draft.subjects, subject])] : draft.subjects.filter(value => value !== subject) })} />
              {t(`subject_${subject}`)}
            </Label>)}</div>
          </fieldset>

          <fieldset disabled={locked}>
            <legend className="mb-3 text-sm font-medium text-ink">{t("grades")}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Label className="col-span-2 flex min-h-6 cursor-pointer items-center gap-2">
                <Checkbox checked={draft.grades.length === 0} disabled={locked}
                  onCheckedChange={checked => patch({ grades: checked === true ? [] : [...ASSESSMENT_SLOT_GRADES] })} />
                {t("allGrades")}
              </Label>
              {ASSESSMENT_SLOT_GRADES.map(grade => <Label key={grade} className="flex min-h-6 cursor-pointer items-center gap-2">
                <Checkbox checked={draft.grades.includes(grade)} disabled={locked}
                  onCheckedChange={checked => patch({ grades: checked === true
                    ? [...new Set([...draft.grades, grade])].sort((a, b) => a - b) : draft.grades.filter(value => value !== grade) })} />
                {gradeLabel(grade)}
              </Label>)}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label className="flex min-h-6 cursor-pointer items-center gap-2">
              <Checkbox checked={draft.enabled} disabled={busy || needsRefresh}
                onCheckedChange={checked => patch({ enabled: checked === true })} />
              {t("enabled")}
            </Label>
            {!booked ? <p className="text-xs text-muted">{t("saveHint")}</p> : null}
          </div>
        </div>

        <div className="shrink-0 space-y-3 border-t border-line bg-paper px-6 py-4">
          {error ? <p role="alert" className="text-sm text-rose">{error === "REPEAT_VALIDATION" ? calendar("errorRepeat") : t(assessmentAvailabilityError(error))}</p> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy}
              onClick={() => { if (currentSlot) void restoreSaved(); else close(); }}>
              {operation === "reload" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {t(currentSlot ? "useSaved" : "discardDraft")}
            </Button>
            <Button type="submit" size="sm" disabled={busy || needsRefresh}>
              {operation === "save" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Save className="size-4" aria-hidden />}
              {t(operation === "save" ? "saving" : currentSlot ? "save" : draft.enabled ? "publish" : "saveClosed")}
            </Button>
          </div>
        </div>
      </form>
    </SheetContent>
  </Sheet>;
}
