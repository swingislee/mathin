import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActivitiesManager } from "@/features/school/ActivitiesManager";
import { listActivities } from "@/features/school/activities";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPublicClassRegistration } from "@/features/school/public-class-registration-data";
import { DashboardRevisitFreshness } from "@/features/school/dashboard-page/DashboardRevisitFreshness";
import { newId } from "@/lib/uuid";

// 30 秒内回到本页直接复用浏览器里的名单；本机保存过数据时由 DashboardRevisitFreshness 在后台重新读取。
export const unstable_dynamicStaleTime = 30;

const ACTIVITY_WORKSPACE_PERMISSIONS = ["activity.manage", "activity.register", "review.write", "followup.view"] as const;

export default async function ActivitiesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ activity?: string; q?: string }> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ACTIVITY_WORKSPACE_PERMISSIONS);
  const [t, rows, permissions] = await Promise.all([
    getTranslations("school.activities"),
    listActivities(),
    getMyPerms(user.id),
  ]);
  const supabase = await createClient();
  const assigned = permissions.has("activity.manage") ? null : await supabase.from("public_class_segments")
    .select("activity_id").neq("kind", "group_assessment").or(`primary_teacher_id.eq.${user.id},assistant_teacher_id.eq.${user.id}`);
  if (assigned?.error) throw new Error(assigned.error.message);
  const initialRegistrationData = rows.some((row) => row.id === query.activity && row.kind === "public_class")
    ? await loadPublicClassRegistration(query.activity!) : undefined;
  return <><DashboardRevisitFreshness renderId={newId()} /><ActivitiesManager
    title={t("title")}
    activities={rows}
    canManage={permissions.has("activity.manage")}
    initialActivityId={query.activity}
    teachingActivityIds={permissions.has("activity.manage") ? rows.map((row) => row.id) : (assigned?.data ?? []).map((row) => row.activity_id)}
    initialRegistrationData={initialRegistrationData}
    initialQuery={query.q?.slice(0,100)}
  /></>;
}
