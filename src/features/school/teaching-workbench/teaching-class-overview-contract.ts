import { z } from "zod";
import { teachingWorkbenchSchema } from "./teaching-workbench-contract";

// 概览客户端只接收实际展示字段，备课资料、任务等留给原完成情况页读取。
const overviewSessionSchema = teachingWorkbenchSchema.shape.sessions.element.pick({
  id: true, classroomId: true, classroomName: true, title: true, scheduledAt: true, teachers: true, startedAt: true, endedAt: true,
});

const snippetSchema = z.object({ content: z.string(), studentName: z.string(), author: z.string().nullable(), at: z.string() });
const metricsSchema = z.object({
  sessionId: z.string(), studentIds: z.array(z.string()),
  attendance: z.object({ marked: z.number(), present: z.number(), late: z.number(), absent: z.number(), leave: z.number() }),
  checkCount: z.number(), ratedCount: z.number(),
  attentionStudents: z.array(z.object({ id: z.string(), name: z.string() })),
  reviewCount: z.number(), latestReview: snippetSchema.nullable(),
});
export const teachingClassOverviewSchema = z.object({
  workbench: z.object({ sessions: z.array(overviewSessionSchema), truncated: z.boolean() }), metrics: z.array(metricsSchema), canReadContacts: z.boolean(),
  classContacts: z.array(z.object({ classroomId: z.string(), count: z.number(), studentCount: z.number(), latest: snippetSchema.nullable() })),
});
export type TeachingClassOverview = z.infer<typeof teachingClassOverviewSchema>;
export type TeachingSessionMetrics = z.infer<typeof metricsSchema>;
export type TeachingRecordSnippet = z.infer<typeof snippetSchema>;
export type TeachingOverviewSession = z.infer<typeof overviewSessionSchema> & { metrics: TeachingSessionMetrics };

export function groupTeachingClasses(data: TeachingClassOverview, teacher?: string, classroom?: string) {
  const metrics = new Map(data.metrics.map(row => [row.sessionId, row]));
  const contacts = new Map(data.classContacts.map(row => [row.classroomId, row]));
  const groups = new Map<string, { id: string; name: string; sessions: TeachingOverviewSession[] }>();
  for (const session of data.workbench.sessions) {
    if (classroom && session.classroomId !== classroom) continue;
    if (teacher && (teacher === "unassigned" ? session.teachers.length > 0 : !session.teachers.some(row => row.id === teacher))) continue;
    const metric = metrics.get(session.id);
    if (!metric) throw new Error("TEACHING_SESSION_METRICS_MISSING");
    const group = groups.get(session.classroomId) ?? { id: session.classroomId, name: session.classroomName, sessions: [] };
    group.sessions.push({ ...session, metrics: metric });
    groups.set(group.id, group);
  }
  return [...groups.values()].map(group => {
    const rows = group.sessions.sort((a,b) => b.scheduledAt.localeCompare(a.scheduledAt));
    const students = new Set(rows.flatMap(row => row.metrics.studentIds));
    const attention = [...new Map(rows.flatMap(row => row.metrics.attentionStudents).map(row => [row.id, row])).values()];
    const latestReview = rows.flatMap(row => row.metrics.latestReview ? [row.metrics.latestReview] : []).sort((a,b) => b.at.localeCompare(a.at))[0] ?? null;
    return {
      ...group, studentCount: students.size, attention,
      teachers: [...new Map(rows.flatMap(row => row.teachers).map(row => [row.id, row])).values()],
      recordedSessions: rows.filter(row => hasTeachingRecords(row.metrics)).length,
      endedSessions: rows.filter(row => row.endedAt).length,
      rosterEntries: rows.reduce((sum, row) => sum + row.metrics.studentIds.length, 0),
      attendance: rows.reduce((sum, row) => ({ marked: sum.marked + row.metrics.attendance.marked, present: sum.present + row.metrics.attendance.present,
        late: sum.late + row.metrics.attendance.late, absent: sum.absent + row.metrics.attendance.absent, leave: sum.leave + row.metrics.attendance.leave }),
      { marked: 0, present: 0, late: 0, absent: 0, leave: 0 }),
      ratedCount: rows.reduce((sum, row) => sum + row.metrics.ratedCount, 0),
      expectedRatings: rows.reduce((sum, row) => sum + row.metrics.checkCount * row.metrics.studentIds.length, 0),
      reviewCount: rows.reduce((sum, row) => sum + row.metrics.reviewCount, 0), latestReview,
      contacts: contacts.get(group.id) ?? { count: 0, studentCount: 0, latest: null },
    };
  }).sort((a,b) => b.attention.length - a.attention.length || b.recordedSessions - a.recordedSessions || a.name.localeCompare(b.name));
}

export function hasTeachingRecords(metrics: TeachingSessionMetrics) {
  return metrics.attendance.marked > 0 || metrics.ratedCount > 0 || metrics.reviewCount > 0;
}
