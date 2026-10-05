import { setRequestLocale } from "next-intl/server";
import { requireAnyPerm } from "@/lib/auth";
import { loadRegistrationWorkbench } from "@/features/school/parent-registration";
import { ParentRegistrationSettings } from "@/features/school/ParentRegistrationSettings";
export default async function Page({ params }: { params: Promise<{ locale: string; activityId: string }> }) {
  const { locale, activityId } = await params; setRequestLocale(locale);
  await requireAnyPerm(locale, ["activity.manage", "activity.register"]);
  return <ParentRegistrationSettings key={activityId} value={await loadRegistrationWorkbench("activity", activityId)} />;
}
