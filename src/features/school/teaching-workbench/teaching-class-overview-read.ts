import "server-only";
import { createClient } from "@/lib/supabase/server";
import { teachingClassOverviewSchema } from "./teaching-class-overview-contract";

export async function getTeachingClassOverview(from: string, to: string, scope: "mine" | "team") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_teaching_class_overview", { p_from: from, p_to: to, p_scope: scope });
  if (error) throw new Error(error.message);
  const overview = teachingClassOverviewSchema.parse(data);
  const ids = [...new Set(overview.workbench.sessions.map(session => session.classroomId))];
  // 只补读取当前授权概览内班级的年级，按批避免逐班请求与长 URL。
  const batches = await Promise.all(Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
    supabase.from("classrooms").select("id,grade").in("id", ids.slice(index * 100, (index + 1) * 100))));
  const failed = batches.find(result => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  const grades = new Map(batches.flatMap(result => result.data ?? []).map(row => [row.id, row.grade]));
  return { ...overview, workbench: { ...overview.workbench, sessions: overview.workbench.sessions.map(session => ({ ...session, classroomGrade: grades.get(session.classroomId) ?? null })) } };
}
