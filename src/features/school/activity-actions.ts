"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getMyPerms } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ACTIVITY_KINDS, type ActivityKind } from "./activity-kinds";
import { COMMON_CODES, datetime, intInRange, parse, requiredText, searchQuery, text, uuid } from "./actions/schemas";
import type { PermissionKey } from "./permissions";

const activityInputSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  title: requiredText(100),
  scheduledAt: datetime,
  durationMin: intInRange(1, 32_767).nullable(),
  location: text(100),
  capacity: intInRange(1, 32_767).nullable(),
  remark: text(1_000),
});

const activityResultSchema = z.object({
  id: uuid,
  status: z.enum(["attended", "no_show", "cancelled"]),
  outcome: text(1_000),
});

export interface ActivityInput {
  kind: ActivityKind;
  title: string;
  scheduledAt: string;
  durationMin: number | null;
  location: string;
  capacity: number | null;
  remark: string;
}

async function authorizedActivityClient(key: PermissionKey) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  if (!(await getMyPerms(user.id)).has(key)) throw new Error("FORBIDDEN");
  return supabase;
}

function activityRpcArgs(input: ActivityInput) {
  const value = parse(activityInputSchema, input);
  return {
    p_kind: value.kind,
    p_title: value.title,
    p_scheduled_at: value.scheduledAt,
    p_duration_min: value.durationMin ?? undefined,
    p_location: value.location,
    p_capacity: value.capacity ?? undefined,
    p_remark: value.remark,
  };
}

const ACTIVITY_ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_KIND",
  "EMPTY_TITLE",
  "NOT_FOUND",
  "ACTIVITY_FULL",
  ...COMMON_CODES,
];

export async function createActivityAction(input: ActivityInput): Promise<ActionResult> {
  try {
    const supabase = await authorizedActivityClient("activity.manage");
    const { error } = await supabase.rpc("create_activity", activityRpcArgs(input));
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function updateActivityAction(id: string, input: ActivityInput): Promise<ActionResult> {
  try {
    const value = parse(uuid, id);
    const supabase = await authorizedActivityClient("activity.manage");
    const { error } = await supabase.rpc("update_activity", {
      p_activity_id: value,
      ...activityRpcArgs(input),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function deleteActivityAction(id: string): Promise<ActionResult> {
  try {
    const value = parse(uuid, id);
    const supabase = await authorizedActivityClient("activity.manage");
    const { error } = await supabase.rpc("delete_activity", { p_activity_id: value });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function bookActivityAction(activityId: string, studentId: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ activityId: uuid, studentId: uuid }), { activityId, studentId });
    const supabase = await authorizedActivityClient("activity.register");
    const { error } = await supabase.rpc("book_activity", {
      p_activity_id: value.activityId,
      p_student_id: value.studentId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function markActivityResultAction(
  id: string,
  status: "attended" | "no_show" | "cancelled",
  outcome: string,
): Promise<ActionResult> {
  try {
    const value = parse(activityResultSchema, { id, status, outcome });
    const supabase = await authorizedActivityClient("activity.register");
    const { error } = await supabase.rpc("mark_activity_result", {
      p_registration_id: value.id,
      p_status: value.status,
      p_outcome: value.outcome,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ACTIVITY_ERROR_CODES);
  }
}

export async function searchStudentsForActivity(query: string) {
  const supabase = await authorizedActivityClient("activity.register");
  const value = parse(searchQuery, query);
  if (!value) return [];
  const escaped = value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const { data, error } = await supabase
    .from("students")
    .select("id,name,grade")
    .is("deleted_at", null)
    .ilike("name", `%${escaped}%`)
    .limit(10)
    .returns<Array<{ id: string; name: string; grade: number | null }>>();
  if (error) throw new Error(error.message);
  return data ?? [];
}
