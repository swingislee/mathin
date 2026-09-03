import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { resolveMyWebPushDelivery } from "@/features/events/web-push";
import { requireUser } from "@/lib/auth";

export default async function WebPushDeliveryPage({
  params,
}: {
  params: Promise<{ locale: string; deliveryId: string }>;
}) {
  const { locale, deliveryId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  const deepLink = await resolveMyWebPushDelivery(deliveryId);
  redirect(`/${locale}${deepLink ?? "/dashboard"}`);
}
