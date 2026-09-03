import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FormalCoursewareReviewQueue } from "@/features/courseware-studio/FormalCoursewareReviewQueue";
import { listFormalCoursewareReviewQueue } from "@/features/courseware-studio/formal-review-data";
import {
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { MicrocourseReviewWorkspace } from "@/features/teacher-microcourses/MicrocourseReviewWorkspace";
import { requirePerm } from "@/lib/auth";

type ReviewTab = "formal" | "microcourses";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function resolveReviewTab(value: string | undefined): ReviewTab {
  return value === "microcourses" ? "microcourses" : "formal";
}

export default async function CoursewareReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  await requirePerm(locale, "courseware.review");
  const t = await getTranslations("coursewareStudio");
  const tab = resolveReviewTab(first(query.tab));

  return (
    <DashboardPage
      title={t("reviewWorkspaceTitle")}
      commandPanel={(
        <DashboardCommandPanel>
          <DashboardCommandState>
            <DashboardCommandTabs
              ariaLabel={t("reviewWorkspaceTitle")}
              activeValue={tab}
              items={[
                { value: "formal", label: t("formalReviewTab"), href: "/dashboard/courseware/review?tab=formal" },
                { value: "microcourses", label: t("teacherMicrocourseReviewTab"), href: "/dashboard/courseware/review?tab=microcourses" },
              ]}
            />
          </DashboardCommandState>
        </DashboardCommandPanel>
      )}
    >
      <Suspense fallback={<div className="h-96 animate-pulse bg-moon/10" />}>
        {tab === "microcourses"
          ? <MicrocourseReviewWorkspace locale={locale} />
          : <FormalReviewContent locale={locale} />}
      </Suspense>
    </DashboardPage>
  );
}

async function FormalReviewContent({ locale }: { locale: string }) {
  const [items, t] = await Promise.all([
    listFormalCoursewareReviewQueue(),
    getTranslations("coursewareStudio"),
  ]);

  return (
    <FormalCoursewareReviewQueue
      items={items}
      locale={locale}
      labels={{
        title: t("formalReviewQueueTitle"),
        empty: t("formalReviewQueueEmpty"),
        course: t("formalReviewCourse"),
        lecture: t("formalReviewLecture"),
        progress: t("formalReviewProgress"),
        submitted: t("formalReviewSubmitted"),
        open: t("formalReviewOpen"),
        nativeTrack: t("formalReviewNativeTrack"),
        adaptedTrack: t("formalReviewAdaptedTrack"),
        inReview: t("formalReviewInReview"),
        readyToPublish: t("formalReviewReadyToPublish"),
        round: (current, required) => t("formalReviewRound", { current, required }),
      }}
    />
  );
}
