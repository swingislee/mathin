import { getNow, setRequestLocale } from "next-intl/server";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { AssessmentAvailabilityWorkbench } from "@/features/school/AssessmentAvailabilityWorkbench";
import { loadAssessmentSlotManagementAction } from "@/features/school/assessment-availability-actions";
import { shiftAssessmentSlotDate } from "@/features/school/assessment-availability-contract";
import { ASSESSMENT_TIME_ZONE } from "@/features/school/invitation-contract";
import { calendarDayKey } from "@/features/school/schedule";

export default async function AssessmentAvailabilityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["review.write", "followup.write", "schedule.manage"]);
  const [now, permissions] = await Promise.all([getNow(), getMyPerms(user.id)]);
  const timeZone = ASSESSMENT_TIME_ZONE;
  const from = calendarDayKey(now, timeZone);
  const result = await loadAssessmentSlotManagementAction({ from, to: shiftAssessmentSlotDate(from, 13, timeZone) });
  return <AssessmentAvailabilityWorkbench locale={locale} timeZone={timeZone} now={now.getTime()} initialFrom={from}
    canViewAssessments={permissions.has("review.write") || permissions.has("followup.view")}
    initialData={result.ok ? result.data : null} initialError={result.ok ? null : result.code} />;
}
