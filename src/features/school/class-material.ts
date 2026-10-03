import "server-only";
import { createClient } from "@/lib/supabase/server";
import { materialOptionsSchema } from "./class-material-contract";
import { nullableRpcArg } from "./actions/guards";

export async function getCourseMaterialOptions(purpose: "production" | "test" = "production", sourceClassroomId: string | null = null) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_course_material_options", {
    p_purpose: purpose, p_source_classroom_id: nullableRpcArg(sourceClassroomId),
  });
  if (error) throw new Error(error.message);
  return materialOptionsSchema.parse(data);
}
