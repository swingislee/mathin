"use client";

import type { MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import { AttendanceDrawer } from "./AttendanceDrawer";
import { PostclassLearningEditor } from "./PostclassLearningEditor";
import { ClassRosterEntryLink } from "./ClassRosterEntryLink";
import { classSessionEntry } from "./class-roster-entry";
import { classSessionMessages, type ClassRosterSession } from "./class-roster-session-contract";
import { publishSessionReviewsAction } from "./learning-result-actions";
import { withReturnTo } from "./object-workspace/return-target";

const actionClass = "min-h-9 shrink-0 whitespace-nowrap px-2 text-xs";

/** 核心操作随课次摘要挂载；编辑数据仍在点击后读取，不依赖详情展开。 */
export function ClassRosterSessionActions({ session, locale, now, returnTo, canChange, onRecordsChanged, onPublishingChange }: {
  session: ClassRosterSession; locale: string; now: number; returnTo: string;
  canChange: () => boolean; onRecordsChanged: (reviewCount?: number) => void;
  onPublishingChange: (publishing: boolean) => void;
}) {
  const m = classSessionMessages(locale);
  const t = useTranslations("school.session");
  const classesT = useTranslations("school.classes");
  const reviewT = useTranslations("school.reviews");
  const router = useRouter();
  const publishReviews = useAction(async () => {
    onPublishingChange(true);
    try { return await publishSessionReviewsAction(session.id); }
    finally { onPublishingChange(false); }
  }, {
    successMessage: t("studentReviewsPublishedToast"), errorMessage: { default: reviewT("failed") },
    onSuccess: () => { onRecordsChanged(); router.refresh(); },
  });
  const capabilities = session.capabilities;
  if (!capabilities?.canOpenManagement) return null;
  const ended = Boolean(session.endedAt);
  const en = locale.startsWith("en");
  const prepareLabel = capabilities.canPrepare ? m.prepare : m.viewPreparation;
  const attendanceLabel = classesT(ended ? "amendAttendance" : "markAttendance");
  const republish = ["published", "withdrawn", "revised"].includes(session.reviewStatus ?? "draft");
  const publishLabel = t(republish ? "republish" : "publishStudentReviews");
  const workspaceLabel = en ? "After class" : "课后工作区";
  const beforeOpen = () => !publishReviews.pending && canChange();
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (!beforeOpen()) event.preventDefault();
  };
  return <div data-class-session-actions role="group" aria-label={`${m.actions} · ${session.title || m.untitled}`}
    className="flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap lg:flex-nowrap" onClick={event => event.stopPropagation()}>
    <Link data-class-session-prepare prefetch={false} href={withReturnTo(`/dashboard/sessions/${session.id}?stage=pre`, returnTo)}
      className={buttonVariants({ size: "sm", variant: "secondary", className: actionClass })}
      title={prepareLabel} aria-label={prepareLabel} onClick={navigate}>{en ? (capabilities.canPrepare ? "Prepare" : "Preparation") : prepareLabel}</Link>
    {capabilities.canMarkAttendance &&
      <AttendanceDrawer sessionId={session.id} appearance="secondary" mode={ended ? "amend" : "initial"}
        trigger={en ? "Attendance" : ended ? "补录考勤" : attendanceLabel} className={actionClass} beforeOpen={beforeOpen}
        disabled={publishReviews.pending} onSaved={() => onRecordsChanged()} />
    }
    {ended && capabilities.canWriteReview && capabilities.canMarkAttendance &&
      <PostclassLearningEditor sessionId={session.id} trigger={en ? "Learning / reviews" : "学情 / 课评"} className={actionClass}
        beforeOpen={beforeOpen} disabled={publishReviews.pending} onSaved={data => {
          onRecordsChanged(data.reviews.filter(review => review.comment.trim()
            || [review.entryScore, review.exitScore, review.focus, review.participation, review.mastery].some(value => value !== null)).length);
          router.refresh();
        }} />
    }
    {ended && capabilities.canWriteReview &&
      <Button size="sm" variant="secondary" className={actionClass} title={publishLabel} aria-label={publishLabel}
        disabled={publishReviews.pending} onClick={() => { if (beforeOpen()) publishReviews.run(); }}>{en ? (republish ? "Republish" : "Publish reviews") : republish ? "重新发布课评" : "发布课评"}</Button>
    }
    {ended ?
      <Link prefetch={false} href={withReturnTo(`/dashboard/sessions/${session.id}?stage=post`, returnTo)}
        className={buttonVariants({ size: "sm", variant: "secondary", className: actionClass })}
        onClick={navigate}>{workspaceLabel}</Link>
      : <ClassRosterEntryLink entry={classSessionEntry(session, now)} locale={locale} canChange={beforeOpen} />}
  </div>;
}
