import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { studentLabelStateSchema, type StudentLabelsClient, type StudentLabelStates } from "./student-labels-contract";

/** Reads only the classes already present in the current roster; the RPC checks scope again. */
export async function loadClassStudentLabels(classroomIds: string[]): Promise<StudentLabelStates> {
  if (!classroomIds.length) return {};
  const client = await createClient() as unknown as StudentLabelsClient;
  const { data, error } = await client.rpc("get_class_student_labels", { p_classroom_ids: [...new Set(classroomIds)] });
  if (error) throw new Error("STUDENT_LABELS_READ_FAILED");
  return Object.fromEntries(z.array(studentLabelStateSchema).parse(data).map(row => [row.enrollmentId, row]));
}
