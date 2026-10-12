import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { redirect } from "next/navigation";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  redirect(`/${locale}/dashboard/miniapp-settings?tab=contacts`);
}
