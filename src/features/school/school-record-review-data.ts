import "server-only";
import { createClient } from "@/lib/supabase/server";
import { studentStageRpc } from "./student-stage-data";
import { schoolRecordHintsSchema, schoolRecordKey, type SchoolRecordSubject } from "./school-record-review-contract";
import type { LeadPoolRow } from "./lead-contract";

/** 只对当前页请求提示，避免在全库筛选阶段逐人重复查询。 */
export async function readSchoolRecordHints(client: Awaited<ReturnType<typeof createClient>>, subjects: readonly SchoolRecordSubject[]) {
  const result = new Map<string, number>();
  for (let index = 0; index < subjects.length; index += 100) {
    const rows = schoolRecordHintsSchema.parse(await studentStageRpc(client, "read_school_record_hints", { p_subjects: subjects.slice(index, index + 100) }));
    for (const row of rows) result.set(row.key, row.possibleDuplicateCount);
  }
  return result;
}

export async function withLeadRecordHints(client: Awaited<ReturnType<typeof createClient>>, rows: readonly LeadPoolRow[]) {
  const subject = (row: LeadPoolRow) => ({ studentId: row.studentId ?? null, leadId: row.studentId ? null : row.id });
  const hints = await readSchoolRecordHints(client, rows.map(subject));
  return rows.map(row => ({ ...row, possibleDuplicateCount: hints.get(schoolRecordKey(subject(row))) ?? 0 }));
}
