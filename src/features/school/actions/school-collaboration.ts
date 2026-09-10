"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { actionError, type ActionResult } from "@/lib/action-result";
import { studentStageRpc, studentStageRowSchema } from "../student-stage-data";
import { schoolCollaborationSchema, SCHOOL_BUSINESS_ROLES, type SchoolCollaborationSettings } from "../school-collaboration-contract";
import type { StudentStageRow } from "../student-stage-contract";
import { parse, requiredText, uuid } from "./schemas";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group"), id: uuid.nullable(), name: requiredText(80) }),
  z.object({ kind: z.literal("member"), groupId: uuid, userId: uuid, active: z.boolean() }),
  z.object({ kind: z.literal("role"), userId: uuid, role: z.enum(SCHOOL_BUSINESS_ROLES) }),
  z.object({ kind: z.literal("participant"), studentId: uuid.nullable(), leadId: uuid.nullable(), userId: uuid.nullable(),
    role: z.enum([...SCHOOL_BUSINESS_ROLES, "participant"]), groupId: uuid.nullable() }),
]);
type Input = z.infer<typeof schema>;
type Result = { settings: SchoolCollaborationSettings; subject?: StudentStageRow };

export async function saveSchoolCollaborationAction(input: Input): Promise<ActionResult<Result>> {
  try {
    const value = parse(schema, input), client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    if (value.kind === "group") await studentStageRpc(client, "save_school_business_group", { p_id: value.id, p_name: value.name });
    else if (value.kind === "member") await studentStageRpc(client, "set_school_business_group_member", { p_group_id: value.groupId, p_user_id: value.userId, p_active: value.active });
    else if (value.kind === "role") await studentStageRpc(client, "set_school_staff_business_role", { p_user_id: value.userId, p_role: value.role });
    else await studentStageRpc(client, "add_school_subject_collaborator", { p_student_id: value.studentId, p_lead_id: value.leadId,
      p_user_id: value.userId, p_role: value.role, p_group_id: value.groupId });
    const settings = schoolCollaborationSchema.parse(await studentStageRpc(client, "read_school_collaboration_settings", {}));
    const subject = value.kind === "participant" ? studentStageRowSchema.parse(await studentStageRpc(client, "read_student_record_subject", {
      p_student_id: value.studentId, p_lead_id: value.leadId,
    })) : undefined;
    return { ok: true, data: { settings, ...(subject ? { subject } : {}) } };
  } catch (error) {
    return actionError(error, ["VALIDATION", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"]);
  }
}
