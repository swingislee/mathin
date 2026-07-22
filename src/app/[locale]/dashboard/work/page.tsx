import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { requireStaff } from "@/lib/auth";

// P4I-17：今日工作转正为 `/dashboard` 默认首页（TodayWorkHome），这条路由
// 只做重定向——不直接 404，因为 P4I-8 上线以来真实账号可能已经收藏了这个地址。
export default async function WorkPageRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireStaff(locale);
  redirect(`/${locale}/dashboard`);
}
