import "server-only";

import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import type { MonthlyTargetPlan, MonthlyTargetRead } from "./monthly-targets-contract";

const count = z.number().int().min(0).max(1000000);
const sourceSchema = z.object({
  label: z.string(), capturedOn: z.string(), sha256: z.string(),
  teachers: z.array(z.string()), grades: z.array(z.string()),
  cells: z.array(z.object({ teacher: z.string(), grade: z.string(), actual: count, undated: count })),
  enrollments: count, enrollmentTarget: count, arrivals: count, arrivalTarget: count,
  invitations: count, invitationTarget: count, missingDate: count, unassignedTeacher: count,
});
const cellsSchema = z.array(z.object({ teacher: z.string(), grade: z.string(), target: count.nullable() }));

export function monthlyTargetPlan(row: Database["public"]["Tables"]["school_monthly_targets"]["Row"]): MonthlyTargetPlan {
  if (row.target_basis !== "source" && row.target_basis !== "teacher_grade") throw new Error("INVALID_TARGET_DATA");
  return {
    month: row.month.slice(0, 7), revision: row.revision,
    cells: cellsSchema.parse(row.teacher_grade_targets),
    enrollmentTarget: row.enrollment_target, arrivalTarget: row.arrival_target,
    invitationTarget: row.invitation_target, basis: row.target_basis,
    source: sourceSchema.parse(row.source_snapshot), updatedAt: row.updated_at,
  };
}

export async function readMonthlyTargets(month: string): Promise<MonthlyTargetRead> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { available: false, plan: null };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("school_monthly_targets").select("*").eq("month", `${month}-01`).maybeSingle();
    if (error) return { available: false, plan: null };
    return { available: true, plan: data ? monthlyTargetPlan(data) : null };
  } catch {
    return { available: false, plan: null };
  }
}
