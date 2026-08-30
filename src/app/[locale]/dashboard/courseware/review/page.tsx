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
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { MicrocourseReviewQueue } from "@/features/teacher-microcourses/MicrocourseReviewQueue";
import { MicrocourseSessionWorkspaceQueue } from "@/features/teacher-microcourses/MicrocourseSessionWorkspaceQueue";
import {
  listTeacherMicrocourseReviewQueue,
  listTeacherMicrocourseSessionWorkspaces,
} from "@/features/teacher-microcourses/data";

type AdaptReviewTab = "microcourses" | "backgrounds" | "rework" | "pages" | "releases" | "history";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function tabHref(tab: AdaptReviewTab, courseId: string | null, lectureId: string | null) {
  const query = new URLSearchParams({ tab });
  if (tab === "pages") query.set("class", "D");
  if (tab === "releases") query.set("scope", "pending");
  if (courseId) query.set("course", courseId);
  if (lectureId) query.set("lecture", lectureId);
  return "/dashboard/courseware/review?" + query.toString();
}

function resolveReviewTab(requested: string | undefined, canReviewMicrocourses: boolean): AdaptReviewTab {
  if (requested === "microcourses") return canReviewMicrocourses ? "microcourses" : "backgrounds";
  if (requested === "backgrounds" || requested === "rework" || requested === "pages"
    || requested === "releases" || requested === "history") return requested;
  return canReviewMicrocourses ? "microcourses" : "backgrounds";
}

// doc22 §5.18：背景审阅/返工/页面审阅/发布/历史都属于课件生产，是 /dashboard/courseware
// 的真实子工作区。原顶层 /dashboard/adapt-review 把内部实现词（adapt）当成了 URL。
export default async function CoursewareReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("coursewareStudio");
  return (
    <DashboardPage
      title={t("reviewWorkspaceTitle")}
      commandPanel={
        <Suspense fallback={<DashboardCommandPanel />}>
          <AdaptReviewCommandPanel locale={locale} searchParams={searchParams} />
        </Suspense>
      }
    >
      <Suspense fallback={<div className="h-96 animate-pulse border-y border-line bg-paper/30" />}>
        <AdaptReviewContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </DashboardPage>
  );
}

async function AdaptReviewCommandPanel({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [t, tm, query, user] = await Promise.all([
    getTranslations("coursewareStudio"),
    getTranslations("teacherMicrocourses"),
    searchParams,
    requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS),
  ]);
  const perms = await getMyPerms(user.id);
  const canReviewMicrocourses = perms.has("courseware.review");
  const requestedTab = first(query.tab);
  const tab = resolveReviewTab(requestedTab, canReviewMicrocourses);
  const courseId = parseAdaptFilterId(query.course);
  const lectureId = courseId ? parseAdaptFilterId(query.lecture) : null;
  const filterOptions = await loadAdaptReviewFilterOptions(courseId);
  return (
    <DashboardCommandPanel>
      <DashboardCommandState>
        <DashboardCommandTabs
          ariaLabel={t("reviewWorkspaceTitle")}
          activeValue={tab}
          items={[
            ...(canReviewMicrocourses ? [{ value: "microcourses", label: tm("reviewQueueTab"), href: tabHref("microcourses", courseId, lectureId) }] : []),
            { value: "backgrounds", label: t("adaptBackgroundTab"), href: tabHref("backgrounds", courseId, lectureId) },
            { value: "rework", label: t("adaptReworkTab"), href: tabHref("rework", courseId, lectureId) },
            { value: "pages", label: t("adaptPageTab"), href: tabHref("pages", courseId, lectureId) },
            { value: "releases", label: t("adaptReleaseTab"), href: tabHref("releases", courseId, lectureId) },
            { value: "history", label: t("adaptHistoryTab"), href: tabHref("history", courseId, lectureId) },
          ]}
        />
      </DashboardCommandState>
      {tab !== "microcourses" && <DashboardCommandFilters>
        <AdaptReviewFilters options={filterOptions} courseId={courseId} lectureId={lectureId} embedded />
      </DashboardCommandFilters>}
    </DashboardCommandPanel>
  );
}

async function AdaptReviewContent({ locale, searchParams }: { locale: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, query] = await Promise.all([requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS), searchParams]);
  const perms = await getMyPerms(user.id);
  const requestedTab = first(query.tab);
  const tab = resolveReviewTab(requestedTab, perms.has("courseware.review"));
  const page = parseAdaptReviewPage(query.page);
  const courseId = parseAdaptFilterId(query.course);
  const lectureId = courseId ? parseAdaptFilterId(query.lecture) : null;
  const filters = { courseId, lectureId };
  const canManageAssets = perms.has("courseware.asset.manage");
  const canEditPages = perms.has("courseware.page.edit");
  const canPublish = perms.has("courseware.release.publish");
  if (tab === "microcourses") {
    const [items, workspaces, tm] = await Promise.all([
      listTeacherMicrocourseReviewQueue(),
      listTeacherMicrocourseSessionWorkspaces(),
      getTranslations("teacherMicrocourses"),
    ]);
    return <div className="space-y-4">
      <MicrocourseSessionWorkspaceQueue
        items={workspaces}
        locale={locale}
        labels={{
          title: tm("sessionWorkspaceQueueTitle"),
          description: tm("sessionWorkspaceQueueDescription"),
          empty: tm("sessionWorkspaceQueueEmpty"),
          open: tm("openSessionWorkspace"),
          session: tm("sessionWorkspaceSession"),
          variant: tm("sessionWorkspaceVariant"),
          teacherColumn: tm("sessionWorkspaceTeacher"),
          schedule: tm("sessionWorkspaceSchedule"),
          status: tm("sessionWorkspaceStatus"),
          action: tm("sessionWorkspaceAction"),
          variants: (count) => tm("variantCount", { count }),
          noVariant: tm("noVariantYet"),
          selected: (name) => tm("selectedVariantName", { name }),
          notSelected: tm("noSelectedVariant"),
          frozen: tm("sessionFrozen"),
          teacher: (name) => tm("primaryTeacher", { name }),
        }}
      />
      <MicrocourseReviewQueue
        items={items}
        locale={locale}
        labels={{
          title: tm("reviewQueueTitle"),
          empty: tm("reviewQueueEmpty"),
          review: tm("openReview"),
          course: tm("reviewQueueCourse"),
          scope: tm("reviewQueueScope"),
          progress: tm("reviewQueueProgress"),
          submittedColumn: tm("reviewQueueSubmitted"),
          action: tm("reviewQueueAction"),
          grade: (grade) => tm("gradeValue", { grade }),
          round: (current, required) => tm("reviewRound", { current, required }),
          submitted: (value) => tm("submittedAt", { value }),
        }}
      />
    </div>;
  }
  const queue = await (
    tab === "backgrounds"
      ? loadAdaptReviewQueue(page, filters)
      : tab === "rework"
        ? loadAdaptReworkQueue(page, filters)
        : tab === "pages"
          ? loadAdaptPageQueue(page, parseAdaptClass(query.class), filters)
          : tab === "releases"
            ? loadAdaptReleaseQueue(page, parseAdaptReleaseScope(query.scope), filters)
            : loadAdaptBackgroundHistory(page, filters)
  );

  return <>
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
