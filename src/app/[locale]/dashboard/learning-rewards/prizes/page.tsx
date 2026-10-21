import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { loadRewardPickups, loadRewardPrizes } from "@/features/school/learning-rewards/actions";
import { PrizeConsole } from "@/features/school/learning-rewards/PrizeConsole";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const [prizes, pickups] = await Promise.all([loadRewardPrizes(), loadRewardPickups()]);
  if (!prizes.ok) throw new Error(prizes.code);
  if (!pickups.ok) throw new Error(pickups.code);
  return <PrizeConsole initial={prizes.data} initialPickups={pickups.data} locale={locale === "en" ? "en" : "zh"} />;
}
