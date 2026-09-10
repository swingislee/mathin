"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { actionError, type ActionResult } from "@/lib/action-result";
import { studentStageRpc } from "../student-stage-data";
import { schoolRecordSubjectSchema, schoolRecordContextSchema, type SchoolRecordContext } from "../school-record-review-contract";
import { parse } from "./schemas";

const schema = z.object({ subject: schoolRecordSubjectSchema, page: z.number().int().min(1).max(100000).default(1) });
export async function getSchoolRecordContextAction(input: z.input<typeof schema>): Promise<ActionResult<SchoolRecordContext>> {
  try {
    const value = parse(schema, input), client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const data = schoolRecordContextSchema.parse(await studentStageRpc(client, "read_school_record_source_context", {
      p_student_id: value.subject.studentId, p_lead_id: value.subject.leadId, p_page: value.page,
    }));
    return { ok: true, data };
  } catch (error) { return actionError(error, ["VALIDATION", "UNAUTHENTICATED", "FORBIDDEN"]); }
}
