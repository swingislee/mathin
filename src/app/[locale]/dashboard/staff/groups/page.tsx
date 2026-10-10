import { setRequestLocale } from "next-intl/server";
import { requireDashboardEnvironment } from "@/lib/auth";
import { readSchoolCollaborationSettings } from "@/features/school/school-collaboration-data";
import { SchoolCollaborationSettings } from "@/features/school/SchoolCollaborationSettings";

export default async function StaffGroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["staff"]);
  return <SchoolCollaborationSettings locale={locale} initial={await readSchoolCollaborationSettings()} />;
}
