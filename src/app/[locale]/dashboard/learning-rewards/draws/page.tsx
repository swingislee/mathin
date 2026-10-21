import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { loadRewardDrawPools, loadRewardPrizes } from "@/features/school/learning-rewards/actions";
import { DrawConsole } from "@/features/school/learning-rewards/DrawConsole";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const [pools, prizes] = await Promise.all([loadRewardDrawPools(), loadRewardPrizes()]);
  if (!pools.ok) throw new Error(pools.code);
  if (!prizes.ok) throw new Error(prizes.code);
  return <DrawConsole initial={pools.data} prizes={prizes.data} locale={locale === "en" ? "en" : "zh"} />;
}
