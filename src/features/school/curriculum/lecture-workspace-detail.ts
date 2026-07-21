import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { LectureWorkspaceDetail } from "./types";

const uuidSchema = z.uuid();
const trackSchema = z.enum(["native-16x9", "adapted-4x3"]);
const courseSeasonSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

const activeReviewCycleSchema = z.object({
  id: uuidSchema,
  creatorId: uuidSchema,
  creatorName: z.string(),
  submittedAt: z.string(),
  submissionNote: z.string(),
});

const trackStateSchema = z.object({
  track: trackSchema,
  stage: z.enum(["idle", "editing", "in_review", "changes_requested", "ready_to_publish"]),
  currentReviewRound: z.number().int().min(1).max(3).nullable(),
  requiredReviewRounds: z.number().int().min(1).max(3).nullable(),
  internalDueAt: z.string().nullable(),
  currentReleaseNo: z.number().int().positive().nullable(),
  hasUnpublishedChanges: z.boolean(),
  activeReviewCycle: activeReviewCycleSchema.nullable(),
});

const assignmentSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  userName: z.string(),
  responsibility: z.enum(["owner", "editor", "reviewer"]),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});

const effectiveAssignmentSchema = z.object({
  responsibility: z.enum(["owner", "editor", "reviewer"]),
  userId: uuidSchema,
  userName: z.string(),
  sourceScopeType: z.enum(["family", "variant", "lecture"]),
  sourceLabel: z.string().nullable(),
});

const usageSchema = z.object({
  id: uuidSchema,
  classroomId: uuidSchema,
  classroomName: z.string(),
  scheduledAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

const historySchema = z.object({
  id: uuidSchema,
  track: trackSchema,
  workflowCycleNo: z.number().int().positive(),
  reviewRoundNo: z.number().int().min(0).max(3),
  status: z.enum(["submitted", "changes_requested", "passed", "withdrawn", "published", "bypassed"]),
  creatorName: z.string(),
  reviewerName: z.string().nullable(),
  selfReview: z.boolean(),
  submissionNote: z.string(),
  submittedAt: z.string(),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  publishedReleaseId: uuidSchema.nullable(),
});

const policySchema = z.object({
  requiredReviewRounds: z.number().int().min(1).max(3),
  allowCreatorAsReviewer: z.boolean(),
  emergencyPublishEnabled: z.boolean(),
});

const detailSchema = z.object({
  policy: policySchema,
  lecture: z.object({
    id: uuidSchema,
    no: z.number().int().positive(),
    name: z.string(),
    objectives: z.string(),
    status: z.enum(["draft", "active", "archived"]),
    archivedAt: z.string().nullable(),
    pageCount: z.number().int().nonnegative(),
  }),
  family: z.object({ id: uuidSchema, title: z.string() }),
  variant: z.object({
    id: uuidSchema,
    title: z.string(),
    grade: z.number().int().min(1).max(9),
    courseSeason: courseSeasonSchema,
    classType: z.string(),
  }),
  tracks: z.array(trackStateSchema),
  assignments: z.array(assignmentSchema),
  effectiveAssignments: z.array(effectiveAssignmentSchema),
  usage: z.array(usageSchema),
  history: z.array(historySchema),
});

export function isUuid(value: string | undefined): value is string {
  return Boolean(value && uuidSchema.safeParse(value).success);
}

export async function getLectureWorkspaceDetail(lectureId: string): Promise<LectureWorkspaceDetail> {
  const parsedLectureId = uuidSchema.parse(lectureId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_lecture_workspace_detail", { p_lecture_id: parsedLectureId });
  if (error) throw new Error(error.message);
  return detailSchema.parse(data) as LectureWorkspaceDetail;
}
