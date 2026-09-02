import { getTranslations } from "next-intl/server";
import { MicrocourseReviewQueue } from "./MicrocourseReviewQueue";
import { listTeacherMicrocourseReviewQueue } from "./data";

/** Teacher-provided microcourses enter the shared research review center here. */
export async function MicrocourseReviewWorkspace({ locale }: { locale: string }) {
  const [items, t] = await Promise.all([
    listTeacherMicrocourseReviewQueue(),
    getTranslations("teacherMicrocourses"),
  ]);

  return (
    <div data-microcourse-review-workspace>
      <MicrocourseReviewQueue
        items={items}
        locale={locale}
        labels={{
          title: t("reviewQueueTitle"),
          empty: t("reviewQueueEmpty"),
          review: t("openReview"),
          course: t("reviewQueueCourse"),
          scope: t("reviewQueueScope"),
          progress: t("reviewQueueProgress"),
          submittedColumn: t("reviewQueueSubmitted"),
          action: t("reviewQueueAction"),
          grade: (grade) => t("gradeValue", { grade }),
          round: (current, required) => t("reviewRound", { current, required }),
          submitted: (value) => t("submittedAt", { value }),
        }}
      />
    </div>
  );
}
