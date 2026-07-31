import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  getSessionPreparationArtifacts,
  type PrepArtifactFile,
  type PrepArtifactKind,
  type PrepArtifactReviewStatus,
  type SessionPreparationArtifacts,
} from "./session-preparation-artifacts";
import { getTeacherPreparationReviewData } from "./teacher-preparation";
import type { SessionLessonPlan, SolutionRecord } from "./teacher-preparation-contract";

export interface SessionPreparationReviewQueueItem {
  sessionId: string;
  artifactKind: PrepArtifactKind;
  status: PrepArtifactReviewStatus;
  revision: number;
  submittedAt: string;
  reviewedAt: string | null;
  reviewNote: string;
  sessionTitle: string;
  classroomName: string;
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
  selfReview: boolean;
}

export interface SignedPrepArtifactFile extends PrepArtifactFile {
  url: string | null;
}

export interface SessionPreparationReviewDetail extends SessionPreparationArtifacts {
  signedSolutionFiles: SignedPrepArtifactFile[];
  signedLessonPlanFiles: SignedPrepArtifactFile[];
  lessonPlan: SessionLessonPlan | null;
  solutionRecords: SolutionRecord[];
}

export async function listSessionPreparationReviews(sessionId?: string): Promise<SessionPreparationReviewQueueItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_session_preparation_reviews", {
    p_session_id: sessionId ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    sessionId: row.session_id,
    artifactKind: row.artifact_kind as PrepArtifactKind,
    status: row.status as PrepArtifactReviewStatus,
    revision: row.revision,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    sessionTitle: row.session_title,
    classroomName: row.classroom_name,
    assignedReviewerId: row.assigned_reviewer_id,
    assignedReviewerName: row.assigned_reviewer_name,
    selfReview: row.self_review,
  }));
}

async function signFiles(files: PrepArtifactFile[]): Promise<SignedPrepArtifactFile[]> {
  const supabase = await createClient();
  return Promise.all(files.map(async (file) => {
    const { data } = await supabase.storage.from("prep-artifacts").createSignedUrl(file.path, 900);
    return { ...file, url: data?.signedUrl ?? null };
  }));
}

export async function getSessionPreparationReviewDetail(sessionId: string): Promise<SessionPreparationReviewDetail> {
  const [artifacts, teacherPreparation] = await Promise.all([getSessionPreparationArtifacts(sessionId), getTeacherPreparationReviewData(sessionId)]);
  const [signedSolutionFiles, signedLessonPlanFiles] = await Promise.all([
    signFiles(artifacts.solutionFiles),
    signFiles(artifacts.lessonPlanFiles),
  ]);
  return { ...artifacts, signedSolutionFiles, signedLessonPlanFiles, ...teacherPreparation };
}
