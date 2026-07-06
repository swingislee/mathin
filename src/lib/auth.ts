import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser(locale: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}
