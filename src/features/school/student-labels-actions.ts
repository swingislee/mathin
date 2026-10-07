"use server";

import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { staffRpcClient } from "./actions/guards";
import { setStudentLabelSchema, studentLabelStateSchema, type SetStudentLabelInput, type StudentLabelState, type StudentLabelsClient } from "./student-labels-contract";

export async function setClassStudentLabelAction(input: SetStudentLabelInput): Promise<ActionResult<StudentLabelState>> {
  try {
    const parsed = setStudentLabelSchema.safeParse(input);
    if (!parsed.success) throw new Error("VALIDATION");
    const { supabase } = await staffRpcClient();
    const client = supabase as unknown as StudentLabelsClient;
    const { data, error } = await client.rpc("set_class_student_label", {
      p_enrollment_id: parsed.data.enrollmentId, p_label: parsed.data.label,
    });
    if (error) throw new Error(error.message);
    const result = studentLabelStateSchema.parse(data);
    revalidatePath("/[locale]/dashboard/classes", "page");
    revalidatePath("/[locale]/dashboard/classes/[classId]", "page");
    revalidatePath("/[locale]/dashboard/short-courses/[classId]", "page");
    revalidatePath("/[locale]/dashboard/enrollments", "page");
    return { ok: true, data: result };
  } catch (error) {
    return actionError(error, ["UNAUTHENTICATED", "FORBIDDEN", "CLASS_MEMBERSHIP_NOT_ACTIVE", "CLASS_NOT_EDITABLE", "VALIDATION"]);
  }
}
