import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ClassroomOperationalStatus, ClassroomPurpose, ClassroomScope } from "./types";

export interface ClassroomListFilters {
  q?: string;
  teacherId?: string;
  supportId?: string;
  grade?: number;
  schoolTermId?: string;
  operationalStatus?: ClassroomOperationalStatus;
  purpose?: ClassroomPurpose;
  readiness?: "ready" | "incomplete";
  page: number;
}

export interface ClassroomListItem {
  id: string;
  name: string;
  purpose: ClassroomPurpose;
  operationalStatus: ClassroomOperationalStatus;
  archivedAt: string | null;
  courseFamilyTitle: string | null;
  courseTitle: string | null;
  courseProductCode: string | null;
  primaryTeacherName: string | null;
  learningSupportNames: string[];
  enrolledCount: number;
  capacity: number | null;
  sessionDoneCount: number;
  sessionTotalCount: number;
  nextSessionAt: string | null;
  readiness: "ready" | "incomplete";
  anomalyCount: number;
}

export interface ClassroomListResult {
  classrooms: ClassroomListItem[];
  totalCount: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseClassroomListFilters(input: Record<string, string | string[] | undefined>): ClassroomListFilters {
  const q = first(input.q)?.trim().slice(0, 80) || undefined;
  const teacherId = first(input.teacherId);
  const supportId = first(input.supportId);
  const grade = Number(first(input.grade));
  const schoolTermId = first(input.schoolTermId);
  const operationalStatus = first(input.operationalStatus);
  const purpose = first(input.purpose);
  const readiness = first(input.readiness);
  const page = Math.max(1, Number(first(input.page)) || 1);
  return {
    q,
    teacherId: teacherId && UUID_PATTERN.test(teacherId) ? teacherId : undefined,
    supportId: supportId && UUID_PATTERN.test(supportId) ? supportId : undefined,
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 12 ? grade : undefined,
    schoolTermId: schoolTermId && UUID_PATTERN.test(schoolTermId) ? schoolTermId : undefined,
    operationalStatus: operationalStatus === "planning" || operationalStatus === "active" || operationalStatus === "completed" ? operationalStatus : undefined,
    purpose: purpose === "production" || purpose === "test" ? purpose : undefined,
    readiness: readiness === "ready" || readiness === "incomplete" ? readiness : undefined,
    page,
  };
}

/**
 * 与 resolveCourseScope 不同，这里必须查库：学辅（sales 岗位）没有任何 class.* 权限，
 * 默认可见 scope 完全取决于 classroom_staff_assignments 是否存在，无法用静态权限集推出。
 */
export async function resolveClassroomScope(requestedScope: string | string[] | undefined): Promise<{ scope: ClassroomScope; availableScopes: ClassroomScope[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_classroom_scope", { p_requested: first(requestedScope) ?? undefined });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("FORBIDDEN");
  return {
    scope: row.resolved_scope as ClassroomScope,
    availableScopes: row.available_scopes as ClassroomScope[],
  };
}

export async function listClassroomsForScope(scope: ClassroomScope, filters: ClassroomListFilters): Promise<ClassroomListResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_classrooms_for_scope", {
    p_scope: scope,
    p_filters: {
      q: filters.q ?? "",
      teacherId: filters.teacherId ?? "",
      supportId: filters.supportId ?? "",
      grade: filters.grade?.toString() ?? "",
      schoolTermId: filters.schoolTermId ?? "",
      operationalStatus: filters.operationalStatus ?? "",
      purpose: filters.purpose ?? "",
      readiness: filters.readiness ?? "",
    },
    p_page: filters.page,
  });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const classrooms = rows.map((row): ClassroomListItem => ({
    id: row.id,
    name: row.name,
    purpose: row.purpose as ClassroomPurpose,
    operationalStatus: row.operational_status as ClassroomOperationalStatus,
    archivedAt: row.archived_at,
    courseFamilyTitle: row.course_family_title,
    courseTitle: row.course_title,
    courseProductCode: row.course_product_code,
    primaryTeacherName: row.primary_teacher_name,
    learningSupportNames: row.learning_support_names ?? [],
    enrolledCount: row.enrolled_count,
    capacity: row.capacity,
    sessionDoneCount: row.session_done_count,
    sessionTotalCount: row.session_total_count,
    nextSessionAt: row.next_session_at,
    readiness: row.readiness as "ready" | "incomplete",
    anomalyCount: row.anomaly_count,
  }));
  return { classrooms, totalCount: rows[0]?.total_count ?? 0 };
}
