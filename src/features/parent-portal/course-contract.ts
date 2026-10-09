import { z } from "zod";

// Historical imports use valid PostgreSQL UUIDs without RFC version bits.
export const registrationIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const uuid = registrationIdSchema;
export const catalogClassSchema = z.object({
  id: uuid, name: z.string(), offeringType: z.enum(["long_term_formal", "short_term_topic"]).optional(),
  courseId: uuid.nullable(), familyId: uuid.nullable(), familyTitle: z.string(),
  grade: z.number().int().nullable(), subject: z.string(), level: z.string(), termId: uuid.nullable(), termName: z.string(),
  campusId: uuid.nullable(), campusName: z.string().nullable(), roomName: z.string().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
  teachers: z.array(z.object({ id: uuid, name: z.string() })),
  sessions: z.array(z.object({ at: z.string().datetime({ offset: true }), duration: z.number().positive() })),
});
export const courseOfferSchema = z.object({
  id: uuid, kind: z.enum(["class", "activity"]), title: z.string(), description: z.string(), priceCents: z.number().int().nonnegative().nullable(),
  bookingClosesAt: z.string().datetime({ offset: true }), revision: z.number().int().positive(), classes: z.array(catalogClassSchema),
  activity: z.object({ id: uuid, tags: z.array(z.string()).default([]), targetGrades: z.array(z.number().int()).nullable(), location: z.string(),
    startsAt: z.string().datetime({ offset: true }), durationMinutes: z.number().nullable(), remaining: z.number().int().nonnegative().nullable() }).nullable(),
});
export const courseApplicationSchema = z.object({
  id: uuid, kind: z.enum(["class", "activity"]).default("class"), participantId: uuid, participantName: z.string(), publicationId: uuid,
  classroomId: uuid.nullable(), activityId: uuid.nullable().default(null), title: z.string(), className: z.string(), priceCents: z.number().int().nonnegative().nullable(),
  status: z.enum(["pending", "contacted", "confirmed", "declined", "cancelled"]),
  createdAt: z.string().datetime({ offset: true }), resolvedAt: z.string().datetime({ offset: true }).nullable(), reply: z.string(),
});
export const courseCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("apply"), id: uuid, kind: z.enum(["class", "activity"]), publicationId: uuid,
    revision: z.number().int().positive(), classroomId: uuid.nullable(), participantId: uuid }).strict()
    .refine(v => v.kind === "activity" ? v.classroomId === null : v.classroomId === v.publicationId),
  z.object({ action: z.literal("cancel"), id: uuid }).strict(),
]);
