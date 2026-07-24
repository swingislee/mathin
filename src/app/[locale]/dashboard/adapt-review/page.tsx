import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { AdaptPageQueue } from "@/features/courseware-studio/AdaptPageQueue";
import { AdaptReviewQueue } from "@/features/courseware-studio/AdaptReviewQueue";
import { loadAdaptPageQueue, loadAdaptReviewQueue, parseAdaptClass, parseAdaptReviewPage } from "@/features/courseware-studio/adapt-review-data";
import { COURSEWARE_STUDIO_PERMS } from "@/features/courseware-studio/data";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdaptReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="mx-auto w-full max-w-6xl">
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
      <AdaptReviewContent locale={locale} searchParams={searchParams} />
    </Suspense>
  </div>;
}

async function AdaptReviewContent({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, t, query] = await Promise.all([requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS), getTranslations("coursewareStudio"), searchParams]);
  const perms = await getMyPerms(user.id);
  const tab = first(query.tab) === "pages" ? "pages" : "backgrounds";
  const page = parseAdaptReviewPage(query.page);
  const canManageAssets = perms.has("courseware.asset.manage");
  const canEditPages = perms.has("courseware.page.edit");
  return <>
    <SchoolPageHeader title={t("adaptQueueTitle")}>
      <p className="mt-1 text-sm text-muted">{t("adaptQueueIntro")}</p>
    </SchoolPageHeader>
    <nav className="mt-5 flex flex-wrap gap-2" aria-label={t("adaptReviewTabs")}>
      <Link href="/dashboard/adapt-review?tab=backgrounds" className={cn(buttonVariants({ variant: tab === "backgrounds" ? "primary" : "secondary", size: "sm" }))}>{t("adaptBackgroundTab")}</Link>
      <Link href="/dashboard/adapt-review?tab=pages&class=D" className={cn(buttonVariants({ variant: tab === "pages" ? "primary" : "secondary", size: "sm" }))}>{t("adaptPageTab")}</Link>
    </nav>
    {tab === "backgrounds"
      ? <AdaptReviewQueue {...await loadAdaptReviewQueue(page)} canManageAssets={canManageAssets} />
      : <AdaptPageQueue {...await loadAdaptPageQueue(page, parseAdaptClass(query.class))} canEditPages={canEditPages} />}
  </>;
}
