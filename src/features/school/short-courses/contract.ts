import { z } from "zod";

export const SHORT_COURSES_HREF = "/dashboard/short-courses";
export const SHORT_COURSE_PAGE_SIZE = 20;
export const shortCourseLevelSchema = z.enum(["beginner", "intermediate", "advanced", "mixed"]);
export const weeklySlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export type WeeklySlot = z.infer<typeof weeklySlotSchema>;
export type ShortCourseLevel = z.infer<typeof shortCourseLevelSchema>;
const nameSchema = z.string().trim().min(1).max(100);
export const shortCourseGroupSchema = z.object({
  key: z.string().uuid(),
  name: nameSchema,
  level: shortCourseLevelSchema,
  grades: z.array(z.number().int().min(1).max(12)).max(12),
  teacherId: z.string().uuid(),
  roomId: z.string().uuid().nullable(),
  capacity: z.number().int().min(1).max(500),
  plannedStudents: z.number().int().min(0).max(500).nullable(),
  weeklySlots: z.array(weeklySlotSchema).min(1).max(7),
}).superRefine((row, context) => {
  if (new Set(row.weeklySlots.map(slot => slot.weekday)).size !== row.weeklySlots.length) {
    context.addIssue({ code: "custom", path: ["weeklySlots"], message: "DUPLICATE_WEEKDAY" });
  }
  if (row.plannedStudents !== null && row.plannedStudents > row.capacity) {
    context.addIssue({ code: "custom", path: ["plannedStudents"], message: "CAPACITY_EXCEEDED" });
  }
});
export const shortCourseDraftSchema = z.object({
  requestId: z.string().uuid(),
  topic: nameSchema,
  name: nameSchema,
  termId: z.string().uuid(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }),
  sessionCount: z.number().int().min(1).max(40),
  durationMin: z.number().int().min(1).max(600),
  classes: z.array(shortCourseGroupSchema).min(1).max(30),
}).superRefine((value, context) => {
  if (new Set(value.classes.map(row => row.key)).size !== value.classes.length) context.addIssue({ code: "custom", path: ["classes"], message: "DUPLICATE_CLASS_KEY" });
});
export type ShortCourseGroupDraft = z.infer<typeof shortCourseGroupSchema>;
export type ShortCourseDraft = z.infer<typeof shortCourseDraftSchema>;

export interface ShortCoursePlannedLesson { name: string; scheduledAt: string }
export interface ShortCoursePreview {
  classes: Array<ShortCourseGroupDraft & { sessions: ShortCoursePlannedLesson[] }>;
  conflicts: Array<{ classKey: string; otherName: string; scheduledAt: string; teacher: boolean; room: boolean }>;
  scheduleKey: string;
}

const listedSessionSchema = z.object({
  id: z.string().uuid(), name: z.string(), scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(), endedAt: z.string().nullable(), cancelled: z.boolean(), voided: z.boolean(),
});
export const shortCourseListSchema = z.object({
  total: z.number().int().nonnegative(),
  batches: z.array(z.object({ id: z.string().uuid(), name: z.string(), topic: z.string() })),
  classes: z.array(z.object({
    id: z.string().uuid(), name: z.string(), capacity: z.number().nullable(),
    status: z.enum(["planning", "active", "completed"]),
    batchId: z.string().uuid().nullable(), batchName: z.string().nullable(), topic: z.string().nullable(),
    level: shortCourseLevelSchema.nullable(), grades: z.array(z.number()), plannedStudents: z.number().nullable(),
    weeklySlots: z.array(weeklySlotSchema), sessionCount: z.number().nullable(), teacherName: z.string().nullable(),
    enrolledCount: z.number(), sessions: z.array(listedSessionSchema),
  })),
});
export type ShortCourseList = z.infer<typeof shortCourseListSchema>;
export type ShortCourseListRow = ShortCourseList["classes"][number];
export const shortCourseMetadataSchema = z.object({
  batchId: z.string().uuid(), batchName: z.string(), topic: z.string(), level: shortCourseLevelSchema,
  grades: z.array(z.number()), plannedStudents: z.number().nullable(), weeklySlots: z.array(weeklySlotSchema),
  sessionCount: z.number(),
}).nullable();
export type ShortCourseMetadata = z.infer<typeof shortCourseMetadataSchema>;

export function shortCourseHref(id: string) { return `${SHORT_COURSES_HREF}/${id}`; }
export function shortCourseFilters(query: Record<string, string | string[] | undefined>) {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const batchId = z.string().uuid().safeParse(first(query.batch));
  const status = z.enum(["planning", "active", "completed"]).safeParse(first(query.status));
  const rawPage = Number(first(query.page));
  return { q: (first(query.q) ?? "").trim().slice(0, 80), batchId: batchId.success ? batchId.data : "",
    status: status.success ? status.data : "", page: Number.isFinite(rawPage) ? Math.max(1, Math.min(100000, Math.floor(rawPage))) : 1 };
}
export function shortCourseListHref(filters: ReturnType<typeof shortCourseFilters>, page = filters.page) {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.batchId) query.set("batch", filters.batchId);
  if (filters.status) query.set("status", filters.status);
  if (page > 1) query.set("page", String(page));
  return `${SHORT_COURSES_HREF}${query.size ? `?${query}` : ""}`;
}
