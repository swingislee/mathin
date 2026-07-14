"use server";

// ---------------------------------------------------------------------------
// 课程 / 讲次 CRUD（P4D-1）与学期轴（P4E）。都归 course.manage 一把钥匙。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./guards";
import { COMMON_CODES, dateOnly, intInRange, parse, requiredText, text, uuid } from "./schemas";
import type { CourseWriteInput } from "./types";

const courseSchema = z.object({
  title: requiredText(100),
  productCode: text(40),
  grade: intInRange(1, 9),
  term: intInRange(1, 4),
  classType: text(20),
  status: z.enum(["enabled", "disabled"]),
});

function courseRow(input: CourseWriteInput) {
  const value = parse(courseSchema, input);
  return {
    title: value.title,
    product_code: value.productCode || null,
    grade: value.grade,
    term: value.term,
    class_type: value.classType,
    status: value.status,
  };
}

export async function createCourseAction(input: CourseWriteInput): Promise<ActionResult<string>> {
  try {
    const row = courseRow(input);
    const { supabase, user } = await authorizedClient("course.manage");
    const { data, error } = await supabase
      .from("courses")
      .insert({ ...row, created_by: user.id })
      .select("id")
      .single<{ id: string }>();
    if (error) throw new Error(error.message);
    return { ok: true, data: data.id };
  } catch (error) {
    return actionError<string>(error, COMMON_CODES);
  }
}

export async function updateCourseAction(courseId: string, input: CourseWriteInput): Promise<ActionResult> {
  try {
    const id = parse(uuid, courseId);
    const row = courseRow(input);
    const { supabase } = await authorizedClient("course.manage");
    const { data, error } = await supabase.from("courses").update(row).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("NOT_FOUND");
    return { ok: true };
  } catch (error) {
    return actionError(error, ["NOT_FOUND", ...COMMON_CODES]);
  }
}

const lectureSchema = z.object({ name: requiredText(100), objectives: text(2000) });

export async function createLectureAction(courseId: string, name: string, objectives: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, courseId);
    const value = parse(lectureSchema, { name, objectives });
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("create_course_lecture", {
      p_course_id: id,
      p_name: value.name,
      p_objectives: value.objectives,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function updateLectureAction(lectureId: string, name: string, objectives: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, lectureId);
    const value = parse(lectureSchema, { name, objectives });
    const { supabase } = await authorizedClient("course.manage");
    const { data, error } = await supabase
      .from("course_lectures")
      .update({ name: value.name, objectives: value.objectives })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("NOT_FOUND");
    return { ok: true };
  } catch (error) {
    return actionError(error, ["NOT_FOUND", ...COMMON_CODES]);
  }
}

export async function deleteLectureAction(lectureId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, lectureId);
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("delete_course_lecture", { p_lecture_id: id });
    if (error) throw new Error(error.message.includes("LECTURE_IN_USE") ? "LECTURE_IN_USE" : error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["LECTURE_IN_USE", ...COMMON_CODES]);
  }
}

export async function reorderLecturesAction(courseId: string, lectureIds: string[]): Promise<ActionResult> {
  try {
    const value = parse(z.object({ courseId: uuid, lectureIds: z.array(uuid).max(500) }), { courseId, lectureIds });
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("reorder_course_lectures", {
      p_course_id: value.courseId,
      p_lecture_ids: value.lectureIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

const termSchema = z.object({
  year: intInRange(2020, 2100),
  term: z.union([z.literal(1), z.literal(2)]),
  name: requiredText(100),
  startsOn: dateOnly,
  endsOn: dateOnly,
}).refine((input) => input.startsOn <= input.endsOn);

export async function createSchoolTermAction(input: {
  year: number;
  term: 1 | 2;
  name: string;
  startsOn: string;
  endsOn: string;
}): Promise<ActionResult> {
  try {
    const value = parse(termSchema, input);
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("create_school_term", {
      p_year: value.year,
      p_term: value.term,
      p_name: value.name,
      p_starts_on: value.startsOn,
      p_ends_on: value.endsOn,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function activateSchoolTermAction(termId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, termId);
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await supabase.rpc("activate_school_term", { p_term_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}
