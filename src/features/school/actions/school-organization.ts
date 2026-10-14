"use server";

import { getAuthUser } from "@/lib/auth";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { actionError, type ActionResult } from "@/lib/action-result";
import { studentStageRpc } from "../student-stage-data";
import { schoolCollaborationSchema, SCHOOL_BUSINESS_ROLES, SCHOOL_ORGANIZATION_KINDS, SCHOOL_STAFF_RESERVE_REASONS, type SchoolCollaborationSettings } from "../school-collaboration-contract";
import { parse, requiredText, uuid } from "./schemas";

const schema = z.object({
  units: z.array(z.object({ id: uuid, name: requiredText(80), kind: z.enum(SCHOOL_ORGANIZATION_KINDS), parentId: uuid.nullable(), sortOrder: z.number().int().min(0).max(100000) })).max(500),
  archive: z.array(uuid).max(500),
  members: z.array(z.object({ groupId: uuid, userId: uuid, active: z.boolean(), lead: z.boolean() })).max(500),
  roles: z.array(z.object({ userId: uuid, roles: z.array(z.enum(SCHOOL_BUSINESS_ROLES)).max(3) })).max(500),
  reserve: z.array(z.object({ userId: uuid, reason: z.enum(SCHOOL_STAFF_RESERVE_REASONS).nullable() })).max(500),
});

export async function saveSchoolOrganizationAction(input: z.infer<typeof schema>): Promise<ActionResult<{ settings: SchoolCollaborationSettings }>> {
  try {
    const value = parse(schema, input), client = await createClient();
    const user = await getAuthUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const settings = schoolCollaborationSchema.parse(await studentStageRpc(client, "save_school_organization", { p_changes: value }));
    for (const page of ["staff", "leads", "communication", "students", "students/[studentId]", "assessments/availability"]) {
      revalidatePath(`/[locale]/dashboard/${page}`, "page");
    }
    return { ok: true, data: { settings } };
  } catch (error) {
    return actionError(error, ["VALIDATION", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "TARGET_CANNOT_FOLLOW_UP",
      "GROUP_NAME_TAKEN", "ORGANIZATION_CYCLE", "GROUP_NOT_EMPTY", "GROUP_IN_USE", "STAFF_IN_ORGANIZATION"]);
  }
}

