import { z } from "zod";
import { newId } from "@/lib/uuid";
import { coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";

export const homeworkScopeSchema = z.enum(["classroom", "lecture", "assignment"]);
export type HomeworkScope = z.infer<typeof homeworkScopeSchema>;
export const homeworkQuestionSchema = z.object({
  id: z.string().uuid(), label: z.string().trim().min(1).max(100), group: z.string().trim().max(60),
  content: z.string().max(10000), answer: z.string().max(10000), sourceQuestionId: z.string().uuid().nullable(),
  composition: coursewareCompositionPageSchema.nullable().optional(),
  answerComposition: coursewareCompositionPageSchema.nullable().optional(),
});
export const homeworkDocumentSchema = z.object({
  topic: z.string().trim().max(100), instructions: z.string().max(20000), lessonPlan: z.string().max(50000), dueAt: z.iso.datetime({ offset: true }).nullable(),
  questions: z.array(homeworkQuestionSchema).max(60),
  groups: z.array(z.string().trim().min(1).max(60)).max(60).optional(),
  overrides: z.array(z.object({ studentId: z.string().uuid(), questionId: z.string().uuid(), content: z.string().max(10000), composition: coursewareCompositionPageSchema.nullable().optional() })).max(3600),
});
export const homeworkWorkspaceSchema = z.object({
  version: z.number().int(), revision: z.string(), canWrite: z.boolean(), document: homeworkDocumentSchema,
  classTemplate: homeworkDocumentSchema.nullable(), lectureTemplate: homeworkDocumentSchema.nullable(),
  students: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  bindingUrls: z.record(z.string(), z.string()).optional(),
});
export type HomeworkDocument = z.infer<typeof homeworkDocumentSchema>;
export type HomeworkWorkspace = z.infer<typeof homeworkWorkspaceSchema>;
export function createHomeworkQuestions(count: number, group = ""): HomeworkDocument["questions"] {
  return Array.from({ length: count }, (_, index) => ({ id: newId(), label: String(index + 1), group, content: "", answer: "", sourceQuestionId: null }));
}
export function bindHomeworkQuestion(question: HomeworkDocument["questions"][number], source: HomeworkDocument["questions"][number]) {
  return { ...question, content: source.content, answer: source.answer, composition: source.composition ? structuredClone(source.composition) : null,
    answerComposition: source.answerComposition ? structuredClone(source.answerComposition) : null, sourceQuestionId: source.id };
}
export function homeworkGroups(document: HomeworkDocument) {
  return [...new Set([...(document.groups ?? []), ...document.questions.map(q => q.group).filter(Boolean)])];
}
export function homeworkCompositionFor(document: HomeworkDocument, questionId: string, studentId?: string) {
  const override = document.overrides.find(row => row.studentId === studentId && row.questionId === questionId);
  return override ? override.composition ?? null : document.questions.find(row => row.id === questionId)?.composition ?? null;
}
export function homeworkContentFor(document: HomeworkDocument, questionId: string, studentId?: string) {
  return document.overrides.find(row => row.studentId === studentId && row.questionId === questionId)?.content
    ?? document.questions.find(row => row.id === questionId)?.content ?? "";
}
