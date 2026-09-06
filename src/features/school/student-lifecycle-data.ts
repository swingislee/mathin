import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { nullableRpcArg } from "./actions/guards";
import { parseStudentLifecycleStage } from "./student-lifecycle-contract";
import type { Student360SubjectRef } from "./student-360-contract";

/** 里程碑由完整业务事实聚合，时间轴分页不参与标签计算。 */
export async function readStudentLifecycle(
  client: Awaited<ReturnType<typeof createClient>>,
  subject: Student360SubjectRef,
) {
  const result = await client.rpc("get_student_lifecycle", {
    p_student_id: nullableRpcArg(subject.studentId), p_lead_id: nullableRpcArg(subject.leadId),
  });
  if (result.error) throw new Error(result.error.message);
  return parseStudentLifecycleStage(result.data);
}
