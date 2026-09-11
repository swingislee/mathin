import "server-only";
import { createClient } from "@/lib/supabase/server";
import { teachingWorkbenchSchema } from "./teaching-workbench-contract";

export async function getTeachingWorkbench(from: string, to: string, scope: "mine" | "team") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_teaching_workbench", { p_from: from, p_to: to, p_scope: scope });
  if (error) throw new Error(error.message);
  return teachingWorkbenchSchema.parse(data);
}
