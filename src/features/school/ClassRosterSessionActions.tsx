"use client";

import type { MouseEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, ClipboardCheck, FilePenLine, PanelsTopLeft, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import { AttendanceDrawer } from "./AttendanceDrawer";
import { PostclassLearningEditor } from "./PostclassLearningEditor";
import { ClassRosterEntryLink } from "./ClassRosterEntryLink";
import { classSessionEntry } from "./class-roster-entry";
import { classSessionMessages, type ClassRosterSession } from "./class-roster-session-contract";
import { publishSessionReviewsAction } from "./learning-result-actions";
import { withReturnTo } from "./object-workspace/return-target";

const actionClass = "size-9 shrink-0 p-0";

function ActionHint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild><span className="inline-flex">{children}</span></TooltipTrigger>
    <TooltipContent>{label}</TooltipContent></Tooltip>;
}

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
  const prepareLabel = capabilities.canPrepare ? m.prepare : m.viewPreparation;
  const attendanceLabel = classesT(ended ? "amendAttendance" : "markAttendance");
  const learningLabel = locale.startsWith("en") ? "Edit learning records and feedback" : "补录／修订学情与课评";
  const publishLabel = t(["published", "withdrawn", "revised"].includes(session.reviewStatus ?? "draft") ? "republish" : "publishStudentReviews");
  const workspaceLabel = ended ? (locale.startsWith("en") ? "After-class workspace" : "课后工作区") : m.workspace;
  const beforeOpen = () => !publishReviews.pending && canChange();
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (!beforeOpen()) event.preventDefault();
  };
  return <TooltipProvider delayDuration={200}><div data-class-session-actions role="group" aria-label={`${m.actions} · ${session.title || m.untitled}`}
    className="flex shrink-0 items-center gap-1" onClick={event => event.stopPropagation()}>
    <ActionHint label={prepareLabel}>
      <Link data-class-session-prepare prefetch={false} href={withReturnTo(`/dashboard/sessions/${session.id}?stage=pre`, returnTo)}
        className={buttonVariants({ size: "sm", variant: "secondary", className: actionClass })}
        title={prepareLabel} aria-label={prepareLabel} onClick={navigate}><BookOpen size={16} className="text-crater" aria-hidden /></Link>
    </ActionHint>
    {capabilities.canMarkAttendance && <ActionHint label={attendanceLabel}>
      <AttendanceDrawer sessionId={session.id} appearance="secondary" mode={ended ? "amend" : "initial"}
        trigger={<ClipboardCheck size={16} className="text-leaf-deep" aria-hidden />} className={actionClass} beforeOpen={beforeOpen}
        disabled={publishReviews.pending} onSaved={() => onRecordsChanged()} />
    </ActionHint>}
    {ended && capabilities.canWriteReview && capabilities.canMarkAttendance && <ActionHint label={learningLabel}>
      <PostclassLearningEditor sessionId={session.id} trigger={<FilePenLine size={16} aria-hidden />} className={actionClass}
        beforeOpen={beforeOpen} disabled={publishReviews.pending} onSaved={data => {
          onRecordsChanged(data.reviews.filter(review => review.comment.trim()
            || [review.entryScore, review.exitScore, review.focus, review.participation, review.mastery].some(value => value !== null)).length);
          router.refresh();
        }} />
    </ActionHint>}
    {ended && capabilities.canWriteReview && <ActionHint label={publishLabel}>
      <Button size="sm" className={actionClass} title={publishLabel} aria-label={publishLabel}
        disabled={publishReviews.pending} onClick={() => { if (beforeOpen()) publishReviews.run(); }}><Send size={16} aria-hidden /></Button>
    </ActionHint>}
    {ended ? <ActionHint label={workspaceLabel}>
      <Link prefetch={false} href={withReturnTo(`/dashboard/sessions/${session.id}?stage=post`, returnTo)}
        className={buttonVariants({ size: "sm", variant: "secondary", className: actionClass })}
        title={workspaceLabel} aria-label={workspaceLabel} onClick={navigate}><PanelsTopLeft size={16} aria-hidden /></Link>
    </ActionHint> : <ClassRosterEntryLink entry={classSessionEntry(session, now)} locale={locale} canChange={beforeOpen} />}
  </div></TooltipProvider>;
}
