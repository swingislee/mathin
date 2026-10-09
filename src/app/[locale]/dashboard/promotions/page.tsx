import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { readPromotionForm, readPromotionSettings } from "@/features/school/promotions/actions";
import { PromotionWorkbench } from "@/features/school/promotions/PromotionWorkbench";

export default async function PromotionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "registration.invite.manage");
  const [promotions, form] = await Promise.all([readPromotionSettings(), readPromotionForm(null)]);
  return <PromotionWorkbench initial={promotions} initialForm={form} configured={Boolean(getMiniappWechatConfig())} />;
}
