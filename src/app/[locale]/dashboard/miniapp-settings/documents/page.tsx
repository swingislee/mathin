import { setRequestLocale } from "next-intl/server";
import { requirePerm } from "@/lib/auth";
import { DashboardPage } from "@/features/school/dashboard-page";
import { loadMiniappDocument, loadMiniappDocuments } from "@/features/school/miniapp-settings/document-actions";
import { MiniappDocumentsEditor } from "@/features/school/miniapp-settings/DocumentsEditor";
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params; setRequestLocale(locale); await requirePerm(locale, "organization.profile.manage");
  const [index, initial] = await Promise.all([loadMiniappDocuments(), loadMiniappDocument("privacy")]);
  if (!index.ok || !initial.ok) throw new Error("UNAVAILABLE");
  return <DashboardPage title={locale === "en" ? "Help and privacy documents" : "帮助与隐私文档"} backHref="/dashboard/miniapp-settings" backLabel={locale === "en" ? "Mini Program settings" : "小程序设置"}><MiniappDocumentsEditor initialIndex={index.data} initial={initial.data} locale={locale === "en" ? "en" : "zh"} /></DashboardPage>;
}
