import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { getMiniappWechatConfig } from "@/features/wechat/miniapp-config";
import { readPromotions } from "@/features/school/promotions/actions";
import { PromotionWorkbench } from "@/features/school/promotions/PromotionWorkbench";

export default async function PromotionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "registration.invite.manage");
  return <PromotionWorkbench initial={await readPromotions({ scene: null, page: 1 })} configured={Boolean(getMiniappWechatConfig())} />;
}
