import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { DashboardPage } from "@/features/school/dashboard-page";
import { loadAdvisorSettings } from "@/features/school/parent-registration";
import { ParentAdvisorSettings } from "@/features/school/ParentAdvisorSettings";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  return <DashboardPage title={locale === "en" ? "Grade advisors" : "年级学服设置"} description={locale === "en" ? "Set the advisor's QR code and phone number for each grade." : "为每个年级设置学服老师的二维码和手机号。"}><ParentAdvisorSettings rows={await loadAdvisorSettings()} /></DashboardPage>;
}
