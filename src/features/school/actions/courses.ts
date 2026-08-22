"use server";

// ---------------------------------------------------------------------------
// 课程 / 讲次 CRUD（P4D-1）与运营学年学期（P4E）。课程归 course.manage，学期归 schedule.manage。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient, nullableRpcArg } from "./guards";
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

function courseMetadataRow(input: CourseWriteInput) {
  const row = courseRow(input);
  return {
    title: row.title,
    product_code: row.product_code,
    grade: row.grade,
    term: row.term,
    class_type: row.class_type,
  };
}

export async function createCourseAction(input: CourseWriteInput): Promise<ActionResult<string>> {
  try {
    const row = courseRow(input);
    const { supabase } = await authorizedClient("course.manage");
    const { data, error } = await supabase
      .rpc("create_legacy_course", {
        p_title: row.title,
        p_product_code: row.product_code ?? "",
        p_grade: row.grade,
        p_course_season: row.term,
        p_class_type: row.class_type,
        p_status: row.status,
      });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("NOT_FOUND");
    return { ok: true, data };
  } catch (error) {
    return actionError<string>(error, ["NOT_FOUND", ...COMMON_CODES]);
  }
}

export async function updateCourseAction(courseId: string, input: CourseWriteInput): Promise<ActionResult> {
  try {
    const id = parse(uuid, courseId);
    const row = courseRow(input);
    const { supabase } = await authorizedClient("course.manage");
    const { data: current, error: currentError } = await supabase
      .from("courses")
      .select("status")
      .eq("id", id)
      .single<{ status: "draft" | "enabled" | "disabled" }>();
    if (currentError) throw new Error(currentError.message);
    const { data, error } = await supabase.from("courses").update(courseMetadataRow(input)).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("NOT_FOUND");
    if (current.status !== row.status) {
      const { error: transitionError } = await supabase.rpc("transition_course_status", {
        p_course_id: id,
        p_target: row.status,
      });
      if (transitionError) throw new Error(transitionError.message);
    }
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
    parse(uuid, lectureId);
    return { ok: false, code: "LECTURE_DELETE_DISABLED" };
  } catch (error) {
    return actionError(error, COMMON_CODES);
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

const SCHOOL_YEAR_CODES = [
  "SCHOOL_YEAR_ALREADY_EXISTS",
  "INVALID_SCHOOL_YEAR",
  "NON_DEFAULT_CAMPUS_SCHOOL_YEAR",
  "TERM_DATES_INCOMPLETE",
  "TERM_DATES_INVALID",
  "SCHOOL_YEAR_NOT_ACTIVE",
  "SCHOOL_YEAR_NOT_PLANNING",
  "SCHOOL_YEAR_SEQUENCE_INVALID",
  "SCHOOL_YEAR_EFFECTIVE_DATE_INVALID",
  "SCHOOL_YEAR_PROMOTION_STALE",
  "SCHOOL_YEAR_PERIODS_INCOMPLETE",
  "NOT_FOUND",
  ...COMMON_CODES,
] as const;

export async function createSchoolYearAction(startYear: number): Promise<ActionResult> {
  try {
    const value = parse(intInRange(2020, 2100), startYear);
    const { supabase } = await authorizedClient("schedule.manage");
    const { error } = await supabase.rpc("create_school_year", { p_start_year: value });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SCHOOL_YEAR_CODES);
  }
}

const termDatesSchema = z.object({
  termId: uuid,
  startsOn: dateOnly.nullable(),
  endsOn: dateOnly.nullable(),
}).refine((input) => (input.startsOn === null) === (input.endsOn === null))
  .refine((input) => input.startsOn === null || input.endsOn === null || input.startsOn <= input.endsOn);

export async function updateSchoolTermDatesAction(input: {
  termId: string;
  startsOn: string | null;
  endsOn: string | null;
}): Promise<ActionResult> {
  try {
    const value = parse(termDatesSchema, input);
    const { supabase } = await authorizedClient("schedule.manage");
    const { error } = await supabase.rpc("update_school_term_dates", {
      p_term_id: value.termId,
      p_starts_on: nullableRpcArg(value.startsOn),
      p_ends_on: nullableRpcArg(value.endsOn),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SCHOOL_YEAR_CODES);
  }
}

export async function activateSchoolTermAction(termId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, termId);
    const { supabase } = await authorizedClient("schedule.manage");
    const { error } = await supabase.rpc("activate_school_term", { p_term_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SCHOOL_YEAR_CODES);
  }
}

const activateSchoolYearSchema = z.object({
  schoolYearId: uuid,
  effectiveOn: dateOnly,
  expectedPromoteCount: intInRange(0, 100_000),
});

export async function activateSchoolYearAction(input: {
  schoolYearId: string;
  effectiveOn: string;
  expectedPromoteCount: number;
}): Promise<ActionResult> {
  try {
    const value = parse(activateSchoolYearSchema, input);
    const { supabase } = await authorizedClient("schedule.manage");
    const { error } = await supabase.rpc("activate_school_year", {
      p_school_year_id: value.schoolYearId,
      p_effective_on: value.effectiveOn,
      p_expected_promote_count: value.expectedPromoteCount,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, SCHOOL_YEAR_CODES);
  }
}
