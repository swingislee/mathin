"use server";

// ---------------------------------------------------------------------------
// 学生域写入口（P4C-6 / P4D-0）：建档、查重合并、档案编辑、分派、批量导入、
// 软删与回收、状态流转、手机号开户。create_student RPC 只收姓名/年级/电话；
// 来源与备注是 students 直列，由 RPC 内部补写。
// ---------------------------------------------------------------------------

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import type { PermissionKey } from "../permissions";
import { STUDENT_STATUSES, type StudentStatus } from "../students";
import { authorizedClient } from "./guards";
import { COMMON_CODES, dateOnly, intInRange, parse, requiredText, text, uuid } from "./schemas";
import type {
  CreateStudentInput,
  DuplicateStudentRow,
  ImportStudentRow,
  ImportStudentsResult,
  UpdateStudentInput,
} from "./types";

const grade = intInRange(1, 12);

const createStudentSchema = z.object({
  name: requiredText(100),
  grade: grade.nullable(),
  phone: text(40),
  region: text(100).optional(),
  source: text(100),
  parentName: text(100).optional(),
  parentPhone: text(40).optional(),
  remark: text(2000),
});

export async function createStudentAction(input: CreateStudentInput): Promise<ActionResult<string>> {
  try {
    const value = parse(createStudentSchema, input);
    const { supabase } = await authorizedClient("student.create");
    const { data, error } = await supabase.rpc("create_student", {
      p_name: value.name,
      p_grade: value.grade ?? undefined,
      p_phone: value.phone,
      p_region: value.region ?? "",
      p_source: value.source,
      p_parent_name: value.parentName ?? "",
      p_parent_phone: value.parentPhone ?? "",
      p_remark: value.remark,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: data as string };
  } catch (error) {
    return actionError<string>(error, COMMON_CODES);
  }
}

const duplicateSchema = z.object({ name: text(100), phone: text(40) });

async function findDuplicateStudents(permKey: PermissionKey, name: string, phone: string): Promise<ActionResult<DuplicateStudentRow[]>> {
  try {
    const value = parse(duplicateSchema, { name, phone });
    const { supabase } = await authorizedClient(permKey);
    const { data, error } = await supabase.rpc("find_duplicate_students", { p_name: value.name, p_phone: value.phone });
    if (error) throw new Error(error.message);
    return { ok: true, data: (data ?? []) as DuplicateStudentRow[] };
  } catch (error) {
    return actionError<DuplicateStudentRow[]>(error, COMMON_CODES);
  }
}

export async function findDuplicateStudentsAction(name: string, phone: string): Promise<ActionResult<DuplicateStudentRow[]>> {
  return findDuplicateStudents("student.create", name, phone);
}

export async function findDuplicateStudentsForMergeAction(name: string, phone: string): Promise<ActionResult<DuplicateStudentRow[]>> {
  return findDuplicateStudents("student.edit", name, phone);
}

export async function mergeStudentsAction(keptId: string, mergedId: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ keptId: uuid, mergedId: uuid }), { keptId, mergedId });
    const { supabase } = await authorizedClient("student.edit");
    const { error } = await supabase.rpc("merge_students", { p_kept_id: value.keptId, p_merged_id: value.mergedId });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

const PHONE_PROVISION_CODES = [
  "FORBIDDEN_SCOPE",
  "ACCOUNT_ALREADY_LINKED",
  "INVALID_PHONE",
  "ACCOUNT_CREATE_FAILED",
  "ACCOUNT_LINK_FAILED",
  ...COMMON_CODES,
] as const;

export async function provisionStudentPhoneAccountAction(studentId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, studentId);
    const { supabase, user } = await authorizedClient("student.edit");
    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id,name,phone,user_id")
      .eq("id", id)
      .maybeSingle<{ id: string; name: string; phone: string; user_id: string | null }>();
    if (studentError) throw new Error(studentError.message);
    if (!student) throw new Error("FORBIDDEN_SCOPE");
    if (student.user_id) throw new Error("ACCOUNT_ALREADY_LINKED");
    const phone = student.phone.replace(/[\s()-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("INVALID_PHONE");
    const admin = createAdminClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      phone,
      phone_confirm: true,
      user_metadata: { display_name: student.name },
    });
    if (createError || !created.user) throw new Error(createError?.message ?? "ACCOUNT_CREATE_FAILED");
    const { data: linked, error: linkError } = await admin
      .from("students")
      .update({ user_id: created.user.id })
      .eq("id", id)
      .is("user_id", null)
      .select("id");
    if (linkError || !linked?.length) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw new Error(linkError?.message ?? "ACCOUNT_LINK_FAILED");
    }
    await admin.from("domain_events").insert({
      actor_id: user.id,
      event_type: "student.phone_account_provisioned",
      entity_type: "student",
      entity_id: id,
      target_user_id: created.user.id,
      payload: { phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}` },
    });
    return { ok: true };
  } catch (error) {
    return actionError(error, PHONE_PROVISION_CODES);
  }
}

const updateStudentSchema = z.object({
  studentId: uuid,
  name: requiredText(100),
  gender: text(30),
  birthday: dateOnly.nullable(),
  phone: text(40),
  wechat: text(80),
  school: text(100),
  grade: grade.nullable(),
  region: text(100),
  source: text(100),
  parentName: text(100),
  parentRelation: text(40),
  parentPhone: text(40),
  remark: text(2000),
});

export async function updateStudentAction(studentId: string, input: UpdateStudentInput): Promise<ActionResult> {
  try {
    const value = parse(updateStudentSchema, { studentId, ...input });
    const { supabase } = await authorizedClient("student.edit");
    const { data, error } = await supabase
      .from("students")
      .update({
        name: value.name,
        gender: value.gender,
        birthday: value.birthday,
        phone: value.phone,
        wechat: value.wechat,
        school: value.school,
        grade: value.grade,
        region: value.region,
        source: value.source,
        parent_name: value.parentName,
        parent_relation: value.parentRelation,
        parent_phone: value.parentPhone,
        remark: value.remark,
      })
      .eq("id", value.studentId)
      .is("deleted_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error("NOT_FOUND");
    return { ok: true };
  } catch (error) {
    return actionError(error, ["NOT_FOUND", ...COMMON_CODES]);
  }
}

export async function assignStudentAction(studentId: string, staffUserId: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ studentId: uuid, staffUserId: uuid }), { studentId, staffUserId });
    const { supabase } = await authorizedClient("student.assign");
    const { error } = await supabase.rpc("assign_student", {
      p_student_id: value.studentId,
      p_staff_user_id: value.staffUserId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

// 导入行的年级由 RPC 侧解析（表格里可能是 "三年级" 这类字符串），这里只挡住形状与体量。
const importRowsSchema = z
  .array(
    z.object({
      name: text(100),
      phone: text(40),
      grade: z.union([z.number(), z.string().max(20), z.null()]),
      region: text(100),
      source: text(100),
      remark: text(2000),
    }),
  )
  .max(500);

export async function importStudentsAction(rows: ImportStudentRow[]): Promise<ActionResult<ImportStudentsResult>> {
  try {
    if (rows.length > 500) throw new Error("TOO_MANY_ROWS");
    const value = parse(importRowsSchema, rows);
    const { supabase } = await authorizedClient("student.import");
    const { data, error } = await supabase.rpc("import_students", { p_rows: value as unknown as Json });
    if (error) throw new Error(error.message);
    const result = data as Partial<ImportStudentsResult> | null;
    return {
      ok: true,
      data: {
        inserted: Number(result?.inserted) || 0,
        dup: Number(result?.dup) || 0,
        errors: Array.isArray(result?.errors) ? result.errors : [],
      },
    };
  } catch (error) {
    return actionError<ImportStudentsResult>(error, ["TOO_MANY_ROWS", ...COMMON_CODES]);
  }
}

export async function softDeleteStudentAction(studentId: string): Promise<{ ok: true } | { ok: false; code: "ACTIVE_ENROLLMENT" | "FAILED" }> {
  const id = parse(uuid, studentId);
  const { supabase } = await authorizedClient("student.delete");
  const { error } = await supabase.rpc("soft_delete_student", { p_student_id: id });
  if (!error) return { ok: true };
  return { ok: false, code: error.message.includes("ACTIVE_ENROLLMENT") ? "ACTIVE_ENROLLMENT" : "FAILED" };
}

export async function restoreStudentAction(studentId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, studentId);
    const { supabase } = await authorizedClient("student.delete");
    const { error } = await supabase.rpc("restore_student", { p_student_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function recoverLostStudentAction(studentId: string): Promise<ActionResult> {
  try {
    const id = parse(uuid, studentId);
    const { supabase } = await authorizedClient("student.edit");
    const { error } = await supabase.rpc("recover_lost_student", { p_student_id: id });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}

export async function changeStudentStatusAction(studentId: string, status: StudentStatus): Promise<ActionResult> {
  try {
    const value = parse(z.object({ studentId: uuid, status: z.enum(STUDENT_STATUSES) }), { studentId, status });
    const { supabase } = await authorizedClient("student.edit");
    const { error } = await supabase.rpc("change_student_status", { p_student_id: value.studentId, p_status: value.status });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, COMMON_CODES);
  }
}
