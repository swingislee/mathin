"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getClassScheduleCalendarAction } from "./actions/academic-calendar";
import {
  buildClass,
  getClassBuildCalendarPreviewAction,
  getClassBuildConflictsAction,
  getClassBuildCourseDetailAction,
  type ClassBuildCalendarPreviewRow,
} from "./actions/classes";
import type { BuildClassInput, BuildClassSession } from "./actions/types";
import type { StaffOption } from "./classes";
import type { SchoolTermRow } from "./courses";
import { schoolTermLabel } from "./school-periods";
import { inputClass } from "./controls";
import { DashboardTableShell } from "./dashboard-page";
import { generateSchedulePreview } from "./schedule-preview";
import { RoomPicker } from "./RoomPicker";
import { formatRoomLocation } from "./location-format";
import type { RoomOptionV2 } from "./organization-locations";
import { CoursePicker } from "./teaching-operations/CoursePicker";
import type { ClassBuildCourseDetail, ClassBuildLecture, ClassBuildPurpose, ClassBuildScheduleConflict } from "./teaching-operations/course-picker-types";
import type { ClassroomOfferingType } from "./teaching-operations/types";
import { calendarDayKey, dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";
import type { TeachingCalendarEntryV2 } from "./teaching-calendar";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_INPUT_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validDateInput(value: string) {
  return DATE_INPUT_PATTERN.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

type FreeSessionDraft = { key: string; name: string };
type PendingClosedDayBuild = {
  input: BuildClassInput;
  sessionKeys: string[];
  rows: ClassBuildCalendarPreviewRow[];
};

export function ClassBuildWizard({
  schoolTerms,
  teachers,
  roomOptions,
  defaultDurationMinutes,
  timeZone,
  initialCourseId,
}: {
  schoolTerms: SchoolTermRow[];
  teachers: StaffOption[];
  roomOptions: RoomOptionV2[];
  defaultDurationMinutes: number;
  timeZone: string;
  initialCourseId?: string;
}) {
  const t = useTranslations("school.classBuild");
  const locale = useLocale();
  const scheduleT = useTranslations("school.schedule");
  const router = useRouter();
  const initialCourseHandled = useRef(false);
  const freeSessionSequence = useRef(0);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"course" | "free">("course");
  const [purpose, setPurpose] = useState<ClassBuildPurpose>("production");
  const [offeringType, setOfferingType] = useState<ClassroomOfferingType>("long_term_formal");
  const [course, setCourse] = useState<ClassBuildCourseDetail | null>(null);
  const [courseSessions, setCourseSessions] = useState<ClassBuildLecture[]>([]);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [primaryTeacherId, setPrimaryTeacherId] = useState("");
  const [learningSupportId, setLearningSupportId] = useState("");
  const [schoolTermId, setSchoolTermId] = useState("");
  const [startDate, setStartDate] = useState(() => calendarDayKey(new Date(), timeZone));
  const [weekdays, setWeekdays] = useState<Set<number>>(() => new Set());
  const [time, setTime] = useState("19:00");
  const [durationMin, setDurationMin] = useState(String(defaultDurationMinutes));
  const [freeSessionTitle, setFreeSessionTitle] = useState("");
  const [freeSessions, setFreeSessions] = useState<FreeSessionDraft[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ClassBuildScheduleConflict[]>([]);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [calendarEntries, setCalendarEntries] = useState<TeachingCalendarEntryV2[]>([]);
  const [calendarLoadedKey, setCalendarLoadedKey] = useState("");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarLoadFailed, setCalendarLoadFailed] = useState(false);
  const [pendingClosedDayBuild, setPendingClosedDayBuild] = useState<PendingClosedDayBuild | null>(null);
  const [closedDayReasons, setClosedDayReasons] = useState<Record<string, string>>({});
  const [activateNow, setActivateNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdClassroomId, setCreatedClassroomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attemptedSteps, setAttemptedSteps] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (!initialCourseId || initialCourseHandled.current) return;
    initialCourseHandled.current = true;
    void getClassBuildCourseDetailAction(initialCourseId, "production")
      .then((detail) => {
        setCourse(detail);
        setCourseSessions(detail.lectures);
        setMode("course");
      })
      .catch(() => setNotice(t("initialCourseUnavailable")));
  }, [initialCourseId, t]);

  const lectures = useMemo(() => mode === "course" ? courseSessions : [], [courseSessions, mode]);
  const scheduleSlots = useMemo(() => mode === "course"
    ? lectures.map((lecture) => ({ lectureId: lecture.id, no: lecture.no, name: lecture.name }))
    : freeSessions.map((session, index) => ({ lectureId: session.key, no: index + 1, name: session.name })),
  [freeSessions, lectures, mode]);
  const resolvedName = name.trim() || course?.title || "";
  const capacityNumber = capacity === "" ? null : Number(capacity);
  const classNameValid = resolvedName.length > 0 && resolvedName.length <= 100;
  const capacityValid = capacityNumber === null || (Number.isInteger(capacityNumber) && capacityNumber >= 1 && capacityNumber <= 500);
  const primaryTeacherValid = primaryTeacherId !== "";
  const learningSupportValid = learningSupportId === "" || learningSupportId !== primaryTeacherId;
  const startDateValid = validDateInput(startDate);
  const timeValid = TIME_INPUT_PATTERN.test(time);
  const durationNumber = Number(durationMin);
  const durationValid = durationMin !== "" && Number.isInteger(durationNumber) && durationNumber >= 10 && durationNumber <= 600;
  const scheduleInputsValid = startDateValid && timeValid && durationValid;
  const calendarRequestKey = scheduleSlots.length > 0 && startDateValid
    ? `${startDate}:${scheduleSlots.length}`
    : "";
  const calendarReady = calendarRequestKey === "" || (calendarLoadedKey === calendarRequestKey && !calendarLoadFailed);
  const roomCampusId = roomId ? roomOptions.find((room) => room.id === roomId)?.campusId ?? null : null;
  const courseSessionsAreDefault = Boolean(
    course
      && course.lectures.length === courseSessions.length
      && course.lectures.every((lecture, index) => lecture.id === courseSessions[index]?.id),
  );
  const hasScheduleOverrides = scheduleSlots.some((slot) => overrides[slot.lectureId] !== undefined);

  useEffect(() => {
    if (!calendarRequestKey) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setCalendarLoading(true);
      setCalendarLoadFailed(false);
      void getClassScheduleCalendarAction(startDate, scheduleSlots.length)
        .then((rows) => {
          if (!active) return;
          setCalendarEntries(rows);
          setCalendarLoadedKey(calendarRequestKey);
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
  }, [calendarRequestKey, scheduleSlots.length, startDate]);

  const preview = useMemo(() => {
    if (scheduleSlots.length === 0 || weekdays.size === 0 || !scheduleInputsValid || !calendarReady) return [];
    const [hours, minutes] = time.split(":").map(Number);
    return generateSchedulePreview(scheduleSlots, startDate, Array.from(weekdays), hours, minutes, durationNumber, timeZone, {
      entries: calendarEntries,
      campusId: roomCampusId,
    });
  }, [calendarEntries, calendarReady, durationNumber, roomCampusId, scheduleInputsValid, scheduleSlots, startDate, time, timeZone, weekdays]);
  const conflictSlots = useMemo(() => preview.map((item) => ({
    scheduledAt: overrides[item.lectureId] ?? item.scheduledAt.toISOString(),
    durationMin: item.durationMin,
  })), [overrides, preview]);

  useEffect(() => {
    if (!primaryTeacherId || conflictSlots.length === 0) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setConflictsLoading(true);
      void getClassBuildConflictsAction(primaryTeacherId, roomId, conflictSlots)
        .then((rows) => { if (active) setConflicts(rows); })
        .catch(() => { if (active) setConflicts([]); })
        .finally(() => { if (active) setConflictsLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [conflictSlots, primaryTeacherId, roomId]);

  const selectedReadyCount = lectures.filter((lecture) => lecture.ready).length;
  const isReady = lectures.length > 0 && selectedReadyCount === lectures.length;
  const conflictsRelevant = Boolean(primaryTeacherId && conflictSlots.length > 0);
  const visibleConflicts = conflictsRelevant ? conflicts : [];
  const visibleConflictsLoading = conflictsRelevant && conflictsLoading;
  const scheduleRequired = mode === "course" || freeSessions.length > 0;
  const step1Complete = mode === "free" || (course !== null && courseSessions.length > 0);
  const step2Complete = classNameValid && primaryTeacherValid && capacityValid && learningSupportValid;
  const step3Complete = Boolean(schoolTermId) && (!scheduleRequired || (
    scheduleInputsValid
    && weekdays.size > 0
    && calendarReady
    && preview.length === scheduleSlots.length
  ));
  const step1Attempted = attemptedSteps.has(1);
  const step2Attempted = attemptedSteps.has(2);
  const step3Attempted = attemptedSteps.has(3);

  const markStepAttempted = (targetStep: number) => {
    setAttemptedSteps((current) => {
      const next = new Set(current);
      next.add(targetStep);
      return next;
    });
  };

  const advance = () => {
    const complete = step === 1 ? step1Complete : step === 2 ? step2Complete : step3Complete;
    markStepAttempted(step);
    if (complete) setStep((current) => Math.min(4, current + 1));
  };

  const goToStep = (targetStep: number) => {
    if (targetStep <= step) {
      setStep(targetStep);
      return;
    }
    if (targetStep === step + 1) advance();
  };

  const updateCourse = (next: ClassBuildCourseDetail) => {
    if (course && course.id !== next.id && Object.keys(overrides).length > 0) setNotice(t("overridesCleared"));
    setCourse(next);
    setCourseSessions(next.lectures);
    setMode("course");
    setOverrides({});
    setActivateNow(false);
  };

  const clearCourse = () => {
    if (course && Object.keys(overrides).length > 0) setNotice(t("overridesCleared"));
    setCourse(null);
    setCourseSessions([]);
    setOverrides({});
    setActivateNow(false);
  };

  const moveCourseSession = (lectureId: string, direction: -1 | 1) => {
    setCourseSessions((current) => {
      const index = current.findIndex((lecture) => lecture.id === lectureId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setActivateNow(false);
  };

  const removeCourseSession = (lectureId: string) => {
    setCourseSessions((current) => current.filter((lecture) => lecture.id !== lectureId));
    setOverrides((current) => {
      const next = { ...current };
      delete next[lectureId];
      return next;
    });
    setActivateNow(false);
  };

  const restoreCourseSessions = () => {
    if (!course) return;
    setCourseSessions(course.lectures);
    setOverrides({});
    setNotice(t("defaultLecturesRestored"));
    setActivateNow(false);
  };

  const setClassPurpose = (next: ClassBuildPurpose) => {
    if (purpose === next) return;
    setPurpose(next);
    clearCourse();
    setNotice(t("purposeChanged"));
  };

  const toggleWeekday = (day: number) => {
    setWeekdays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
    setActivateNow(false);
  };

  const updatePrimaryTeacher = (value: string) => {
    setPrimaryTeacherId(value);
    if (learningSupportId === value) {
      setLearningSupportId("");
      setNotice(t("learningSupportCleared"));
    }
    setActivateNow(false);
  };

  const addFreeSession = () => {
    if (!freeSessionTitle.trim() || !scheduleInputsValid || weekdays.size === 0) return;
    setFreeSessions((current) => [...current, {
      key: `free-${Date.now()}-${freeSessionSequence.current++}`,
      name: freeSessionTitle.trim(),
    }]);
    setFreeSessionTitle("");
    setActivateNow(false);
  };

  const removeFreeSession = (key: string) => {
    setFreeSessions((current) => current.filter((session) => session.key !== key));
    setOverrides((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setActivateNow(false);
  };

  const updateScheduleOverride = (key: string, value: string, automaticAt: Date) => {
    const instant = value ? dateTimeInputToInstant(value, timeZone) : null;
    setOverrides((current) => ({ ...current, [key]: instant?.toISOString() ?? automaticAt.toISOString() }));
    setActivateNow(false);
  };

  const resetScheduleOverride = (key: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setActivateNow(false);
  };

  const resetAllScheduleOverrides = () => {
    setOverrides({});
    setActivateNow(false);
  };

  const performBuild = async (input: BuildClassInput) => {
    setSubmitting(true);
    setCreatedClassroomId(null);
    setError(null);
    try {
      const classroomId = await buildClass(input);
      const href = `/dashboard/classes/${classroomId}` as const;
      const localizedHref = `/${locale}${href}`;
      setCreatedClassroomId(classroomId);
      setPendingClosedDayBuild(null);
      window.requestAnimationFrame(() => {
        router.replace(href);
        window.setTimeout(() => {
          if (window.location.pathname !== localizedHref) window.location.assign(localizedHref);
        }, 1_200);
      });
    } catch {
      setError(t("submitFailed"));
      setSubmitting(false);
    }
  };

  const submit = async () => {
    if (!step1Complete) {
      markStepAttempted(1);
      setStep(1);
      return;
    }
    if (!step2Complete) {
      markStepAttempted(2);
      setStep(2);
      return;
    }
    if (!step3Complete) {
      markStepAttempted(3);
      setStep(3);
      return;
    }
    setSubmitting(true);
    setCreatedClassroomId(null);
    setError(null);
    try {
      const keyedSessions: Array<{ key: string; session: BuildClassSession }> = preview.map((item) => ({
        key: item.lectureId,
        session: {
          lectureId: mode === "course" ? item.lectureId : null,
          no: mode === "course" ? item.no : null,
          name: item.name,
          scheduledAt: overrides[item.lectureId] ?? item.scheduledAt.toISOString(),
          durationMin: item.durationMin,
        },
      }));
      const input: BuildClassInput = {
        name: resolvedName,
        courseId: mode === "course" ? course?.id ?? null : null,
        capacity: capacityNumber,
        roomId,
        primaryTeacherId,
        learningSupportId: learningSupportId || null,
        schoolTermId,
        purpose,
        offeringType,
        activateNow,
        sessions: keyedSessions.map((item) => item.session),
      };
      const calendarRows = await getClassBuildCalendarPreviewAction(
        roomId,
        keyedSessions.map((item) => ({ key: item.key, scheduledAt: item.session.scheduledAt })),
      );
      const closedRows = calendarRows.filter((row) => row.entry?.kind === "closed");
      if (closedRows.length > 0) {
        setPendingClosedDayBuild({
          input,
          sessionKeys: keyedSessions.map((item) => item.key),
          rows: closedRows,
        });
        setSubmitting(false);
        return;
      }
      await performBuild(input);
    } catch {
      setError(t("submitFailed"));
      setSubmitting(false);
    }
  };

  const closedDayReasonsComplete = pendingClosedDayBuild
    ? pendingClosedDayBuild.rows.every((row) => {
        const length = closedDayReasons[row.key]?.trim().length ?? 0;
        return length >= 1 && length <= 500;
      })
    : false;

  const confirmClosedDayBuild = () => {
    if (!pendingClosedDayBuild || !closedDayReasonsComplete) return;
    const sessions = pendingClosedDayBuild.input.sessions.map((session, index) => ({
      ...session,
      closedDayReason: closedDayReasons[pendingClosedDayBuild.sessionKeys[index]]?.trim() || "",
    }));
    void performBuild({ ...pendingClosedDayBuild.input, sessions });
  };

  const steps = [t("stepCourse"), t("stepInfo"), t("stepSchedule"), t("stepConfirm")];

  return <div className="space-y-5">
    <ol className="grid gap-2 sm:grid-cols-4" aria-label={t("wizardSteps")}>
      {steps.map((label, index) => {
        const number = index + 1;
        return <li key={label}><Button type="button" variant="secondary" onClick={() => goToStep(number)} aria-current={step === number ? "step" : undefined} className={cn("w-full justify-start", step === number && "border-moon bg-moon/50 font-medium text-ink")}>{number}. {label}</Button></li>;
      })}
    </ol>

    {notice && <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{notice}</p>}

    {step === 1 && <section className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-medium text-ink">{t("stepCourse")}</h2><p className="mt-1 text-sm text-muted">{t("courseStepHint")}</p></div>{purpose === "test" && <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300">{t("testBadge")}</Badge>}</div>
      <div className="mt-5">
        <Label className="text-xs font-normal text-muted">{t("purpose")}</Label>
        <div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="secondary" aria-pressed={purpose === "production"} onClick={() => setClassPurpose("production")} className={cn(purpose === "production" && "border-moon bg-moon/50 font-medium text-ink")}>{t("production")}</Button><Button type="button" variant="secondary" aria-pressed={purpose === "test"} onClick={() => setClassPurpose("test")} className={cn(purpose === "test" && "border-moon bg-moon/50 font-medium text-ink")}>{t("test")}</Button></div>
      </div>
      <div className="mt-5">
        <Label className="text-xs font-normal text-muted">{t("offeringType")}</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" aria-pressed={offeringType === "long_term_formal"} onClick={() => setOfferingType("long_term_formal")} className={cn(offeringType === "long_term_formal" && "border-moon bg-moon/50 font-medium text-ink")}>{t("offering_long_term_formal")}</Button>
          <Button type="button" variant="secondary" aria-pressed={offeringType === "short_term_topic"} onClick={() => setOfferingType("short_term_topic")} className={cn(offeringType === "short_term_topic" && "border-moon bg-moon/50 font-medium text-ink")}>{t("offering_short_term_topic")}</Button>
        </div>
        <p className="mt-2 text-xs text-muted">{t(offeringType === "long_term_formal" ? "offeringLongTermHint" : "offeringShortTermHint")}</p>
      </div>
      <div className="mt-5"><Label className="text-xs font-normal text-muted">{t("course")}</Label><div className="mt-1"><CoursePicker purpose={purpose} selected={course} onSelect={updateCourse} onClear={clearCourse} /></div></div>
      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4"><span className="text-sm text-muted">{t("or")}</span><Button type="button" variant={mode === "free" ? "secondary" : "ghost"} onClick={() => { clearCourse(); setMode("free"); }}>{t("modeFree")}</Button></div>
      {step1Attempted && !step1Complete && <p role="alert" className="mt-3 text-xs text-rose">{t(course ? "lecturesRequired" : "courseRequired")}</p>}
      {mode === "free" && <p className="mt-3 rounded-xl bg-moon/30 px-3 py-2 text-sm text-muted">{t("freeClassHint")}</p>}
      {course && <div className="mt-5 rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{course.familyTitle} · {course.title}</h3>{isReady ? <Badge variant="secondary">{t("ready")}</Badge> : <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">{t("incomplete")}</Badge>}</div>
        <p className="mt-1 text-sm text-muted">{t("courseSummary", { code: course.productCode || "—", ready: course.releasedLectureCount, total: course.lectureCount })}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium text-ink">{t("classLecturePlan")}</h4>
            <p className="mt-0.5 text-xs text-muted">{t("selectedLectureCount", { selected: courseSessions.length, total: course.lectures.length })}</p>
          </div>
          <Button type="button" size="sm" variant="secondary" disabled={courseSessionsAreDefault} onClick={restoreCourseSessions}>
            <RotateCcw className="size-4" />{t("restoreDefaultLectures")}
          </Button>
        </div>
        {courseSessions.length > 0 ? <ol className="mt-3 divide-y divide-line/70 text-sm">{courseSessions.map((lecture, index) => <li key={lecture.id} className="flex min-w-0 items-center gap-2 py-2 first:pt-0 last:pb-0">
          <span className="w-7 shrink-0 font-mono text-xs text-muted">{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{lecture.name}</span>
            <span className="block text-xs text-muted">{t("sourceLectureNo", { no: lecture.no })}{!lecture.ready ? ` · ${t("notReady")}` : ""}</span>
          </span>
          <Button type="button" size="sm" variant="ghost" className="size-8 p-0" disabled={index === 0} aria-label={t("moveLectureUp", { title: lecture.name })} onClick={() => moveCourseSession(lecture.id, -1)}><ArrowUp className="size-4" /></Button>
          <Button type="button" size="sm" variant="ghost" className="size-8 p-0" disabled={index === courseSessions.length - 1} aria-label={t("moveLectureDown", { title: lecture.name })} onClick={() => moveCourseSession(lecture.id, 1)}><ArrowDown className="size-4" /></Button>
          <Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label={t("removeCourseLecture", { title: lecture.name })} onClick={() => removeCourseSession(lecture.id)}><Trash2 className="size-4 text-rose" /></Button>
        </li>)}</ol> : <p role="status" className="mt-3 text-sm text-muted">{t("noLecturesSelected")}</p>}
      </div>}
    </section>}

    {step === 2 && <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="text-base font-medium text-ink">{t("stepInfo")}</h2><p className="mt-1 text-sm text-muted">{t("infoStepHint")}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="class-name" className="text-xs font-normal text-muted">{t("name")}</Label>
          <Input id="class-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={course?.title ?? t("namePlaceholder")} maxLength={100} aria-invalid={step2Attempted && !classNameValid} aria-describedby={step2Attempted && !classNameValid ? "class-name-error" : undefined} className={cn("mt-1", inputClass)} />
          {step2Attempted && !classNameValid && <p id="class-name-error" role="alert" className="mt-1 text-xs text-rose">{t("classNameRequired")}</p>}
        </div>
        <div>
          <Label htmlFor="primary-teacher" className="text-xs font-normal text-muted">{t("primaryTeacher")}</Label>
          <Select value={primaryTeacherId} onValueChange={updatePrimaryTeacher}>
            <SelectTrigger id="primary-teacher" aria-required="true" aria-invalid={step2Attempted && !primaryTeacherValid} aria-describedby={step2Attempted && !primaryTeacherValid ? "primary-teacher-error" : undefined} className="mt-1"><SelectValue placeholder={t("chooseTeacher")} /></SelectTrigger>
            <SelectContent>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>)}</SelectContent>
          </Select>
          {step2Attempted && !primaryTeacherValid && <p id="primary-teacher-error" role="alert" className="mt-1 text-xs text-rose">{t("primaryTeacherRequired")}</p>}
        </div>
        <div>
          <Label htmlFor="learning-support" className="text-xs font-normal text-muted">{t("learningSupport")}</Label>
          <Select value={learningSupportId || "__none__"} onValueChange={(value) => setLearningSupportId(value === "__none__" ? "" : value)}>
            <SelectTrigger id="learning-support" aria-invalid={!learningSupportValid} aria-describedby="learning-support-hint" className="mt-1"><SelectValue placeholder={t("noLearningSupport")} /></SelectTrigger>
            <SelectContent><SelectItem value="__none__">{t("noLearningSupport")}</SelectItem>{teachers.filter((teacher) => teacher.id !== primaryTeacherId).map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>)}</SelectContent>
          </Select>
          <p id="learning-support-hint" className="mt-1 text-xs text-muted">{t("learningSupportOptional")}</p>
          {!learningSupportValid && <p role="alert" className="mt-1 text-xs text-rose">{t("learningSupportConflict")}</p>}
        </div>
        <div>
          <Label htmlFor="class-capacity" className="text-xs font-normal text-muted">{t("capacity")}</Label>
          <Input id="class-capacity" type="number" min={1} max={500} step={1} value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder={t("capacityPlaceholder")} aria-invalid={!capacityValid} aria-describedby={!capacityValid ? "class-capacity-error" : undefined} className={cn("mt-1", inputClass)} />
          {!capacityValid && <p id="class-capacity-error" role="alert" className="mt-1 text-xs text-rose">{t("capacityInvalid")}</p>}
        </div>
        <div className="md:col-span-2"><Label htmlFor="class-room" className="text-xs font-normal text-muted">{t("room")}</Label><div className="mt-1"><RoomPicker id="class-room" rooms={roomOptions} value={roomId} onValueChange={setRoomId} capacity={capacityNumber} /></div></div>
      </div>
      <div className="mt-4 grid gap-1 text-sm text-muted sm:grid-cols-2">
        <p>{t("purposeSummary", { purpose: purpose === "test" ? t("test") : t("production") })}</p>
        <p>{t("offeringTypeSummary", { offeringType: t(`offering_${offeringType}`) })}</p>
      </div>
    </section>}

    {step === 3 && <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="text-base font-medium text-ink">{t("stepSchedule")}</h2><p className="mt-1 text-sm text-muted">{t("scheduleStepHint")}</p>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-sm font-medium text-ink">{t("batchScheduleTitle")}</h3><p className="mt-1 text-xs text-muted">{t("batchScheduleHint", { count: scheduleSlots.length })}</p></div>
        {hasScheduleOverrides ? <Button type="button" size="sm" variant="secondary" onClick={resetAllScheduleOverrides}><RotateCcw className="size-4" />{t("restoreBatchSchedule")}</Button> : null}
      </div>
      <div className="mt-3 grid gap-4 @2xl/page:grid-cols-2 @6xl/page:grid-cols-4">
        <div>
          <Label htmlFor="school-term" className="text-xs font-normal text-muted">{t("schoolTerm")}</Label>
          <Select value={schoolTermId} onValueChange={setSchoolTermId}><SelectTrigger id="school-term" aria-required="true" aria-invalid={step3Attempted && !schoolTermId} aria-describedby={step3Attempted && !schoolTermId ? "school-term-error" : undefined} className="mt-1"><SelectValue placeholder={t("chooseSchoolTerm")} /></SelectTrigger><SelectContent>{schoolTerms.map((term) => <SelectItem key={term.id} value={term.id}>{schoolTermLabel(term, scheduleT(`period${term.term}`))}{term.isCurrent ? ` · ${t("current")}` : ""}</SelectItem>)}</SelectContent></Select>
          {step3Attempted && !schoolTermId && <p id="school-term-error" role="alert" className="mt-1 text-xs text-rose">{t("schoolTermRequired")}</p>}
        </div>
        <div>
          <Label htmlFor="schedule-start" className="text-xs font-normal text-muted">{t("startDate")}</Label>
          <DateTimePicker id="schedule-start" value={startDate} onValueChange={setStartDate} aria-invalid={scheduleRequired && step3Attempted && !startDateValid} aria-describedby={scheduleRequired && step3Attempted && !startDateValid ? "schedule-start-error" : undefined} className={cn("mt-1", inputClass)} />
          {scheduleRequired && step3Attempted && !startDateValid && <p id="schedule-start-error" role="alert" className="mt-1 text-xs text-rose">{t("startDateRequired")}</p>}
        </div>
        <div>
          <Label htmlFor="schedule-time" className="text-xs font-normal text-muted">{t("time")}</Label>
          <DateTimePicker id="schedule-time" mode="time" value={time} onValueChange={setTime} aria-invalid={scheduleRequired && step3Attempted && !timeValid} aria-describedby={scheduleRequired && step3Attempted && !timeValid ? "schedule-time-error" : undefined} className={cn("mt-1", inputClass)} />
          {scheduleRequired && step3Attempted && !timeValid && <p id="schedule-time-error" role="alert" className="mt-1 text-xs text-rose">{t("timeRequired")}</p>}
        </div>
        <div>
          <Label htmlFor="schedule-duration" className="text-xs font-normal text-muted">{t("duration")}</Label>
          <Input id="schedule-duration" type="number" min={10} max={600} step={5} value={durationMin} onChange={(event) => setDurationMin(event.target.value)} aria-invalid={scheduleRequired && !durationValid} aria-describedby={scheduleRequired && !durationValid ? "schedule-duration-error" : undefined} className={cn("mt-1", inputClass)} />
          {scheduleRequired && !durationValid && <p id="schedule-duration-error" role="alert" className="mt-1 text-xs text-rose">{t("durationInvalid")}</p>}
        </div>
      </div>
      <div className="mt-5">
        <Label className="text-xs font-normal text-muted">{t("weekdays")}</Label>
        <div className="mt-2 flex flex-wrap gap-2">{WEEKDAYS.map((day) => <Button key={day} type="button" variant={weekdays.has(day) ? "primary" : "secondary"} aria-pressed={weekdays.has(day)} onClick={() => toggleWeekday(day)}>{t(`weekday_${day}`)}</Button>)}</div>
        {scheduleRequired && step3Attempted && weekdays.size === 0 && <p role="alert" className="mt-2 text-xs text-rose">{t("weekdaysRequired")}</p>}
      </div>
      {!roomId && scheduleSlots.length > 0 && <p className="mt-3 rounded-xl bg-moon/25 px-3 py-2 text-xs text-muted">{t("roomTbdCalendarHint")}</p>}
      {scheduleSlots.length > 0 && calendarLoading && <p className="mt-3 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{t("calendarLoading")}</p>}
      {scheduleSlots.length > 0 && calendarLoadFailed && <p role="alert" className="mt-3 text-sm text-rose">{t("calendarLoadFailed")}</p>}
      {mode === "course" ? <>
        {preview.length > 0 && <DashboardTableShell className="mt-5"><Table><TableHeader><TableRow><TableHead className="w-16">{t("scheduleOrder")}</TableHead><TableHead>{t("lectureName")}</TableHead><TableHead>{t("scheduledAt")}</TableHead><TableHead className="w-28" /></TableRow></TableHeader><TableBody>{preview.map((item, index) => <TableRow key={item.lectureId}><TableCell className="font-mono text-xs text-muted">{index + 1}</TableCell><TableCell><span className="block">{item.name}</span><span className="text-xs text-muted">{t("sourceLectureNo", { no: item.no })}</span></TableCell><TableCell><DateTimePicker mode="datetime" value={zonedDateTimeInputValue(new Date(overrides[item.lectureId] ?? item.scheduledAt.toISOString()), timeZone)} onValueChange={(value) => updateScheduleOverride(item.lectureId, value, item.scheduledAt)} className="h-8 max-w-60 text-xs" /></TableCell><TableCell>{overrides[item.lectureId] !== undefined ? <Button type="button" size="sm" variant="ghost" onClick={() => resetScheduleOverride(item.lectureId)}><RotateCcw className="size-3.5" />{t("useBatchTime")}</Button> : <span className="text-xs text-muted">{t("batchTime")}</span>}</TableCell></TableRow>)}</TableBody></Table></DashboardTableShell>}
      </> : <div className="mt-5 space-y-4">
        <p className="rounded-xl bg-moon/30 px-3 py-2 text-sm text-muted">{t("freeScheduleHint")}</p>
        <div className="flex flex-col gap-3 rounded-xl border border-line p-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="free-session-title" className="text-xs font-normal text-muted">{t("freeSessionTitle")}</Label>
            <Input id="free-session-title" value={freeSessionTitle} onChange={(event) => setFreeSessionTitle(event.target.value)} maxLength={100} placeholder={t("freeSessionTitlePlaceholder")} className={cn("mt-1", inputClass)} />
          </div>
          <Button type="button" onClick={addFreeSession} disabled={!freeSessionTitle.trim() || !scheduleInputsValid || weekdays.size === 0}>
            <Plus className="size-4" />{t("addSession")}
          </Button>
        </div>
        {preview.length > 0 && <DashboardTableShell><Table><TableHeader><TableRow><TableHead className="w-16">{t("scheduleOrder")}</TableHead><TableHead>{t("lectureName")}</TableHead><TableHead>{t("scheduledAt")}</TableHead><TableHead className="w-44" /></TableRow></TableHeader><TableBody>{preview.map((item) => <TableRow key={item.lectureId}><TableCell className="font-mono text-xs text-muted">{item.no}</TableCell><TableCell>{item.name}</TableCell><TableCell><DateTimePicker mode="datetime" value={zonedDateTimeInputValue(new Date(overrides[item.lectureId] ?? item.scheduledAt.toISOString()), timeZone)} onValueChange={(value) => updateScheduleOverride(item.lectureId, value, item.scheduledAt)} className="h-8 max-w-60 text-xs" /></TableCell><TableCell><div className="flex items-center justify-end gap-1">{overrides[item.lectureId] !== undefined ? <Button type="button" size="sm" variant="ghost" onClick={() => resetScheduleOverride(item.lectureId)}><RotateCcw className="size-3.5" />{t("useBatchTime")}</Button> : null}<Button type="button" size="sm" variant="ghost" className="px-2" aria-label={t("removeSession")} onClick={() => removeFreeSession(item.lectureId)}><Trash2 className="size-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table></DashboardTableShell>}
      </div>}
      {visibleConflictsLoading && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("checkingConflicts")}</p>}
      {!visibleConflictsLoading && visibleConflicts.length > 0 && <div role="alert" className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />{t("conflictsFound", { count: visibleConflicts.length })}</p><ul className="mt-2 space-y-1 text-xs">{visibleConflicts.map((conflict) => <li key={conflict.sessionId}>{conflict.classroomName} · {conflict.lectureName} · {new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(conflict.scheduledAt))} · {[conflict.teacherConflict ? t("teacherConflict") : null, conflict.roomConflict ? formatRoomLocation(conflict.roomName, conflict.campusName, t("roomTbd")) : null].filter(Boolean).join(" / ")}</li>)}</ul></div>}
      {!visibleConflictsLoading && primaryTeacherId && conflictSlots.length > 0 && visibleConflicts.length === 0 && <p className="mt-4 flex items-center gap-2 text-sm text-leaf"><CheckCircle2 className="size-4" />{t("noScheduleConflicts")}</p>}
    </section>}

    {step === 4 && <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="text-base font-medium text-ink">{t("stepConfirm")}</h2><p className="mt-1 text-sm text-muted">{t("confirmStepHint")}</p>
      <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">{t("course")}</dt><dd className="mt-1 font-medium">{mode === "free" ? t("modeFree") : `${course?.familyTitle ?? ""} · ${course?.title ?? ""}`}</dd></div><div><dt className="text-muted">{t("courseReadiness")}</dt><dd className="mt-1">{mode === "free" ? t("notApplicable") : isReady ? t("readyCount", { ready: selectedReadyCount, total: lectures.length }) : <span className="text-amber-800 dark:text-amber-300">{t("incompleteCount", { ready: selectedReadyCount, total: lectures.length })}</span>}</dd></div><div><dt className="text-muted">{t("teacher")}</dt><dd className="mt-1 font-medium">{teachers.find((teacher) => teacher.id === primaryTeacherId)?.name || "—"}</dd></div><div><dt className="text-muted">{t("room")}</dt><dd className="mt-1">{roomId ? formatRoomLocation(roomOptions.find((room) => room.id === roomId)?.name ?? null, roomOptions.find((room) => room.id === roomId)?.campusName ?? null, t("roomTbd")) : t("roomTbd")}</dd></div><div><dt className="text-muted">{t("conflicts")}</dt><dd className="mt-1">{visibleConflictsLoading ? t("checking") : visibleConflicts.length ? t("conflictsFound", { count: visibleConflicts.length }) : t("noScheduleConflicts")}</dd></div><div><dt className="text-muted">{t("sessionCount")}</dt><dd className="mt-1">{mode === "course" ? preview.length : freeSessions.length}</dd></div><div><dt className="text-muted">{t("purpose")}</dt><dd className="mt-1">{purpose === "test" ? <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300">{t("testBadge")}</Badge> : t("production")}</dd></div><div><dt className="text-muted">{t("offeringType")}</dt><dd className="mt-1">{t(`offering_${offeringType}`)}</dd></div></dl>
      {purpose === "production" && !isReady && mode === "course" && <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">{t("productionActivationWarning")}</p>}
      {purpose === "test" && !isReady && <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">{t("testActivationWarning")}</p>}
      <div className="mt-5 flex items-start gap-3"><Checkbox id="activate-now" checked={activateNow} onCheckedChange={(value) => setActivateNow(value === true)} /><div><Label htmlFor="activate-now" className="cursor-pointer">{t("activateNow")}</Label><p className="mt-1 text-xs text-muted">{t("activateNowHint")}</p></div></div>
    </section>}

    {createdClassroomId && <p role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-leaf/40 bg-leaf/15 px-3 py-2 text-sm text-ink"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{t("createdRedirecting")}<Link href={`/dashboard/classes/${createdClassroomId}`} className="font-medium underline underline-offset-2">{t("openCreatedClass")}</Link></p>}
    {error && <p role="alert" className="text-sm text-rose">{error}</p>}
    <div className="flex items-center justify-between gap-3"><Button type="button" variant="secondary" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || submitting}><ChevronLeft className="size-4" />{t("previousStep")}</Button>{step < 4 ? <Button type="button" onClick={advance} disabled={submitting}>{t("nextStep")}<ChevronRight className="size-4" /></Button> : <Button type="button" onClick={() => void submit()} disabled={submitting}>{submitting && <LoaderCircle className="size-4 animate-spin" />}{submitting ? t("submitting") : t("submit")}</Button>}</div>

    <Dialog open={pendingClosedDayBuild !== null} onOpenChange={(open) => { if (!open && !submitting) setPendingClosedDayBuild(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("closedDayReviewTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">{t("closedDayReviewDescription", { count: pendingClosedDayBuild?.rows.length ?? 0 })}</p>
        <div className="space-y-4">
          {pendingClosedDayBuild?.rows.map((row) => {
            const sessionIndex = pendingClosedDayBuild.sessionKeys.indexOf(row.key);
            const session = pendingClosedDayBuild.input.sessions[sessionIndex];
            return <div key={row.key} className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="font-medium text-ink">{session?.name ?? row.day}</p>
              <p className="mt-1 text-xs text-muted">{row.day} · {row.entry?.name}</p>
              <Label htmlFor={`closed-day-reason-${row.key}`} className="mt-3 block text-xs font-normal text-muted">{t("closedDayReason")}</Label>
              <Textarea
                id={`closed-day-reason-${row.key}`}
                value={closedDayReasons[row.key] ?? ""}
                onChange={(event) => setClosedDayReasons((current) => ({ ...current, [row.key]: event.target.value }))}
                maxLength={500}
                rows={2}
                placeholder={t("closedDayReasonPlaceholder")}
                aria-required="true"
              />
            </div>;
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={submitting} onClick={() => setPendingClosedDayBuild(null)}>{t("cancel")}</Button>
          <Button type="button" disabled={submitting || !closedDayReasonsComplete} onClick={confirmClosedDayBuild}>
            {submitting && <LoaderCircle className="size-4 animate-spin" />}{t("confirmClosedDayBuild")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
