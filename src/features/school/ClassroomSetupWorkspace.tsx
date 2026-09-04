"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, LoaderCircle, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getClassScheduleCalendarAction } from "./actions/academic-calendar";
import {
  completeClassroomSetupAction,
  getClassBuildConflictsAction,
  getClassBuildCourseDetailAction,
} from "./actions/classes";
import type { ClassroomDetail, StaffOption } from "./classes";
import {
  CLASS_SETUP_WEEKDAYS,
  importedClassScheduleDefaults,
  type ClassSetupWeekday,
  type ClassroomImportSetupContext,
} from "./classroom-setup-contract";
import { inputClass } from "./controls";
import { DashboardTableShell } from "./dashboard-page";
import { formatRoomLocation } from "./location-format";
import type { RoomOptionV2 } from "./organization-locations";
import { RoomPicker } from "./RoomPicker";
import { calendarDayKey } from "./schedule";
import { generateSchedulePreview } from "./schedule-preview";
import type { TeachingCalendarEntryV2 } from "./teaching-calendar";
import { CoursePicker } from "./teaching-operations/CoursePicker";
import type { ClassBuildCourseDetail, ClassBuildScheduleConflict } from "./teaching-operations/course-picker-types";

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_INPUT_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validDateInput(value: string) {
  return DATE_INPUT_PATTERN.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function weekdayForDate(value: string): ClassSetupWeekday {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return CLASS_SETUP_WEEKDAYS.includes(day as ClassSetupWeekday) ? day as ClassSetupWeekday : 1;
}

export function ClassroomSetupWorkspace({
  classroom,
  staffOptions,
  roomOptions,
  defaultDurationMinutes,
  timeZone,
  importContext,
  returnTo,
}: {
  classroom: ClassroomDetail;
  staffOptions: StaffOption[];
  roomOptions: RoomOptionV2[];
  defaultDurationMinutes: number;
  timeZone: string;
  importContext: ClassroomImportSetupContext | null;
  returnTo: string | null;
}) {
  const t = useTranslations("school.classSetup");
  const router = useRouter();
  const importedDefaults = useMemo(() => importedClassScheduleDefaults(importContext), [importContext]);
  const initialStartDate = importedDefaults.startDate ?? calendarDayKey(new Date(), timeZone);
  const [name, setName] = useState(classroom.name);
  const [capacity, setCapacity] = useState(classroom.capacity?.toString() ?? "");
  const [course, setCourse] = useState<ClassBuildCourseDetail | null>(null);
  const [courseLoading, setCourseLoading] = useState(Boolean(classroom.courseId));
  const [courseLoadFailed, setCourseLoadFailed] = useState(false);
  const [primaryTeacherId, setPrimaryTeacherId] = useState(
    importContext?.reviewIssues.includes("teacher") ? "" : classroom.primaryTeacherId ?? "",
  );
  const [roomId, setRoomId] = useState<string | null>(classroom.defaultRoomId);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [weekdays, setWeekdays] = useState<Set<ClassSetupWeekday>>(() => new Set([
    importedDefaults.weekday ?? weekdayForDate(initialStartDate),
  ]));
  const [time, setTime] = useState(importedDefaults.startTime ?? "19:00");
  const [durationMin, setDurationMin] = useState(String(importedDefaults.durationMin ?? defaultDurationMinutes));
  const [calendarEntries, setCalendarEntries] = useState<TeachingCalendarEntryV2[]>([]);
  const [calendarLoadedKey, setCalendarLoadedKey] = useState("");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarLoadFailed, setCalendarLoadFailed] = useState(false);
  const [conflicts, setConflicts] = useState<ClassBuildScheduleConflict[]>([]);
  const [conflictsLoading, setConflictsLoading] = useState(false);

  const needsSchedule = classroom.sessions.length === 0;
  const capacityNumber = capacity === "" ? null : Number(capacity);
  const nameValid = name.trim().length > 0 && name.trim().length <= 100;
  const capacityValid = capacityNumber === null
    || (Number.isInteger(capacityNumber) && capacityNumber >= 1 && capacityNumber <= 500);
  const scheduleInputsValid = validDateInput(startDate)
    && TIME_INPUT_PATTERN.test(time)
    && Number.isInteger(Number(durationMin))
    && Number(durationMin) >= 10
    && Number(durationMin) <= 600;
  const roomCampusId = roomId ? roomOptions.find((room) => room.id === roomId)?.campusId ?? null : null;
  const scheduleKey = needsSchedule && course?.lectures.length && validDateInput(startDate)
    ? `${startDate}:${course.lectures.length}`
    : "";
  const calendarReady = scheduleKey === "" || (calendarLoadedKey === scheduleKey && !calendarLoadFailed);

  useEffect(() => {
    if (!classroom.courseId) return;
    let active = true;
    void getClassBuildCourseDetailAction(classroom.courseId, classroom.purpose)
      .then((detail) => { if (active) setCourse(detail); })
      .catch(() => { if (active) setCourseLoadFailed(true); })
      .finally(() => { if (active) setCourseLoading(false); });
    return () => { active = false; };
  }, [classroom.courseId, classroom.purpose]);

  useEffect(() => {
    if (!scheduleKey || !course) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setCalendarLoading(true);
      setCalendarLoadFailed(false);
      void getClassScheduleCalendarAction(startDate, course.lectures.length)
        .then((rows) => {
          if (!active) return;
          setCalendarEntries(rows);
          setCalendarLoadedKey(scheduleKey);
        })
        .catch(() => {
          if (!active) return;
          setCalendarEntries([]);
          setCalendarLoadedKey("");
          setCalendarLoadFailed(true);
        })
        .finally(() => { if (active) setCalendarLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [course, scheduleKey, startDate]);

  const preview = useMemo(() => {
    if (!needsSchedule || !course || weekdays.size === 0 || !scheduleInputsValid || !calendarReady) return [];
    const [hours, minutes] = time.split(":").map(Number);
    return generateSchedulePreview(
      course.lectures.map((lecture) => ({ lectureId: lecture.id, no: lecture.no, name: lecture.name })),
      startDate,
      [...weekdays],
      hours,
      minutes,
      Number(durationMin),
      timeZone,
      { entries: calendarEntries, campusId: roomCampusId },
    );
  }, [calendarEntries, calendarReady, course, durationMin, needsSchedule, roomCampusId, scheduleInputsValid, startDate, time, timeZone, weekdays]);

  const conflictSlots = useMemo(() => preview.map((item) => ({
    scheduledAt: item.scheduledAt.toISOString(),
    durationMin: item.durationMin,
  })), [preview]);

  useEffect(() => {
    if (!needsSchedule || !primaryTeacherId || !roomId || conflictSlots.length === 0) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setConflictsLoading(true);
      void getClassBuildConflictsAction(primaryTeacherId, roomId, conflictSlots)
        .then((rows) => { if (active) setConflicts(rows); })
        .catch(() => { if (active) setConflicts([]); })
        .finally(() => { if (active) setConflictsLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [conflictSlots, needsSchedule, primaryTeacherId, roomId]);

  const conflictsRelevant = needsSchedule && Boolean(primaryTeacherId) && Boolean(roomId) && conflictSlots.length > 0;
  const visibleConflicts = conflictsRelevant ? conflicts : [];

  const setupRun = useAction(completeClassroomSetupAction, {
    successMessage: (result) => t(result.createdSessions > 0 ? "savedWithSessions" : "saved", { count: result.createdSessions }),
    errorMessage: {
      CLASSROOM_SETUP_STALE: t("errorStale"),
      CLASSROOM_HAS_SESSIONS: t("errorHasSessions"),
      COURSE_NOT_AVAILABLE: t("errorCourseUnavailable"),
      INVALID_CLASSROOM_TERM: t("errorTerm"),
      INVALID_STAFF: t("errorTeacher"),
      INVALID_ROOM: t("errorRoom"),
      INVALID_SCHEDULE: t("errorSchedule"),
      CLOSED_DAY_CONFIRMATION_REQUIRED: t("errorClosedDay"),
      FORBIDDEN_SCOPE: t("errorForbidden"),
      default: t("errorDefault"),
    },
    onSuccess: () => {
      router.replace(returnTo ?? `/dashboard/classes/${classroom.id}?tab=sessions`);
      router.refresh();
    },
    onError: (code) => { if (code === "CLASSROOM_SETUP_STALE") router.refresh(); },
  });

  const toggleWeekday = (day: ClassSetupWeekday) => setWeekdays((current) => {
    const next = new Set(current);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    return next;
  });

  const scheduleReady = !needsSchedule || Boolean(
    course
      && course.lectures.length > 0
      && preview.length === course.lectures.length
      && calendarReady
      && !calendarLoading,
  );
  const canSave = nameValid
    && capacityValid
    && Boolean(course)
    && Boolean(primaryTeacherId)
    && Boolean(roomId)
    && scheduleReady
    && !courseLoading
    && !calendarLoadFailed;
  const setupFacts = [
    { key: "course", done: Boolean(course) },
    { key: "teacher", done: Boolean(primaryTeacherId) },
    { key: "room", done: Boolean(roomId) },
    { key: "schedule", done: !needsSchedule || scheduleReady },
  ] as const;

  const save = () => {
    if (!canSave || !course || !roomId || !primaryTeacherId) return;
    setupRun.run({
      classroomId: classroom.id,
      name: name.trim(),
      capacity: capacityNumber,
      courseId: course.id,
      roomId,
      primaryTeacherId,
      expectedSessionCount: classroom.sessions.length,
      sessions: needsSchedule ? preview.map((session) => ({
        lectureId: session.lectureId,
        no: session.no,
        name: session.name,
        scheduledAt: session.scheduledAt.toISOString(),
        durationMin: session.durationMin,
      })) : [],
    });
  };

  return (
    <div data-classroom-setup-workspace className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-start gap-3">
          {importContext ? <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" /> : <Sparkles className="mt-0.5 size-5 shrink-0 text-crater" />}
          <div>
            <h2 className="text-lg font-medium text-ink">{t(importContext ? "importTitle" : "title")}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{t(importContext ? "importDescription" : "description")}</p>
            {importContext?.sourceLabel ? <p className="mt-1 text-xs text-muted">{t("sourceLabel", { label: importContext.sourceLabel })}</p> : null}
          </div>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {setupFacts.map((fact) => (
            <li key={fact.key} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", fact.done ? "border-leaf/30 bg-leaf/5 text-ink" : "border-amber-500/35 bg-amber-500/5 text-amber-900 dark:text-amber-100")}>
              {fact.done ? <CheckCircle2 className="size-4 text-leaf" /> : <CircleAlert className="size-4" />}
              {t(`fact_${fact.key}`)}
              <Badge variant={fact.done ? "secondary" : "outline"} className="ml-auto">{t(fact.done ? "ready" : "pending")}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 border-t border-line pt-5">
        <div><h3 className="font-medium text-ink">{t("courseSection")}</h3><p className="mt-1 text-sm text-muted">{t("courseSectionHint")}</p></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <Label className="text-xs font-normal text-muted">{t("course")}</Label>
            <div className="mt-1">
              {courseLoading ? <p className="flex items-center gap-2 py-3 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("loadingCourse")}</p> : (
                <CoursePicker
                  purpose={classroom.purpose}
                  selected={course}
                  onSelect={setCourse}
                  onClear={() => setCourse(null)}
                  disabled={!needsSchedule}
                />
              )}
            </div>
            {courseLoadFailed ? <p role="alert" className="mt-2 text-xs text-rose">{t("courseLoadFailed")}</p> : null}
            {!needsSchedule ? <p className="mt-2 text-xs text-muted">{t("courseLocked", { count: classroom.sessions.length })}</p> : null}
          </div>
          <div>
            <Label htmlFor="setup-class-name" className="text-xs font-normal text-muted">{t("name")}</Label>
            <Input id="setup-class-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} aria-invalid={!nameValid} className={cn("mt-1", inputClass)} />
            {!nameValid ? <p className="mt-1 text-xs text-rose">{t("nameInvalid")}</p> : null}
          </div>
          <div>
            <Label htmlFor="setup-capacity" className="text-xs font-normal text-muted">{t("capacity")}</Label>
            <Input id="setup-capacity" type="number" min={1} max={500} value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder={t("capacityPlaceholder")} aria-invalid={!capacityValid} className={cn("mt-1", inputClass)} />
            {!capacityValid ? <p className="mt-1 text-xs text-rose">{t("capacityInvalid")}</p> : null}
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t border-line pt-5">
        <div><h3 className="font-medium text-ink">{t("resourceSection")}</h3><p className="mt-1 text-sm text-muted">{t("resourceSectionHint")}</p></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <Label htmlFor="setup-primary-teacher" className="text-xs font-normal text-muted">{t("primaryTeacher")}</Label>
            <Select value={primaryTeacherId} onValueChange={setPrimaryTeacherId}>
              <SelectTrigger id="setup-primary-teacher" className="mt-1"><SelectValue placeholder={t("chooseTeacher")} /></SelectTrigger>
              <SelectContent>{staffOptions.map((staff) => <SelectItem key={staff.id} value={staff.id}>{staff.name}</SelectItem>)}</SelectContent>
            </Select>
            {importContext?.reviewIssues.includes("teacher") && !primaryTeacherId ? <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{t("teacherMustConfirm")}</p> : null}
          </div>
          <div>
            <Label htmlFor="setup-room" className="text-xs font-normal text-muted">{t("room")}</Label>
            <div className="mt-1"><RoomPicker id="setup-room" rooms={roomOptions} value={roomId} onValueChange={setRoomId} capacity={capacityNumber} /></div>
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t border-line pt-5">
        <div><h3 className="font-medium text-ink">{t("scheduleSection")}</h3><p className="mt-1 text-sm text-muted">{t(needsSchedule ? "scheduleSectionHint" : "existingScheduleHint", { count: classroom.sessions.length })}</p></div>
        {needsSchedule ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="setup-start-date" className="text-xs font-normal text-muted">{t("startDate")}</Label>
                <DateTimePicker id="setup-start-date" value={startDate} onValueChange={setStartDate} className={cn("mt-1", inputClass)} />
              </div>
              <div>
                <Label htmlFor="setup-time" className="text-xs font-normal text-muted">{t("time")}</Label>
                <DateTimePicker id="setup-time" mode="time" value={time} onValueChange={setTime} className={cn("mt-1", inputClass)} />
              </div>
              <div>
                <Label htmlFor="setup-duration" className="text-xs font-normal text-muted">{t("duration")}</Label>
                <Input id="setup-duration" type="number" min={10} max={600} step={5} value={durationMin} onChange={(event) => setDurationMin(event.target.value)} className={cn("mt-1", inputClass)} />
              </div>
            </div>
            <div>
              <Label className="text-xs font-normal text-muted">{t("weekdays")}</Label>
              <div className="mt-2 flex flex-wrap gap-2">{CLASS_SETUP_WEEKDAYS.map((day) => <Button key={day} type="button" variant={weekdays.has(day) ? "primary" : "secondary"} aria-pressed={weekdays.has(day)} onClick={() => toggleWeekday(day)}>{t(`weekday_${day}`)}</Button>)}</div>
            </div>
            {calendarLoading ? <p className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("calendarLoading")}</p> : null}
            {calendarLoadFailed ? <p role="alert" className="text-sm text-rose">{t("calendarLoadFailed")}</p> : null}
            {preview.length > 0 ? (
              <DashboardTableShell className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-16">{t("order")}</TableHead><TableHead>{t("lecture")}</TableHead><TableHead>{t("scheduledAt")}</TableHead></TableRow></TableHeader>
                  <TableBody>{preview.map((session, index) => <TableRow key={session.lectureId}><TableCell className="font-mono text-xs text-muted">{index + 1}</TableCell><TableCell>{session.name}</TableCell><TableCell>{new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(session.scheduledAt)}</TableCell></TableRow>)}</TableBody>
                </Table>
              </DashboardTableShell>
            ) : null}
            {conflictsLoading ? <p className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("checkingConflicts")}</p> : null}
            {!conflictsLoading && visibleConflicts.length > 0 ? (
              <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100">
                <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />{t("conflictsFound", { count: visibleConflicts.length })}</p>
                <ul className="mt-2 space-y-1 text-xs">{visibleConflicts.map((conflict) => <li key={conflict.sessionId}>{conflict.classroomName} · {conflict.lectureName} · {new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(conflict.scheduledAt))} · {[conflict.teacherConflict ? t("teacherConflict") : null, conflict.roomConflict ? formatRoomLocation(conflict.roomName, conflict.campusName, t("roomPending")) : null].filter(Boolean).join(" / ")}</li>)}</ul>
              </div>
            ) : null}
            {!conflictsLoading && conflictsRelevant && visibleConflicts.length === 0 ? <p className="flex items-center gap-2 text-sm text-leaf"><CheckCircle2 className="size-4" />{t("noConflicts")}</p> : null}
          </>
        ) : (
          <p className="rounded-xl bg-moon/25 px-3 py-2 text-sm text-muted">{t("existingScheduleSummary", { count: classroom.sessions.length })}</p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-xs text-muted">{t(visibleConflicts.length > 0 ? "conflictAdvisory" : "saveHint")}</p>
        <Button type="button" disabled={!canSave || setupRun.pending} onClick={save}>
          {setupRun.pending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {t(needsSchedule ? "saveAndSchedule" : "saveSetup", { count: preview.length })}
        </Button>
      </div>
    </div>
  );
}
