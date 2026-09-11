import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** 按实际教师岗位选择展示默认值；页面和写入继续使用原有权限。 */
export const isTeacherWorkspaceViewer = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("staff_role_members")
    .select("staff_roles!staff_role_members_role_id_fkey(key)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).some(row => row.staff_roles?.key === "teacher");
});
