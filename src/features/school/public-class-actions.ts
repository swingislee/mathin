"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient, staffRpcClient } from "./actions/guards";
import { COMMON_CODES, datetime, intInRange, parse, requiredText, text, uuid } from "./actions/schemas";
import { PUBLIC_CLASS_SEGMENT_KINDS } from "./public-class";

type RpcClient = { rpc: unknown };
function rpc<T>(client: RpcClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: T; error: { message: string } | null }>)(name, args);
}

const nullableUuid = uuid.nullable();
const segmentSchema = z.object({
  activityId: uuid,
  segmentId: nullableUuid,
  kind: z.enum(PUBLIC_CLASS_SEGMENT_KINDS),
  title: requiredText(100),
  scheduledAt: datetime,
  durationMin: intInRange(1, 600),
  roomId: nullableUuid,
  location: text(100),
  primaryTeacherId: nullableUuid,
  assistantTeacherId: nullableUuid,
}).strict().refine(
  (value) => !value.primaryTeacherId || value.primaryTeacherId !== value.assistantTeacherId,
  { message: "teachers must differ" },
);

const presence = z.enum(["expected", "attended", "late", "absent", "not_applicable"]);
const participantRecordSchema = z.object({
  segmentId: uuid,
  registrationId: uuid,
  studentPresence: presence,
  guardianPresence: presence,
  learningObservation: text(3_000),
  assessmentSummary: text(3_000),
  parentFeedback: text(3_000),
  recommendation: text(3_000),
}).strict();

const registrationSchema = z.object({
  registrationId: uuid,
  status: z.enum(["booked", "attended", "no_show", "cancelled"]),
  outcome: text(1_000),
}).strict();

const PUBLIC_CLASS_CODES = [
  "PUBLIC_CLASS_NOT_FOUND",
  "PUBLIC_CLASS_SEGMENT_NOT_FOUND",
  "PUBLIC_CLASS_REQUIRES_SEGMENT",
  "PUBLIC_CLASS_RECORD_NOT_FOUND",
  "INVALID_PUBLIC_CLASS",
  "INVALID_PUBLIC_CLASS_SEGMENT",
  "INVALID_PUBLIC_CLASS_RECORD",
  "INVALID_PUBLIC_CLASS_CANDIDATE",
  "INVALID_MICROCOURSE_SELECTION",
  "MICROCOURSE_ALREADY_EXISTS",
  "MICROCOURSE_FAMILY_MISSING",
  "PUBLIC_CLASS_TEACHING_STARTED",
  "PUBLIC_CLASS_TEACHING_ENDED",
  "PUBLIC_CLASS_TEACHING_NOT_STARTED",
  "PUBLIC_CLASS_COURSEWARE_REQUIRED",
  "PUBLIC_CLASS_COURSEWARE_NOT_READY",
  "PAGE_TRACK_NOT_READY",
  ...COMMON_CODES,
] as const;

export type PublicClassSegmentInput = z.input<typeof segmentSchema>;

export async function savePublicClassSegmentAction(
  input: PublicClassSegmentInput,
): Promise<ActionResult<{ segmentId: string }>> {
  try {
    const value = parse(segmentSchema, input);
    const { supabase } = await authorizedClient("activity.manage");
    const { data, error } = await rpc<string>(supabase, "save_public_class_segment", {
      p_activity_id: value.activityId,
      p_segment_id: value.segmentId,
      p_kind: value.kind,
      p_title: value.title,
      p_scheduled_at: value.scheduledAt,
      p_duration_min: value.durationMin,
      p_room_id: value.roomId,
      p_location: value.location,
      p_primary_teacher_id: value.primaryTeacherId,
      p_assistant_teacher_id: value.assistantTeacherId,
    });
    if (error || !data) throw new Error(error?.message ?? "SAVE_FAILED");
    return { ok: true, data: { segmentId: data } };
  } catch (error) {
    return actionError(error, ["SAVE_FAILED", ...PUBLIC_CLASS_CODES]);
  }
}

const createMicrocourseSchema = z.object({
  segmentId: uuid,
  courseTitle: requiredText(100),
  lectureTitle: requiredText(120),
  grade: intInRange(1, 9),
}).strict();

export async function createPublicClassMicrocourseProjectAction(input: {
  segmentId: string;
  courseTitle: string;
  lectureTitle: string;
  grade: number;
}): Promise<ActionResult<{ courseId: string; lectureId: string; microcourseId: string }>> {
  try {
    const value = parse(createMicrocourseSchema, input);
    const { supabase } = await staffRpcClient();
    const { data, error } = await rpc<{
      courseId: string;
      lectureId: string;
      microcourseId: string;
    }>(supabase, "create_public_class_microcourse_project", {
      p_segment_id: value.segmentId,
      p_course_title: value.courseTitle,
      p_lecture_title: value.lectureTitle,
      p_grade: value.grade,
    });
    if (error || !data?.microcourseId) throw new Error(error?.message ?? "SAVE_FAILED");
    return { ok: true, data };
  } catch (error) {
    return actionError(error, ["SAVE_FAILED", ...PUBLIC_CLASS_CODES]);
  }
}

export async function startPublicClassSegmentTeachingAction(
  segmentId: string,
): Promise<ActionResult> {
  try {
    const id = parse(uuid, segmentId);
    const { supabase } = await staffRpcClient();
    const { error } = await rpc<null>(supabase, "start_public_class_segment_teaching", {
      p_segment_id: id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PUBLIC_CLASS_CODES);
  }
}

export async function endPublicClassSegmentTeachingAction(
  segmentId: string,
): Promise<ActionResult> {
  try {
    const id = parse(uuid, segmentId);
    const { supabase } = await staffRpcClient();
    const { error } = await rpc<null>(supabase, "end_public_class_segment_teaching", {
      p_segment_id: id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PUBLIC_CLASS_CODES);
  }
}

export async function deletePublicClassSegmentAction(segmentId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, segmentId);
    const { supabase } = await authorizedClient("activity.manage");
    const { error } = await rpc<null>(supabase, "delete_public_class_segment", { p_segment_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PUBLIC_CLASS_CODES);
  }
}

export async function savePublicClassParticipantRecordAction(
  input: z.input<typeof participantRecordSchema>,
): Promise<ActionResult<{ recordId: string }>> {
  try {
    const value = parse(participantRecordSchema, input);
    const { supabase } = await staffRpcClient();
    const { data, error } = await rpc<string>(supabase, "save_public_class_participant_record", {
      p_segment_id: value.segmentId,
      p_registration_id: value.registrationId,
      p_student_presence: value.studentPresence,
      p_guardian_presence: value.guardianPresence,
      p_learning_observation: value.learningObservation,
      p_assessment_summary: value.assessmentSummary,
      p_parent_feedback: value.parentFeedback,
      p_recommendation: value.recommendation,
    });
    if (error || !data) throw new Error(error?.message ?? "SAVE_FAILED");
    return { ok: true, data: { recordId: data } };
  } catch (error) {
    return actionError(error, ["SAVE_FAILED", ...PUBLIC_CLASS_CODES]);
  }
}

export async function savePublicClassRegistrationStatusAction(
  input: z.input<typeof registrationSchema>,
): Promise<ActionResult> {
  try {
    const value = parse(registrationSchema, input);
    const { supabase } = await staffRpcClient();
    const { error } = await rpc<null>(supabase, "save_public_class_registration_status", {
      p_registration_id: value.registrationId,
      p_status: value.status,
      p_outcome: value.outcome,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PUBLIC_CLASS_CODES);
  }
}

export async function linkPublicClassSegmentMicrocourseAction(input: {
  segmentId: string;
  courseId: string | null;
  lectureId: string | null;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({
      segmentId: uuid,
      courseId: nullableUuid,
      lectureId: nullableUuid,
    }).strict().refine(
      (item) => Boolean(item.courseId) === Boolean(item.lectureId),
      { message: "course and lecture must be selected together" },
    ), input);
    const { supabase } = await staffRpcClient();
    const { error } = await rpc<null>(supabase, "link_public_class_segment_microcourse", {
      p_segment_id: value.segmentId,
      p_course_id: value.courseId,
      p_lecture_id: value.lectureId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PUBLIC_CLASS_CODES);
  }
}

export async function linkPublicClassroomAction(input: {
  activityId: string;
  classroomId: string;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ activityId: uuid, classroomId: uuid }).strict(), input);
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await rpc<null>(supabase, "link_public_classroom", {
      p_activity_id: value.activityId,
      p_classroom_id: value.classroomId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PUBLIC_CLASS_CODES);
  }
}

export async function unlinkPublicClassroomAction(input: {
  activityId: string;
  classroomId: string;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({ activityId: uuid, classroomId: uuid }).strict(), input);
    const { supabase } = await authorizedClient("class.manage");
    const { error } = await rpc<null>(supabase, "unlink_public_classroom", {
      p_activity_id: value.activityId,
      p_classroom_id: value.classroomId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, PUBLIC_CLASS_CODES);
  }
}

export async function syncPublicClassroomCandidatesAction(input: {
  activityId: string;
  classroomId: string;
  registrationIds: string[];
}): Promise<ActionResult<{ count: number }>> {
  try {
    const value = parse(z.object({
      activityId: uuid,
      classroomId: uuid,
      registrationIds: z.array(uuid).max(500),
    }).strict(), input);
    const { supabase } = await authorizedClient("class.manage");
    const { data, error } = await rpc<number>(supabase, "sync_public_classroom_candidates", {
      p_activity_id: value.activityId,
      p_classroom_id: value.classroomId,
      p_registration_ids: value.registrationIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { count: data ?? 0 } };
  } catch (error) {
    return actionError(error, PUBLIC_CLASS_CODES);
  }
}
