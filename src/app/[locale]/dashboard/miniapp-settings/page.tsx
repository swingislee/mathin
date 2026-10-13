import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { DashboardPage } from "@/features/school/dashboard-page";
import { loadMiniappActivityChoices, loadMiniappSettings, loadMiniappContactOptions } from "@/features/school/miniapp-settings/actions";
import { MiniappSettingsEditor } from "@/features/school/miniapp-settings/Editor";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const [result, choices, contacts, query] = await Promise.all([loadMiniappSettings(), loadMiniappActivityChoices(), loadMiniappContactOptions(), searchParams]);
  if (!result.ok) throw new Error(result.code);
  return <DashboardPage title={locale === "en" ? "Mini Program settings" : "小程序设置"} backHref="/dashboard/organization" backLabel={locale === "en" ? "Organization" : "机构设置"}>
    {!choices.ok && <p className="text-sm text-muted">{locale === "en" ? "Activity choices could not be loaded. Reload to edit recommendations." : "活动选项暂未载入，编辑推荐活动前请刷新重试。"}</p>}
    <MiniappSettingsEditor initial={result.data} activities={choices.ok ? choices.data : []} contactOptions={contacts.ok ? contacts.data : undefined} initialTab={query.tab || "native-pages"} locale={locale === "en" ? "en" : "zh"} />
  </DashboardPage>;
}
