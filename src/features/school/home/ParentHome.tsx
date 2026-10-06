import { FamilyHome } from "@/features/family-web/FamilyHome";
import { getFamilySchedule } from "@/features/family-web/data";
import { getMyLearningSummary } from "@/features/school/customer";
import type { HomeProps } from "./shared";

export async function ParentHome({ locale, profile }: HomeProps) {
  const now = new Date();
  const [children, sessions] = await Promise.allSettled([
    getMyLearningSummary(),
    getFamilySchedule(now.toISOString(), new Date(now.getTime() + 7 * 86400000).toISOString()),
  ]);
  return <FamilyHome locale={locale} name={profile?.displayName || ""} today={now.toISOString()}
    students={children.status === "fulfilled" ? children.value : []}
    sessions={sessions.status === "fulfilled" ? sessions.value : []}
    scheduleUnavailable={sessions.status === "rejected"}
    unavailable={children.status === "rejected" || sessions.status === "rejected"} />;
}
