"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Input } from "@/components/ui/input";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { buildClass, type BuildClassSession } from "./actions";
import type { CourseOption, LectureOption, StaffOption } from "./classes";
import { inputClass } from "./controls";
import { generateSchedulePreview } from "./schedule-preview";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const; // 周一...周日（JS getDay() 数值）

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDateTimeLocalValue(date: Date): string {
  return `${toDateInputValue(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function ClassBuildWizard({
  courses,
  lecturesByCourse,
  teachers,
}: {
  courses: CourseOption[];
  lecturesByCourse: Record<string, LectureOption[]>;
  teachers: StaffOption[];
}) {
  const t = useTranslations("school.classBuild");
  const router = useRouter();

  const [mode, setMode] = useState<"course" | "free">(courses.length > 0 ? "course" : "free");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [room, setRoom] = useState("");
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");

  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date()));
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set([1, 3, 5]));
  const [time, setTime] = useState("19:00");
  const [durationMin, setDurationMin] = useState(90);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const course = courses.find((item) => item.id === courseId) ?? null;
  const lectures = useMemo(
    () => (mode === "course" && courseId ? lecturesByCourse[courseId] ?? [] : []),
    [mode, courseId, lecturesByCourse],
  );

  const preview = useMemo(() => {
    if (mode !== "course" || lectures.length === 0) return [];
    const [hh, mm] = time.split(":").map(Number);
    const start = new Date(`${startDate}T00:00:00`);
    const slots = lectures.map((lecture) => ({ lectureId: lecture.id, no: lecture.no, name: lecture.name }));
    return generateSchedulePreview(slots, start, Array.from(weekdays), hh || 0, mm || 0, durationMin);
  }, [mode, lectures, startDate, weekdays, time, durationMin]);

  const toggleWeekday = (day: number) => {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const sessions: BuildClassSession[] =
        mode === "course"
          ? preview.map((row) => ({
              lectureId: row.lectureId,
              no: row.no,
              name: row.name,
              scheduledAt: new Date(overrides[row.lectureId] ?? row.scheduledAt.toISOString()).toISOString(),
              durationMin: row.durationMin,
            }))
          : [];
      const id = await buildClass({
        name: name.trim() || (course?.title ?? ""),
        courseId: mode === "course" ? courseId : null,
        grade: mode === "course" ? course?.grade ?? null : null,
        capacity: capacity ? Number(capacity) : null,
        room: room.trim(),
        teacherId,
        sessions,
      });
      router.push(`/dashboard/classes/${id}`);
    } catch {
      setError(t("submitFailed"));
      setSubmitting(false);
    }
  };


  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-medium">{t("stepBasics")}</h2>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("course")}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${mode === "course" ? "border-ink/60 bg-moon/40" : "border-line text-muted hover:bg-moon/20"}`}
          >
            {t("modeCourse")}
          </button>
          <button
            type="button"
            onClick={() => setMode("free")}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${mode === "free" ? "border-ink/60 bg-moon/40" : "border-line text-muted hover:bg-moon/20"}`}
          >
            {t("modeFree")}
          </button>
        </div>

        {mode === "course" && (
          <div className="mt-4">
            <label className="text-xs text-muted">{t("course")}</label>
            <select value={courseId} onChange={(event) => setCourseId(event.target.value)} className={`mt-1 w-full ${inputClass}`}>
              {courses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} {item.productCode ? `(${item.productCode})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-muted">{t("name")}</label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={course?.title ?? t("namePlaceholder")}
              maxLength={100}
              className={`mt-1 w-full ${inputClass}`}
            />
          </div>
          <div>
            <label className="text-xs text-muted">{t("teacher")}</label>
            <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} className={`mt-1 w-full ${inputClass}`}>
              {teachers.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted">{t("capacity")}</label>
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              placeholder={t("capacityPlaceholder")}
              className={`mt-1 w-full ${inputClass}`}
            />
          </div>
          <div>
            <label className="text-xs text-muted">{t("room")}</label>
            <Input value={room} onChange={(event) => setRoom(event.target.value)} maxLength={100} className={`mt-1 w-full ${inputClass}`} />
          </div>
        </div>
      </section>

      {mode === "course" && (
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="font-medium">{t("stepSchedule")}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-muted">{t("startDate")}</label>
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={`mt-1 w-full ${inputClass}`} />
            </div>
            <div>
              <label className="text-xs text-muted">{t("time")}</label>
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={`mt-1 w-full ${inputClass}`} />
            </div>
            <div>
              <label className="text-xs text-muted">{t("duration")}</label>
              <Input
                type="number"
                min={10}
                step={5}
                value={durationMin}
                onChange={(event) => setDurationMin(Number(event.target.value) || 90)}
                className={`mt-1 w-full ${inputClass}`}
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="text-xs text-muted">{t("weekdays")}</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleWeekday(day)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${weekdays.has(day) ? "border-ink/60 bg-moon/40" : "border-line text-muted hover:bg-moon/20"}`}
                >
                  {t(`weekday_${day}`)}
                </button>
              ))}
            </div>
          </div>

          {preview.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-xl border border-line">
              <Table className="w-full border-collapse text-left text-sm">
                <TableHeader className="border-b border-line text-xs text-muted">
                  <TableRow>
                    <TableHead className="w-16 px-3 py-2 font-medium">No.</TableHead>
                    <TableHead className="px-3 py-2 font-medium">{t("lectureName")}</TableHead>
                    <TableHead className="w-56 px-3 py-2 font-medium">{t("scheduledAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-line">
                  {preview.map((row) => (
                    <TableRow key={row.lectureId}>
                      <TableCell className="px-3 py-2 font-mono text-xs text-muted">{row.no}</TableCell>
                      <TableCell className="px-3 py-2">{row.name}</TableCell>
                      <TableCell className="px-3 py-2">
                        <Input
                          type="datetime-local"
                          defaultValue={toDateTimeLocalValue(row.scheduledAt)}
                          onChange={(event) =>
                            setOverrides((prev) => ({ ...prev, [row.lectureId]: new Date(event.target.value).toISOString() }))
                          }
                          className="px-2 py-1.5 text-xs"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {error && <p className="text-sm text-rose">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={submitting || !teacherId || (mode === "course" && !courseId)}
          onClick={() => void submit()}
          className={cn(buttonVariants({ size: "sm" }), "h-10")}
        >
          {submitting ? t("submitting") : t("submit")}
        </button>
      </div>
    </div>
  );
}
