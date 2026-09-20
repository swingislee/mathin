"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { getMyPerms } from "@/lib/auth";
import { databaseUuid } from "@/lib/database-uuid";
import { parse } from "./actions/schemas";
import { listAssessmentWorkbenchRows } from "./assessment-workbench-data";
import type { AssessmentWorkbenchRow } from "./assessment-workbench-contract";

const rowKeySchema = z.string().max(100).refine(value => {
  const [kind, id, registration] = value.split(":");
  return databaseUuid.safeParse(id).success && (kind === "segment"
    ? value.split(":").length === 3 && databaseUuid.safeParse(registration).success
    : ["invitation", "registration"].includes(kind) && value.split(":").length === 2);
});

/** 只信任数据库返回的主体关联；客户端行键不授予身份或记录访问权限。 */
export async function getAssessmentListDetailAction(input: string): Promise<ActionResult<AssessmentWorkbenchRow>> {
  try {
    const key = parse(rowKeySchema, input);
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const perms = await getMyPerms(user.id);
    if (!perms.has("review.write") && !perms.has("followup.view")) throw new Error("FORBIDDEN");
    const [kind, id, registration] = key.split(":");
    let subject: { studentId: string | null; leadId: string | null };
    if (kind === "invitation") {
      const result = await client.from("lead_invitation_threads").select("lead_id,leads(student_id)").eq("id", id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error("NOT_FOUND");
      subject = { studentId: result.data.leads?.student_id ?? null, leadId: result.data.lead_id };
    } else {
      const result = await client.from("activity_registrations").select("student_id,lead_id,leads(student_id)").eq("id", registration ?? id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error("NOT_FOUND");
      subject = { studentId: result.data.student_id ?? result.data.leads?.student_id ?? null, leadId: result.data.lead_id };
    }
    const row = (await listAssessmentWorkbenchRows(subject)).find(row => row.id === key);
    if (!row) throw new Error("NOT_FOUND");
    return { ok: true, data: row };
  } catch (error) { return actionError(error, ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION"]); }
}
