import { z } from "zod";

const uuid = z.string().uuid();
export const catalogClassSchema = z.object({
  id: uuid, name: z.string(), courseId: uuid, familyId: uuid, familyTitle: z.string(),
  grade: z.number().int(), subject: z.string(), level: z.string(), termId: uuid, termName: z.string(),
  campusId: uuid.nullable(), campusName: z.string().nullable(), roomName: z.string().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
  teachers: z.array(z.object({ id: uuid, name: z.string() })),
  sessions: z.array(z.object({ at: z.string().datetime({ offset: true }), duration: z.number().positive() })),
});
export const courseOfferSchema = z.object({
  id: uuid, title: z.string(), description: z.string(), priceCents: z.number().int().nonnegative().nullable(),
  bookingClosesAt: z.string().datetime({ offset: true }), revision: z.number().int().positive(), classes: z.array(catalogClassSchema).min(1),
});
export const courseApplicationSchema = z.object({
  id: uuid, participantId: uuid, participantName: z.string(), publicationId: uuid,
  classroomId: uuid, title: z.string(), className: z.string(), priceCents: z.number().int().nonnegative().nullable(),
  status: z.enum(["pending", "confirmed", "declined", "cancelled"]),
  createdAt: z.string().datetime({ offset: true }), resolvedAt: z.string().datetime({ offset: true }).nullable(), reply: z.string(),
});
export const courseCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("apply"), id: uuid, publicationId: uuid, revision: z.number().int().positive(), classroomId: uuid, participantId: uuid }).strict(),
  z.object({ action: z.literal("cancel"), id: uuid }).strict(),
]);
