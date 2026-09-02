import { getTranslations } from "next-intl/server";
import { MicrocourseReviewQueue } from "./MicrocourseReviewQueue";
import { MicrocourseSessionWorkspaceQueue } from "./MicrocourseSessionWorkspaceQueue";
import {
  listTeacherMicrocourseReviewQueue,
  listTeacherMicrocourseSessionWorkspaces,
} from "./data";

/** Teacher-microcourse collaboration and immutable catalog review share one object workspace. */
export async function MicrocourseReviewWorkspace({ locale }: { locale: string }) {
  const [items, workspaces, t] = await Promise.all([
    listTeacherMicrocourseReviewQueue(),
    listTeacherMicrocourseSessionWorkspaces(),
    getTranslations("teacherMicrocourses"),
  ]);

  return (
    <div className="space-y-4" data-microcourse-review-workspace>
      <MicrocourseSessionWorkspaceQueue
        items={workspaces}
        locale={locale}
        labels={{
          title: t("sessionWorkspaceQueueTitle"),
          description: t("sessionWorkspaceQueueDescription"),
          empty: t("sessionWorkspaceQueueEmpty"),
          open: t("openSessionWorkspace"),
          session: t("sessionWorkspaceSession"),
          variant: t("sessionWorkspaceVariant"),
          teacherColumn: t("sessionWorkspaceTeacher"),
          schedule: t("sessionWorkspaceSchedule"),
          status: t("sessionWorkspaceStatus"),
          action: t("sessionWorkspaceAction"),
          variants: (count) => t("variantCount", { count }),
          noVariant: t("noVariantYet"),
          selected: (name) => t("selectedVariantName", { name }),
          notSelected: t("noSelectedVariant"),
          frozen: t("sessionFrozen"),
          teacher: (name) => t("primaryTeacher", { name }),
        }}
      />
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
