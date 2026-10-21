import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { loadRewardRules } from "@/features/school/learning-rewards/actions";
import { RewardsConsole } from "@/features/school/learning-rewards/RewardsConsole";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const result = await loadRewardRules();
  if (!result.ok) throw new Error(result.code);
  return <RewardsConsole initial={result.data} locale={locale === "en" ? "en" : "zh"} />;
}
