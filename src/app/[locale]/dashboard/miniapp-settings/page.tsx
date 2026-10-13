import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { loadMiniappActivityChoices, loadMiniappSettings, loadMiniappContactOptions } from "@/features/school/miniapp-settings/actions";
import { MiniappSettingsEditor } from "@/features/school/miniapp-settings/Editor";

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const [result, choices, contacts, query] = await Promise.all([loadMiniappSettings(), loadMiniappActivityChoices(), loadMiniappContactOptions(), searchParams]);
  if (!result.ok) throw new Error(result.code);
  return <MiniappSettingsEditor initial={result.data} activityLoadFailed={!choices.ok} activities={choices.ok ? choices.data : []} contactOptions={contacts.ok ? contacts.data : undefined} initialTab={query.tab || "native-pages"} locale={locale === "en" ? "en" : "zh"} />;
}
