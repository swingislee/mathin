"use server";

// ---------------------------------------------------------------------------
// 课件模板与课次覆盖层（P4B-3 §4.3）：教师只能插页/排序，服务端 resolve 校验禁止删改模板页。
// ---------------------------------------------------------------------------

import {
  courseware_template_array_schema,
  overlayArraySchema,
  parseOverlayForSave,
  type CoursewareTemplatePage,
  type OverlaySlot,
} from "../courseware-overlay";
import { authorizedClient } from "./guards";
import { parse, uuid } from "./schemas";

export async function updateLectureTemplate(lectureId: string, pages: CoursewareTemplatePage[]): Promise<void> {
  const id = parse(uuid, lectureId);
  const parsed = courseware_template_array_schema.safeParse(pages);
  if (!parsed.success) throw new Error("INVALID_TEMPLATE");
  const { supabase } = await authorizedClient("courseware.template.edit");
  const { error } = await supabase.from("course_lectures").update({ courseware_template: parsed.data }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function saveCoursewareOverlay(sessionId: string, overlay: OverlaySlot[]): Promise<void> {
  const id = parse(uuid, sessionId);
  const shapeCheck = overlayArraySchema.safeParse(overlay);
  if (!shapeCheck.success) throw new Error("INVALID_OVERLAY");
  const { supabase } = await authorizedClient("courseware.overlay.edit");

  const { data: session, error: sessionError } = await supabase
    .from("class_sessions")
    .select("lecture_id,courseware_frozen_at")
    .eq("id", id)
    .maybeSingle<{ lecture_id: string | null; courseware_frozen_at: string | null }>();
  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error("NOT_FOUND");
  if (session.courseware_frozen_at) throw new Error("ALREADY_FROZEN");
  if (!session.lecture_id) throw new Error("NO_LECTURE");

  const { data: lecture, error: lectureError } = await supabase
    .from("course_lectures")
    .select("courseware_template")
    .eq("id", session.lecture_id)
    .maybeSingle<{ courseware_template: CoursewareTemplatePage[] }>();
  if (lectureError) throw new Error(lectureError.message);
  if (!lecture) throw new Error("NOT_FOUND");

  const healed = parseOverlayForSave(lecture.courseware_template ?? [], shapeCheck.data);
  const { error } = await supabase
    .from("class_sessions")
    .update({ courseware_overlay: healed })
    .eq("id", id)
    .is("courseware_frozen_at", null);
  if (error) throw new Error(error.message);
}
