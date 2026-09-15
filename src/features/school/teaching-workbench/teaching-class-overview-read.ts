import "server-only";
import { createClient } from "@/lib/supabase/server";
import { teachingClassOverviewSchema } from "./teaching-class-overview-contract";

export async function getTeachingClassOverview(from: string, to: string, scope: "mine" | "team") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_teaching_class_overview", { p_from: from, p_to: to, p_scope: scope });
  if (error) throw new Error(error.message);
  return teachingClassOverviewSchema.parse(data);
}
