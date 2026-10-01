import { z } from "zod";
import type { LearningCourse, LearningSession } from "../../../contracts/parent-api/portal";

const uuid = z.string().uuid();
const dateTime = z.iso.datetime({ offset: true });
const day = 86_400_000;

export const learningQuerySchema = z.object({
  participant: uuid,
  from: dateTime.optional(),
  to: dateTime.optional(),
}).strict();

const rangeSchema = z.object({ from: dateTime, to: dateTime }).refine(
  ({ from, to }) => {
    const duration = Date.parse(to) - Date.parse(from);
    return duration > 0 && duration <= 366 * day;
  },
  { message: "学习查询需要不超过 366 天的正向时间窗口" },
);

export function learningRange(input: z.infer<typeof learningQuerySchema>, now: number) {
  return rangeSchema.parse({
    from: input.from ?? new Date(now - 30 * day).toISOString(),
    to: input.to ?? new Date(now + 90 * day).toISOString(),
  });
}

export const learningCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("leave"), sessionId: uuid, participantId: uuid, reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ action: z.literal("readNotification"), id: uuid }).strict(),
]);

export function learningCourses(schedule: LearningSession[], now: number): LearningCourse[] {
  const courses = new Map<string, LearningCourse>();
  for (const session of schedule) {
    let course = courses.get(session.classroomId);
    if (!course) {
      course = { id: session.classroomId, name: session.classroomName, teacherName: session.teacherName, nextSessionAt: null, sessionCount: 0 };
      courses.set(course.id, course);
    }
    course.sessionCount += 1;
    if (Date.parse(session.startsAt) >= now && (!course.nextSessionAt || Date.parse(session.startsAt) < Date.parse(course.nextSessionAt))) {
      course.nextSessionAt = session.startsAt;
      course.teacherName = session.teacherName;
    }
  }
  return [...courses.values()].sort((a, b) =>
    (a.nextSessionAt ?? "9999").localeCompare(b.nextSessionAt ?? "9999") || a.name.localeCompare(b.name),
  );
}

/** 通知只提供本站工作区目标；移动端自行决定对应的原生页面。 */
export function learningNotificationLink(value: unknown): string | null {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  return /^\/(?:(?:zh|en)\/)?dashboard(?:[/?#]|$)/.test(value) ? value : null;
}
