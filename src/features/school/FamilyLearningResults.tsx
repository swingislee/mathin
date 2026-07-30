import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { CustomerVideoButton } from "./CustomerVideoButton";
import type { MySessionReview, MySessionReviewState } from "./customer";

export async function FamilyLearningResults({
  locale,
  reviews,
  states,
  videos,
}: {
  locale: string;
  reviews: MySessionReview[];
  states: MySessionReviewState[];
  videos: Array<{ videoId: string; sessionId: string; studentId: string }>;
}) {
  const t = await getTranslations("school.students");
  const reviewBySession = new Map(reviews.map((review) => [review.sessionId, review]));
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "short" });

  if (states.length === 0) {
    return <p className="text-sm text-muted">{t("noReviews")}</p>;
  }

  return (
    <ul className="divide-y">
      {states.map((state) => {
        const review = reviewBySession.get(state.sessionId);
        const publishedReview = state.availabilityState === "published" ? review : undefined;

        return (
          <li key={state.sessionId} className="py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-medium">
                {state.classroomName} · {state.lectureName}
              </span>
              <div className="flex items-center gap-2">
                <Badge
                  variant={state.availabilityState === "published" ? "default" : state.availabilityState === "pending" ? "secondary" : "outline"}
                >
                  {t(`reviewStatus_${state.availabilityState}`)}
                </Badge>
                <time className="text-xs text-muted">{dateFormatter.format(new Date(state.scheduledAt))}</time>
              </div>
            </div>
            {publishedReview ? (
              <>
                <p className="mt-1 text-xs text-muted">
                  {t("reviewScores", {
                    entry: publishedReview.entryScore ?? "—",
                    exit: publishedReview.exitScore ?? "—",
                    focus: publishedReview.focus ?? "—",
                    participation: publishedReview.participation ?? "—",
                    mastery: publishedReview.mastery ?? "—",
                  })}
                </p>
                {publishedReview.comment && <p className="mt-2">{publishedReview.comment}</p>}
                {publishedReview.knowledgeSummary && (
                  <p className="mt-2 rounded-lg bg-line/40 p-2 text-xs text-muted">{publishedReview.knowledgeSummary}</p>
                )}
                <div className="mt-2 flex gap-2">
                  {videos.filter((video) => video.sessionId === state.sessionId).map((video) => (
                    <CustomerVideoButton key={video.videoId} videoId={video.videoId} />
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-2 text-xs text-muted">{t(`reviewStatusHint_${state.availabilityState}`)}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
