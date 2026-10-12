import { z } from "zod";
export const reportTemplateSectionSchema = z.object({ source: z.enum(["summary", "score", "strengths", "focusAreas", "recommendation"]),
  label: z.object({ zh: z.string().trim().min(1).max(100), en: z.string().max(100) }).strict(), visible: z.boolean() }).strict();
const sections = (sources: string[]) => z.array(reportTemplateSectionSchema).length(sources.length)
  .refine(rows => new Set(rows.map(r => r.source)).size === sources.length && rows.every(r => sources.includes(r.source)) && rows.some(r => r.visible));
export const reportTemplatesSchema = z.object({ assessment: sections(["summary", "score", "strengths", "focusAreas", "recommendation"]), feedback: sections(["summary", "score"]) }).strict();
export const reportTemplateSnapshotSchema = z.object({ version: z.string().min(1).max(100), sections: z.array(reportTemplateSectionSchema).min(1).max(5) }).strict();
