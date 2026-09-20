"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { readDashboardDetail } from "./dashboard-page/readDashboardDetail";
import { classSessionDetailSchema, classSessionMessages, classSessionStudentWork, type ClassSessionDetail } from "./class-roster-session-contract";
import { SessionStudentPostworkTable } from "./SessionStudentPostworkTable";
import { TeachingSessionRecords } from "./teaching-workbench/TeachingSessionRecords";
import { readTeachingInlineRecords, type TeachingRecordCache } from "./teaching-workbench/teaching-records-client";
import type { TeachingRecords } from "./teaching-workbench/teaching-records-contract";
import { calendarDayKey } from "./schedule";

export function ClassRosterSessionDetail({ sessionId, classroomId, locale, timeZone, now, onDirtyChange, onReviewCountChange }: {
  sessionId: string; classroomId: string; locale: string; timeZone: string; now: number; onDirtyChange: (value: boolean) => void;
  onReviewCountChange?: (count: number) => void;
}) {
  const m = classSessionMessages(locale);
  const [data, setData] = useState<ClassSessionDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20>(20);
  const [contactRequested, setContactRequested] = useState(false);
  const [contacts, setContacts] = useState<TeachingRecords | null>(null);
  const cache = useRef<TeachingRecordCache>(new Map());
  const reviewedStudents = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    void readDashboardDetail<unknown>(`/${locale}/dashboard/classes/session-detail`, { sessionId, classroomId }, controller.signal)
      .then(value => { if (!controller.signal.aborted) {
        const parsed = classSessionDetailSchema.parse(value);
        reviewedStudents.current = new Set(parsed.records.reviews.map(review => review.studentId));
        setData(parsed); setFailed(false);
      } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [sessionId, classroomId, locale, attempt]);
  useEffect(() => {
    if (!contactRequested) return;
    const controller = new AbortController();
    void readTeachingInlineRecords(cache.current, locale, { sessionId, contactPage: page, pageSize }, controller.signal)
      .then(records => { if (!controller.signal.aborted) { setContacts(records); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [locale, sessionId, page, pageSize, attempt, contactRequested]);
  if (!data) return failed ? <div role="alert" className="flex items-center gap-3 text-xs text-muted">{m.failed}<Button variant="ghost" size="sm" onClick={() => setAttempt(value => value + 1)}>{m.retry}</Button></div> : <p role="status" className="text-xs text-muted">{m.loading}</p>;
  const work = classSessionStudentWork(data.records);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><p>{m.roster}</p><Link href={`/dashboard/sessions/${sessionId}?stage=post`} className="underline underline-offset-4">{m.workspace}</Link></div>
    {failed && <p role="alert" className="text-xs text-rose">{m.failed}<Button variant="ghost" size="sm" onClick={() => setAttempt(value => value + 1)}>{m.retry}</Button></p>}
    <TeachingSessionRecords data={contacts ? { ...data.records, contacts: contacts.contacts, contactPage: contacts.contactPage, contactTotal: contacts.contactTotal } : data.records} locale={locale} timeZone={timeZone} returnTo="" currentHref="" pageSize={pageSize}
      inline={{ onPageChange: value => { setContactRequested(true); setPage(value); }, onPageSizeChange: value => { setContactRequested(true); setPageSize(value); setPage(1); } }}
      studentWork={<SessionStudentPostworkTable sessionId={sessionId} rows={work.rows} initialReviews={work.reviews} resultStatus={data.resultStatus}
        canWriteReview={data.canWriteReview} initialCommunications={data.records.sessionCommunications ?? { canRead: false, canWrite: false, completed: false, records: [] }}
        locale={locale} timeZone={timeZone} today={calendarDayKey(new Date(now), timeZone)} onDirtyChange={onDirtyChange}
        onReviewsSaved={reviews => { for (const review of reviews) reviewedStudents.current.add(review.studentId); onReviewCountChange?.(reviewedStudents.current.size); }} />}
    />
  </div>;
}
