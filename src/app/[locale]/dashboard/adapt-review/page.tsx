import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdaptBackgroundHistory } from "@/features/courseware-studio/AdaptBackgroundHistory";
import { AdaptBackgroundReworkQueue } from "@/features/courseware-studio/AdaptBackgroundReworkQueue";
import { AdaptPageQueue } from "@/features/courseware-studio/AdaptPageQueue";
import { AdaptReleaseQueue } from "@/features/courseware-studio/AdaptReleaseQueue";
import { AdaptReviewFilters } from "@/features/courseware-studio/AdaptReviewFilters";
import { AdaptReviewQueue } from "@/features/courseware-studio/AdaptReviewQueue";
import {
  loadAdaptBackgroundHistory,
  loadAdaptPageQueue,
  loadAdaptReleaseQueue,
  loadAdaptReviewFilterOptions,
  loadAdaptReviewQueue,
  loadAdaptReworkQueue,
  parseAdaptClass,
  parseAdaptFilterId,
  parseAdaptReleaseScope,
  parseAdaptReviewPage,
} from "@/features/courseware-studio/adapt-review-data";
import { COURSEWARE_STUDIO_PERMS } from "@/features/courseware-studio/data";
import { ContextBar } from "@/features/school/stage/ContextBar";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

type AdaptReviewTab = "backgrounds" | "rework" | "pages" | "releases" | "history";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function tabHref(tab: AdaptReviewTab, courseId: string | null, lectureId: string | null) {
  const query = new URLSearchParams({ tab });
  if (tab === "pages") query.set("class", "D");
  if (tab === "releases") query.set("scope", "pending");
  if (courseId) query.set("course", courseId);
  if (lectureId) query.set("lecture", lectureId);
  return "/dashboard/adapt-review?" + query.toString();
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
  const requestedTab = first(query.tab);
  const tab: AdaptReviewTab = requestedTab === "rework" || requestedTab === "pages" || requestedTab === "releases" || requestedTab === "history" ? requestedTab : "backgrounds";
  const page = parseAdaptReviewPage(query.page);
  const courseId = parseAdaptFilterId(query.course);
  const lectureId = courseId ? parseAdaptFilterId(query.lecture) : null;
  const filters = { courseId, lectureId };
  const canManageAssets = perms.has("courseware.asset.manage");
  const canEditPages = perms.has("courseware.page.edit");
  const canPublish = perms.has("courseware.release.publish");
  const [filterOptions, queue] = await Promise.all([
    loadAdaptReviewFilterOptions(courseId),
    tab === "backgrounds"
      ? loadAdaptReviewQueue(page, filters)
      : tab === "rework"
        ? loadAdaptReworkQueue(page, filters)
        : tab === "pages"
          ? loadAdaptPageQueue(page, parseAdaptClass(query.class), filters)
          : tab === "releases"
            ? loadAdaptReleaseQueue(page, parseAdaptReleaseScope(query.scope), filters)
            : loadAdaptBackgroundHistory(page, filters),
  ]);

  return <>
    <SchoolPageHeader title={t("adaptReviewTitle")} />
    <ContextBar
      tabs={[
        { value: "backgrounds", label: t("adaptBackgroundTab"), href: tabHref("backgrounds", courseId, lectureId) },
        { value: "rework", label: t("adaptReworkTab"), href: tabHref("rework", courseId, lectureId) },
        { value: "pages", label: t("adaptPageTab"), href: tabHref("pages", courseId, lectureId) },
        { value: "releases", label: t("adaptReleaseTab"), href: tabHref("releases", courseId, lectureId) },
        { value: "history", label: t("adaptHistoryTab"), href: tabHref("history", courseId, lectureId) },
      ]}
      activeTab={tab}
      filters={<AdaptReviewFilters options={filterOptions} courseId={courseId} lectureId={lectureId} embedded />}
    />
    {tab === "backgrounds"
      ? <AdaptReviewQueue {...queue as Awaited<ReturnType<typeof loadAdaptReviewQueue>>} canManageAssets={canManageAssets} courseId={courseId} lectureId={lectureId} />
      : tab === "rework"
        ? <AdaptBackgroundReworkQueue {...queue as Awaited<ReturnType<typeof loadAdaptReworkQueue>>} canManageAssets={canManageAssets} courseId={courseId} lectureId={lectureId} />
        : tab === "pages"
          ? <AdaptPageQueue {...queue as Awaited<ReturnType<typeof loadAdaptPageQueue>>} canEditPages={canEditPages} courseId={courseId} lectureId={lectureId} />
          : tab === "releases"
            ? <AdaptReleaseQueue {...queue as Awaited<ReturnType<typeof loadAdaptReleaseQueue>>} canPublish={canPublish} courseId={courseId} lectureId={lectureId} />
            : <AdaptBackgroundHistory {...queue as Awaited<ReturnType<typeof loadAdaptBackgroundHistory>>} courseId={courseId} lectureId={lectureId} />}
  </>;
}