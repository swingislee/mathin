import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActivitiesManager } from "@/features/school/ActivitiesManager";
import { listActivities } from "@/features/school/activities";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPublicClassRegistration } from "@/features/school/public-class-registration-data";
import { BusinessHistoryWorkspace } from "@/features/school/BusinessHistoryWorkspace";
import { canReadStudentBusinessHistory } from "@/features/school/student-business-history-data";

const ACTIVITY_WORKSPACE_PERMISSIONS = ["activity.register", "review.write", "followup.view"] as const;

export default async function ActivitiesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ activity?: string; view?: string; q?: string }> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ACTIVITY_WORKSPACE_PERMISSIONS);
  if (query.view === "history") return <BusinessHistoryWorkspace locale={locale} kind="activity" query={query.q?.slice(0, 100)} />;
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
  return <ActivitiesManager
    title={t("title")}
    activities={rows}
    canManage={permissions.has("activity.manage")}
    initialActivityId={query.activity}
    teachingActivityIds={permissions.has("activity.manage") ? rows.map((row) => row.id) : (assigned?.data ?? []).map((row) => row.activity_id)}
    initialRegistrationData={initialRegistrationData}
    showHistory={await canReadStudentBusinessHistory(locale)}
  />;
}
