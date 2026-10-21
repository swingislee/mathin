"use client";

import { useState, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import { Button, buttonVariants } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { DashboardIntentLink } from "./dashboard-page/DashboardIntentLink";
import { ClassRosterEntryLink } from "./ClassRosterEntryLink";
import { classSessionActionPhase, classSessionEntry } from "./class-roster-entry";
import { classSessionMessages, type ClassRosterSession } from "./class-roster-session-contract";
import { withReturnTo } from "./object-workspace/return-target";

const AttendanceDrawer = dynamic(() => import("./AttendanceDrawer").then(module => module.AttendanceDrawer));
const PostclassLearningEditor = dynamic(() => import("./PostclassLearningEditor").then(module => module.PostclassLearningEditor));
const ReviewDrawer = dynamic(() => import("./ReviewDrawer").then(module => module.ReviewDrawer));
const actionClass = "min-h-9 shrink-0 whitespace-nowrap px-2 text-xs";
type Operation = "attendance" | "learning" | "reviews";

/** 入口属于明确课次；只有选中的登记器才加载，进入后直接处理对应任务。 */
export function ClassRosterSessionActions({ session, locale, now, returnTo, canChange, onRecordsChanged, onPublishingChange }: {
  session: ClassRosterSession; locale: string; now: number; returnTo: string;
  canChange: () => boolean; onRecordsChanged: (reviewCount?: number) => void;
  onPublishingChange: (publishing: boolean) => void;
}) {
  const m = classSessionMessages(locale);
  const router = useRouter();
  const [operation, setOperation] = useState<Operation | null>(null);
  const capabilities = session.capabilities;
  if (!capabilities?.canOpenManagement) return null;
  const en = locale.startsWith("en");
  const phase = classSessionActionPhase(session, now);
  const entry = classSessionEntry(session, now);
  const prepareLabel = capabilities.canPrepare ? m.prepare : m.viewPreparation;
  const open = (value: Operation) => { if (canChange()) setOperation(value); };
  const close = () => setOperation(null);
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (!canChange()) event.preventDefault();
  };
  const saved = () => { onRecordsChanged(); router.refresh(); };
  return <div data-class-session-actions data-session-action-phase={phase} role="group" aria-label={m.actions + " · " + (session.title || m.untitled)}
    className="flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap lg:flex-nowrap" onClick={event => event.stopPropagation()}>
    {!session.startedAt && !session.endedAt && <DashboardIntentLink data-class-session-prepare
      href={withReturnTo("/dashboard/sessions/" + session.id + "?stage=pre", returnTo)}
      className={buttonVariants({ size: "sm", variant: "secondary", className: actionClass })}
      onClick={navigate}>{en ? (capabilities.canPrepare ? "Prepare" : "Preparation") : prepareLabel}</DashboardIntentLink>}
    {phase !== "future" && capabilities.canMarkAttendance && <Button size="sm" variant="secondary" className={actionClass}
      data-session-operation="attendance" onClick={() => open("attendance")}>{en ? "Attendance" : phase === "imminent" ? "点名" : "考勤"}</Button>}
    {["live", "ended", "unconfirmed"].includes(phase) && capabilities.canMarkAttendance && <Button size="sm" variant="secondary" className={actionClass}
      data-session-operation="learning" onClick={() => open("learning")}>{en ? "Learning" : "学情"}</Button>}
    {phase === "ended" && capabilities.canWriteReview && <>
      <Button size="sm" variant="secondary" className={actionClass} data-session-operation="reviews"
        onClick={() => open("reviews")}>{en ? "Reviews" : "课评"}</Button>
      <DashboardIntentLink data-session-operation="assignments" href={withReturnTo("/dashboard/sessions/" + session.id + "?stage=post&work=assignments", returnTo)}
        className={buttonVariants({ size: "sm", variant: "secondary", className: actionClass })} onClick={navigate}>{en ? "Homework" : "作业"}</DashboardIntentLink>
    </>}
    {entry && ["future", "imminent", "live"].includes(phase) && <ClassRosterEntryLink entry={entry} locale={locale}
      canChange={canChange} label={entry.mode === "rehearse" ? m.rehearse : m.enter} />}
    {operation === "attendance" && <AttendanceDrawer sessionId={session.id} openInitially onClose={close}
      mode={phase === "ended" || phase === "unconfirmed" ? "amend" : "initial"} onSaved={saved} />}
    {operation === "learning" && <PostclassLearningEditor sessionId={session.id} openInitially onClose={close} view="learning"
      onSaved={saved} />}
    {operation === "reviews" && <ReviewDrawer sessionId={session.id} openInitially onClose={close} showPublish
      resultStatus={session.reviewStatus} onPublishingChange={onPublishingChange} onSaved={rows => {
        onRecordsChanged(rows.filter(row => row.comment.trim() || [row.entryScore, row.exitScore, row.focus, row.participation, row.mastery].some(value => value !== null)).length);
        router.refresh();
      }} />}
  </div>;
}
