import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { studentStageRowSchema, studentStageRpc } from "./student-stage-data";
import { directorySelectionSchema, toStudentDirectoryCard, type StudentDirectoryFilters } from "./student-directory-contract";

const pageSchema = z.object({
  rows: z.array(studentStageRowSchema.extend({ studentId: z.string().uuid(), directoryGroups: z.array(z.object({ id: z.string(), name: z.string() })) })),
  count: z.number().int().nonnegative(), page: z.number().int().positive(), totalPages: z.number().int().positive(),
  pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]),
  groups: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int().nonnegative() })),
  counts: z.record(z.string(), z.number().int().nonnegative()),
});
async function readDirectory(filters: StudentDirectoryFilters, selected?: string[]) {
  return pageSchema.parse(await studentStageRpc(await createClient(), "list_student_directory", {
    p_scope: filters.scope, p_search: filters.q, p_stage: filters.stage, p_group_by: filters.groupBy, p_group: filters.group,
    p_page: filters.page, p_page_size: filters.pageSize, p_selected: selected ?? null,
  }));
}
export async function loadStudentDirectory(filters: StudentDirectoryFilters) {
  const { rows, ...page } = await readDirectory(filters);
  return { ...page, students: rows.flatMap(row => { const card = toStudentDirectoryCard(row); return card ? [card] : []; }) };
}
export async function loadDirectoryContactSelection(ids: string[]) {
  const selected = directorySelectionSchema.parse(ids);
  return readDirectory({ scope: "all", q: "", stage: "all", groupBy: "none", group: "", page: 1, pageSize: 100 }, selected);
}
