import { z } from "zod";
import { LEARNING_CHECK_STATUSES } from "./session-learning-contract";

export const postclassReviewSchema = z.object({
  studentId: z.string().uuid(), studentName: z.string(),
  entryScore: z.number().min(0).max(100).nullable(), exitScore: z.number().min(0).max(100).nullable(),
  focus: z.number().int().min(1).max(5).nullable(), participation: z.number().int().min(1).max(5).nullable(), mastery: z.number().int().min(1).max(5).nullable(),
  comment: z.string().max(2000),
});
export const postclassLearningSchema = z.object({
  revision: z.string(),
  checks: z.array(z.object({ id: z.string().uuid(), title: z.string(), position: z.number() })),
  students: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  results: z.array(z.object({ checkId: z.string().uuid(), studentId: z.string().uuid(), status: z.enum(LEARNING_CHECK_STATUSES) })),
  reviews: z.array(postclassReviewSchema),
});
export type PostclassLearning = z.infer<typeof postclassLearningSchema>;
export function postclassLearningChanges(before: PostclassLearning, after: PostclassLearning) {
  return {
    changes: after.results.filter(row => (before.results.find(old => old.checkId === row.checkId && old.studentId === row.studentId)?.status ?? "unchecked") !== row.status),
    reviews: after.reviews.filter(row => JSON.stringify(before.reviews.find(old => old.studentId === row.studentId)) !== JSON.stringify(row)),
  };
}
