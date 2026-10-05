import { getNow, setRequestLocale } from "next-intl/server";
import { getMyPerms, getProfile, requireAnyPerm } from "@/lib/auth";
import { CalendarWorkbench } from "@/features/school/CalendarWorkbench";
import { getOrganizationTimezoneV2, listActiveRoomOptionsV2 } from "@/features/school/organization-locations";

export default async function AssessmentAvailabilityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["review.write", "followup.write", "schedule.manage"]);
  const [now, permissions, profile, timeZone, roomOptions] = await Promise.all([
    getNow(), getMyPerms(user.id), getProfile(user.id), getOrganizationTimezoneV2(), listActiveRoomOptionsV2(),
  ]);
  return <CalendarWorkbench locale={locale} timeZone={timeZone} now={now.getTime()} mode="availability"
    currentUserId={user.id} currentUserName={profile?.displayName ?? ""} roomOptions={roomOptions}
    canManageAvailability canManageLessons={permissions.has("class.manage")} />;
}
