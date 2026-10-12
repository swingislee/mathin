import { getNow, setRequestLocale } from "next-intl/server";
import { getMyPerms, getProfile, requireAnyPerm } from "@/lib/auth";
import { CalendarWorkbench } from "@/features/school/CalendarWorkbench";
import { getOrganizationTimezoneV2, listActiveRoomOptionsV2 } from "@/features/school/organization-locations";
import { AssessmentRulesWorkbench } from "@/features/school/AssessmentRulesWorkbench";
import { loadAssessmentRulesAction } from "@/features/school/assessment-rules-actions";
import { Link } from "@/i18n/navigation";

export default async function AssessmentAvailabilityPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ view?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["review.write", "followup.write", "schedule.manage"]);
  const view = (await searchParams).view;
  if (view !== "calendar") {
    const [result, now, timeZone] = await Promise.all([loadAssessmentRulesAction(), getNow(), getOrganizationTimezoneV2()]);
    return <AssessmentRulesWorkbench initial={result.ok ? result.data : null} initialError={result.ok ? undefined : result.code} now={now.getTime()} timeZone={timeZone} initialView={view === "validity" ? "validity" : view === "topics" ? "topics" : "rules"} />;
  }
  const [now, permissions, profile, timeZone, roomOptions] = await Promise.all([
    getNow(), getMyPerms(user.id), getProfile(user.id), getOrganizationTimezoneV2(), listActiveRoomOptionsV2(),
  ]);
  return <><Link href="/dashboard/assessments/availability" className="text-sm underline">{locale === "en" ? "Teacher rules and topics" : "老师规则与诊断主题"}</Link><CalendarWorkbench locale={locale} timeZone={timeZone} now={now.getTime()} mode="availability"
    currentUserId={user.id} currentUserName={profile?.displayName ?? ""} roomOptions={roomOptions}
    canManageAvailability canManageLessons={permissions.has("class.manage")} /></>;
}
