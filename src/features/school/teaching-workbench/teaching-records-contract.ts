import { z } from "zod";
import { LEARNING_CHECK_RATED_STATUSES } from "../session-learning-contract";
import { assignmentQuestionWorkbookSchema } from "../assignment-question-contract";
import { sessionCommunicationsSchema } from "../session-communication-contract";

export const TEACHING_CONTACT_PAGE_SIZE = 20;
export const teachingRecordsSchema = z.object({
  session: z.object({ id: z.string(), classroomId: z.string(), classroomName: z.string(), title: z.string(),
    scheduledAt: z.string().nullable(), startedAt: z.string().nullable(), endedAt: z.string().nullable() }),
  students: z.array(z.object({ id: z.string(), name: z.string() })),
  attendance: z.array(z.object({ studentId: z.string(), status: z.enum(["present", "absent", "late", "leave"]), note: z.string() })),
  checks: z.array(z.object({ id: z.string(), title: z.string() })),
  results: z.array(z.object({ checkId: z.string(), studentId: z.string(), status: z.enum(LEARNING_CHECK_RATED_STATUSES), markedAt: z.string(), author: z.string().nullable() })),
  reviews: z.array(z.object({ studentId: z.string(), comment: z.string(), entryScore: z.number().nullable(), exitScore: z.number().nullable(),
    focus: z.number().nullable(), participation: z.number().nullable(), mastery: z.number().nullable(), updatedAt: z.string(), author: z.string().nullable() })),
  canReadContacts: z.boolean(),
  contacts: z.array(z.object({ id: z.string(), studentId: z.string(), content: z.string(), kind: z.string(),
    createdAt: z.string(), occurredOn: z.string().nullable(), author: z.string().nullable() })),
  contactTotal: z.number(),
  contactPage: z.number(),
  supportNotes: z.array(z.object({ id: z.string(), kind: z.string(), note: z.string(), status: z.string(), author: z.string().nullable(), completedAt: z.string().nullable() })),
  homework: z.array(assignmentQuestionWorkbookSchema).optional(),
  sessionCommunications: sessionCommunicationsSchema.optional(),
});
export type TeachingRecords = z.infer<typeof teachingRecordsSchema>;

export function teachingContactPage(data: TeachingRecords, requestedPage: number, pageSize: 10 | 20) {
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(data.contactTotal / pageSize)));
  const offset = ((page - 1) * pageSize) % TEACHING_CONTACT_PAGE_SIZE;
  return { ...data, contactPage: page, contacts: data.contacts.slice(offset, offset + pageSize) };
}

export function teachingRecordHref(returnTo: string, sessionId: string, teacher?: string, classroom?: string) {
  const [path, query] = returnTo.split("?");
  const params = new URLSearchParams(query);
  params.set("view", "records");
  params.set("session", sessionId);
  params.delete("contactPage");
  if (teacher) params.set("teacher", teacher); else params.delete("teacher");
  if (classroom) params.set("classroom", classroom); else params.delete("classroom");
  return `${path}?${params}`;
}
