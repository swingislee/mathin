import { z } from "zod";
import { miniappLocalized } from "./contract";
export const documentIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const documentContentSchema = z.object({ title: miniappLocalized(120), body: miniappLocalized(20000), enabled: z.boolean() }).strict();
export const documentSchema = documentContentSchema.omit({ enabled: true }).extend({ id: documentIdSchema, version: z.string().min(1).max(100) });
export const documentIndexSchema = z.array(z.object({ id: documentIdSchema, title: miniappLocalized(120), revision: z.number().int().positive(), publishedRevision: z.number().int().positive().nullable() }));
export const documentStateSchema = z.object({ id: documentIdSchema, draft: documentContentSchema, revision: z.number().int().nonnegative(), publishedRevision: z.number().int().positive().nullable(),
  history: z.array(z.object({ revision: z.number().int().positive(), version: z.string(), publishedAt: z.string() })).max(50) });
export type DocumentContent = z.infer<typeof documentContentSchema>;
export type DocumentState = z.infer<typeof documentStateSchema>;
export type DocumentIndex = z.infer<typeof documentIndexSchema>;
