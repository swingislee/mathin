import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ProfileRole = "student" | "teacher" | "admin";

export async function requireUser(locale: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

/** 服务端教师判定（docs/plan/03-3.1）：查 profiles.role，admin 视同教师。 */
export async function requireTeacher(locale: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: ProfileRole }>();
  if (profile?.role !== "teacher" && profile?.role !== "admin") redirect(`/${locale}/dashboard`);
  return user;
}
