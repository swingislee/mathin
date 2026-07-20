"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { buildClass, getClassBuildConflictsAction, getClassBuildCourseDetailAction } from "./actions/classes";
import type { BuildClassSession } from "./actions/types";
import type { StaffOption } from "./classes";
import type { SchoolTermRow } from "./courses";
import { inputClass } from "./controls";
import { generateSchedulePreview } from "./schedule-preview";
import { CoursePicker } from "./teaching-operations/CoursePicker";
import type { ClassBuildCourseDetail, ClassBuildPurpose, ClassBuildScheduleConflict } from "./teaching-operations/course-picker-types";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDateTimeLocalValue(date: Date): string {
  return `${toDateInputValue(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function courseReady(course: ClassBuildCourseDetail | null) {
  return Boolean(course && course.lectureCount > 0 && course.lectureCount === course.releasedLectureCount);
}

export function ClassBuildWizard({
  schoolTerms,
  teachers,
  initialCourseId,
}: {
  schoolTerms: SchoolTermRow[];
  teachers: StaffOption[];
  initialCourseId?: string;
}) {
  const t = useTranslations("school.classBuild");
  const router = useRouter();
  const initialCourseHandled = useRef(false);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"course" | "free">("course");
  const [purpose, setPurpose] = useState<ClassBuildPurpose>("production");
  const [course, setCourse] = useState<ClassBuildCourseDetail | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [room, setRoom] = useState("");
  const [primaryTeacherId, setPrimaryTeacherId] = useState("");
  const [learningSupportId, setLearningSupportId] = useState("");
  const [schoolTermId, setSchoolTermId] = useState("");
  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date()));
  const [weekdays, setWeekdays] = useState<Set<number>>(() => new Set());
  const [time, setTime] = useState("19:00");
  const [durationMin, setDurationMin] = useState(90);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ClassBuildScheduleConflict[]>([]);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [activateNow, setActivateNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialCourseId || initialCourseHandled.current) return;
    initialCourseHandled.current = true;
    void getClassBuildCourseDetailAction(initialCourseId, "production")
      .then((detail) => { setCourse(detail); setMode("course"); })
      .catch(() => setNotice(t("initialCourseUnavailable")));
  }, [initialCourseId, t]);

  const lectures = useMemo(() => mode === "course" ? course?.lectures ?? [] : [], [course, mode]);
  const preview = useMemo(() => {
    if (mode !== "course" || lectures.length === 0 || weekdays.size === 0) return [];
    const [hours, minutes] = time.split(":").map(Number);
    const slots = lectures.map((lecture) => ({ lectureId: lecture.id, no: lecture.no, name: lecture.name }));
    return generateSchedulePreview(slots, new Date(`${startDate}T00:00:00`), Array.from(weekdays), hours || 0, minutes || 0, durationMin);
  }, [durationMin, lectures, mode, startDate, time, weekdays]);

  useEffect(() => {
    if (!primaryTeacherId || preview.length === 0) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setConflictsLoading(true);
      void getClassBuildConflictsAction(primaryTeacherId, preview.map((item) => ({ scheduledAt: (overrides[item.lectureId] ?? item.scheduledAt.toISOString()), durationMin: item.durationMin })))
        .then((rows) => { if (active) setConflicts(rows); })
        .catch(() => { if (active) setConflicts([]); })
        .finally(() => { if (active) setConflictsLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [overrides, preview, primaryTeacherId]);

  const resolvedName = name.trim() || course?.title || "";
  const isReady = courseReady(course);
  const conflictsRelevant = Boolean(primaryTeacherId && preview.length > 0);
  const visibleConflicts = conflictsRelevant ? conflicts : [];
  const visibleConflictsLoading = conflictsRelevant && conflictsLoading;
  const canActivateNow = !visibleConflictsLoading && visibleConflicts.length === 0 && (purpose === "test" || isReady);
  const step1Complete = mode === "free" || course !== null;
  const step2Complete = Boolean(resolvedName && primaryTeacherId);
  const step3Complete = Boolean(schoolTermId) && (mode === "free" || preview.length > 0);

  const updateCourse = (next: ClassBuildCourseDetail) => {
    if (course && course.id !== next.id && Object.keys(overrides).length > 0) setNotice(t("overridesCleared"));
    setCourse(next);
    setMode("course");
    setOverrides({});
    setActivateNow(false);
  };

  const clearCourse = () => {
    if (course && Object.keys(overrides).length > 0) setNotice(t("overridesCleared"));
    setCourse(null);
    setOverrides({});
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

  const submit = async () => {
    if (!step1Complete || !step2Complete || !step3Complete) return;
    setSubmitting(true);
    setError(null);
    try {
      const sessions: BuildClassSession[] = mode === "course"
        ? preview.map((item) => ({
            lectureId: item.lectureId,
            no: item.no,
            name: item.name,
            scheduledAt: overrides[item.lectureId] ?? item.scheduledAt.toISOString(),
            durationMin: item.durationMin,
          }))
        : [];
      const classroomId = await buildClass({
        name: resolvedName,
        courseId: mode === "course" ? course?.id ?? null : null,
        capacity: capacity ? Number(capacity) : null,
        room: room.trim(),
        primaryTeacherId,
        learningSupportId: learningSupportId || null,
        schoolTermId,
        purpose,
        activateNow,
        sessions,
      });
      router.push(`/dashboard/classes/${classroomId}`);
    } catch {
      setError(t("submitFailed"));
      setSubmitting(false);
    }
  };

  const steps = [t("stepCourse"), t("stepInfo"), t("stepSchedule"), t("stepConfirm")];

  return <div className="space-y-5">
    <ol className="grid gap-2 sm:grid-cols-4" aria-label={t("wizardSteps")}>
      {steps.map((label, index) => {
        const number = index + 1;
        return <li key={label}><Button type="button" variant={step === number ? "primary" : "secondary"} onClick={() => {
          if (number <= step || (number === 2 && step1Complete) || (number === 3 && step1Complete && step2Complete) || (number === 4 && step1Complete && step2Complete && step3Complete)) setStep(number);
        }} aria-current={step === number ? "step" : undefined} className="w-full justify-start">{number}. {label}</Button></li>;
      })}
    </ol>

    {notice && <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{notice}</p>}

    {step === 1 && <section className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium">{t("stepCourse")}</h2><p className="mt-1 text-sm text-muted">{t("courseStepHint")}</p></div>{purpose === "test" && <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300">{t("testBadge")}</Badge>}</div>
      <div className="mt-5">
        <Label className="text-xs font-normal text-muted">{t("purpose")}</Label>
        <div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant={purpose === "production" ? "primary" : "secondary"} onClick={() => setClassPurpose("production")}>{t("production")}</Button><Button type="button" variant={purpose === "test" ? "primary" : "secondary"} onClick={() => setClassPurpose("test")}>{t("test")}</Button></div>
      </div>
      <div className="mt-5"><Label className="text-xs font-normal text-muted">{t("course")}</Label><div className="mt-1"><CoursePicker purpose={purpose} selected={course} onSelect={updateCourse} onClear={clearCourse} /></div></div>
      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4"><span className="text-sm text-muted">{t("or")}</span><Button type="button" variant={mode === "free" ? "secondary" : "ghost"} onClick={() => { clearCourse(); setMode("free"); }}>{t("modeFree")}</Button></div>
      {mode === "free" && <p className="mt-3 rounded-xl bg-moon/30 px-3 py-2 text-sm text-muted">{t("freeClassHint")}</p>}
      {course && <div className="mt-5 rounded-xl border border-line p-4"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{course.familyTitle} · {course.title}</h3>{isReady ? <Badge variant="secondary">{t("ready")}</Badge> : <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">{t("incomplete")}</Badge>}</div><p className="mt-1 text-sm text-muted">{t("courseSummary", { code: course.productCode || "—", ready: course.releasedLectureCount, total: course.lectureCount })}</p><ol className="mt-3 space-y-1.5 text-sm">{course.lectures.map((lecture) => <li key={lecture.id} className="flex gap-2"><span className="w-7 shrink-0 font-mono text-xs text-muted">{lecture.no}</span><span className="min-w-0 flex-1 truncate">{lecture.name}</span>{!lecture.ready && <span className="text-xs text-amber-800 dark:text-amber-300">{t("notReady")}</span>}</li>)}</ol></div>}
    </section>}

    {step === 2 && <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("stepInfo")}</h2><p className="mt-1 text-sm text-muted">{t("infoStepHint")}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div><Label htmlFor="class-name" className="text-xs font-normal text-muted">{t("name")}</Label><Input id="class-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={course?.title ?? t("namePlaceholder")} maxLength={100} className={cn("mt-1", inputClass)} /></div>
        <div><Label className="text-xs font-normal text-muted">{t("primaryTeacher")}</Label><Select value={primaryTeacherId} onValueChange={(value) => { setPrimaryTeacherId(value); setActivateNow(false); }}><SelectTrigger className="mt-1"><SelectValue placeholder={t("chooseTeacher")} /></SelectTrigger><SelectContent>{teachers.map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs font-normal text-muted">{t("learningSupport")}</Label><Select value={learningSupportId || "__none__"} onValueChange={(value) => setLearningSupportId(value === "__none__" ? "" : value)}><SelectTrigger className="mt-1"><SelectValue placeholder={t("noLearningSupport")} /></SelectTrigger><SelectContent><SelectItem value="__none__">{t("noLearningSupport")}</SelectItem>{teachers.filter((teacher) => teacher.id !== primaryTeacherId).map((teacher) => <SelectItem key={teacher.id} value={teacher.id}>{teacher.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label htmlFor="class-capacity" className="text-xs font-normal text-muted">{t("capacity")}</Label><Input id="class-capacity" type="number" min={1} max={500} value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder={t("capacityPlaceholder")} className={cn("mt-1", inputClass)} /></div>
        <div className="md:col-span-2"><Label htmlFor="class-room" className="text-xs font-normal text-muted">{t("room")}</Label><Input id="class-room" value={room} onChange={(event) => setRoom(event.target.value)} maxLength={100} className={cn("mt-1", inputClass)} /></div>
      </div>
      <p className="mt-4 text-sm text-muted">{t("purposeSummary", { purpose: purpose === "test" ? t("test") : t("production") })}</p>
    </section>}

    {step === 3 && <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("stepSchedule")}</h2><p className="mt-1 text-sm text-muted">{t("scheduleStepHint")}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div><Label className="text-xs font-normal text-muted">{t("schoolTerm")}</Label><Select value={schoolTermId} onValueChange={setSchoolTermId}><SelectTrigger className="mt-1"><SelectValue placeholder={t("chooseSchoolTerm")} /></SelectTrigger><SelectContent>{schoolTerms.map((term) => <SelectItem key={term.id} value={term.id}>{term.name}{term.isCurrent ? ` · ${t("current")}` : ""}</SelectItem>)}</SelectContent></Select></div>
        <div><Label htmlFor="schedule-start" className="text-xs font-normal text-muted">{t("startDate")}</Label><Input id="schedule-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={cn("mt-1", inputClass)} /></div>
        <div><Label htmlFor="schedule-time" className="text-xs font-normal text-muted">{t("time")}</Label><Input id="schedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={cn("mt-1", inputClass)} /></div>
        <div><Label htmlFor="schedule-duration" className="text-xs font-normal text-muted">{t("duration")}</Label><Input id="schedule-duration" type="number" min={10} max={600} step={5} value={durationMin} onChange={(event) => setDurationMin(Number(event.target.value) || 90)} className={cn("mt-1", inputClass)} /></div>
      </div>
      {mode === "course" ? <><div className="mt-5"><Label className="text-xs font-normal text-muted">{t("weekdays")}</Label><div className="mt-2 flex flex-wrap gap-2">{WEEKDAYS.map((day) => <Button key={day} type="button" variant={weekdays.has(day) ? "primary" : "secondary"} onClick={() => toggleWeekday(day)}>{t(`weekday_${day}`)}</Button>)}</div></div>
        {preview.length > 0 && <div className="mt-5 overflow-hidden rounded-xl border border-line"><Table><TableHeader><TableRow><TableHead className="w-16">No.</TableHead><TableHead>{t("lectureName")}</TableHead><TableHead>{t("scheduledAt")}</TableHead></TableRow></TableHeader><TableBody>{preview.map((item) => <TableRow key={item.lectureId}><TableCell className="font-mono text-xs text-muted">{item.no}</TableCell><TableCell>{item.name}</TableCell><TableCell><Input type="datetime-local" value={toDateTimeLocalValue(new Date(overrides[item.lectureId] ?? item.scheduledAt.toISOString()))} onChange={(event) => { const value = event.target.value; setOverrides((current) => ({ ...current, [item.lectureId]: value ? new Date(value).toISOString() : item.scheduledAt.toISOString() })); setActivateNow(false); }} className="h-8 max-w-60 text-xs" /></TableCell></TableRow>)}</TableBody></Table></div>}
      </> : <p className="mt-5 rounded-xl bg-moon/30 px-3 py-2 text-sm text-muted">{t("freeScheduleHint")}</p>}
      {visibleConflictsLoading && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("checkingConflicts")}</p>}
      {!visibleConflictsLoading && visibleConflicts.length > 0 && <div role="alert" className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />{t("conflictsFound", { count: visibleConflicts.length })}</p><ul className="mt-2 space-y-1 text-xs">{visibleConflicts.map((conflict) => <li key={conflict.sessionId}>{conflict.classroomName} · {conflict.lectureName} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(conflict.scheduledAt))}</li>)}</ul></div>}
      {!visibleConflictsLoading && primaryTeacherId && preview.length > 0 && visibleConflicts.length === 0 && <p className="mt-4 flex items-center gap-2 text-sm text-leaf"><CheckCircle2 className="size-4" />{t("noTeacherConflicts")}</p>}
    </section>}

    {step === 4 && <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="font-medium">{t("stepConfirm")}</h2><p className="mt-1 text-sm text-muted">{t("confirmStepHint")}</p>
      <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">{t("course")}</dt><dd className="mt-1 font-medium">{mode === "free" ? t("modeFree") : `${course?.familyTitle ?? ""} · ${course?.title ?? ""}`}</dd></div><div><dt className="text-muted">{t("courseReadiness")}</dt><dd className="mt-1">{mode === "free" ? t("notApplicable") : isReady ? t("readyCount", { ready: course?.releasedLectureCount ?? 0, total: course?.lectureCount ?? 0 }) : <span className="text-amber-800 dark:text-amber-300">{t("incompleteCount", { ready: course?.releasedLectureCount ?? 0, total: course?.lectureCount ?? 0 })}</span>}</dd></div><div><dt className="text-muted">{t("teacher")}</dt><dd className="mt-1 font-medium">{teachers.find((teacher) => teacher.id === primaryTeacherId)?.name || "—"}</dd></div><div><dt className="text-muted">{t("conflicts")}</dt><dd className="mt-1">{visibleConflictsLoading ? t("checking") : visibleConflicts.length ? t("conflictsFound", { count: visibleConflicts.length }) : t("noTeacherConflicts")}</dd></div><div><dt className="text-muted">{t("sessionCount")}</dt><dd className="mt-1">{preview.length}</dd></div><div><dt className="text-muted">{t("purpose")}</dt><dd className="mt-1">{purpose === "test" ? <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300">{t("testBadge")}</Badge> : t("production")}</dd></div></dl>
      {purpose === "production" && !isReady && mode === "course" && <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">{t("productionPlanningOnly")}</p>}
      {purpose === "test" && !isReady && <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">{t("testActivationWarning")}</p>}
      <div className="mt-5 flex items-start gap-3"><Checkbox id="activate-now" checked={activateNow} onCheckedChange={(value) => setActivateNow(value === true)} disabled={!canActivateNow} /><div><Label htmlFor="activate-now" className={cn("cursor-pointer", !canActivateNow && "text-muted")}>{t("activateNow")}</Label><p className="mt-1 text-xs text-muted">{canActivateNow ? t("activateNowHint") : t("activateNowUnavailable")}</p></div></div>
    </section>}

    {error && <p role="alert" className="text-sm text-rose">{error}</p>}
    <div className="flex items-center justify-between gap-3"><Button type="button" variant="secondary" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || submitting}><ChevronLeft className="size-4" />{t("previousStep")}</Button>{step < 4 ? <Button type="button" onClick={() => setStep((current) => current + 1)} disabled={submitting || (step === 1 && !step1Complete) || (step === 2 && !step2Complete) || (step === 3 && !step3Complete)}>{t("nextStep")}<ChevronRight className="size-4" /></Button> : <Button type="button" onClick={() => void submit()} disabled={submitting || !step1Complete || !step2Complete || !step3Complete}>{submitting && <LoaderCircle className="size-4 animate-spin" />}{submitting ? t("submitting") : t("submit")}</Button>}</div>
  </div>;
}
