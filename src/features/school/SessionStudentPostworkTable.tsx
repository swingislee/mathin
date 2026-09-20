"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import { DashboardCommandActions, DashboardCommandPanel, DashboardCommandState, DashboardTableShell } from "./dashboard-page";
import { FollowupRecordRow, FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { DashboardRowDisclosure } from "./dashboard-page/DashboardRowDisclosure";
import { LearningCheckStatusMark } from "./LearningCheckStatusMark";
import { publishSessionReviewsAction } from "./learning-result-actions";
import { LearningResultWithdrawButton } from "./LearningResultWithdrawButton";
import type { LearningResultStatus } from "./learning-results";
import { saveSessionReviewsAction, type ReviewRecord } from "./review-actions";
import { finishSessionCommunications, recordSessionCommunication } from "./session-communication-actions";
import { latestSessionCommunication, removeCommunicationDraft, sessionCommunicationProgress, type CommunicationDraft, type SessionCommunications } from "./session-communication-contract";
import { sessionCommunicationMessages } from "./session-communication-messages";
import { SessionCommunicationEntry } from "./SessionCommunicationEntry";
import { SessionCommunicationHistory } from "./SessionCommunicationHistory";

export interface SessionStudentPostworkRow {
  studentId: string; displayName: string; attendanceStatus: "present" | "absent" | "late" | "leave" | null; stars: number | null;
  attendanceNote?: string;
  reviewSource?: { author: string | null; at: string };
  checks: Array<{ id: string; title: string; status: "explained" | "independent" | "prompted" | "imitated" | "incomplete" | "unchecked" }>;
}

const GROUP_KEY = "class";

export function SessionStudentPostworkTable({ sessionId, rows, initialReviews, resultStatus, canWriteReview, initialCommunications, locale, timeZone, today, onDirtyChange, onReviewsSaved }: {
  sessionId: string; rows: SessionStudentPostworkRow[]; initialReviews: ReviewRecord[]; resultStatus: LearningResultStatus;
  canWriteReview: boolean; initialCommunications: SessionCommunications; locale: string; timeZone: string; today: string;
  onDirtyChange?: (dirty: boolean) => void;
  onReviewsSaved?: (records: ReviewRecord[]) => void;
}) {
  const t = useTranslations("school.session");
  const reviewT = useTranslations("school.reviews");
  const reportT = useTranslations("classroom.report");
  const m = sessionCommunicationMessages(locale);
  const router = useRouter();
  const [reviews, setReviews] = useState(initialReviews);
  const [status, setStatus] = useState(resultStatus);
  const [reviewSaveState, setReviewSaveState] = useState<"saved" | "saving" | "error">("saved");
  const reviewsRef = useRef(reviews);
  const savedReviewsRef = useRef(initialReviews);
  const onReviewsSavedRef = useRef(onReviewsSaved);
  useEffect(() => { onReviewsSavedRef.current = onReviewsSaved; }, [onReviewsSaved]);
  const dirtyReviewsRef = useRef(new Set<string>());
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const [communications, setCommunications] = useState(initialCommunications);
  const [drafts, setDrafts] = useState<Record<string, CommunicationDraft>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const focusNextRef = useRef(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const studentIds = rows.map(row => row.studentId);
  const keys = [GROUP_KEY, ...studentIds];
  const progress = sessionCommunicationProgress(studentIds, communications.records);

  const flushReviews = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) await savingRef.current;
    if (savedSequenceRef.current === sequenceRef.current) return true;
    const sequence = sequenceRef.current;
    setReviewSaveState("saving");
    const changed = reviewsRef.current.filter(review => dirtyReviewsRef.current.has(review.studentId));
    const request = saveSessionReviewsAction(sessionId, changed).then(result => {
      if (!result.ok) { setReviewSaveState("error"); return false; }
      const saved = new Map(changed.map(review => [review.studentId, review]));
      savedReviewsRef.current = savedReviewsRef.current.map(review => saved.get(review.studentId) ?? review);
      onReviewsSavedRef.current?.(changed);
      for (const review of changed) if (reviewsRef.current.find(current => current.studentId === review.studentId) === review) dirtyReviewsRef.current.delete(review.studentId);
      savedSequenceRef.current = sequence;
      setReviewSaveState(sequenceRef.current === sequence ? "saved" : "saving");
      setStatus(current => current === "published" || current === "withdrawn" ? "revised" : current);
      if (sequenceRef.current !== sequence) timerRef.current = window.setTimeout(() => void flushRef.current(), 1000);
      return true;
    }).catch(() => { setReviewSaveState("error"); return false; }).finally(() => { savingRef.current = null; });
    savingRef.current = request;
    return request;
  }, [sessionId]);
  useEffect(() => { flushRef.current = flushReviews; }, [flushReviews]);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); void flushReviews(); }, [flushReviews]);
  const hasDrafts = Object.values(dirty).some(Boolean) || reviewSaveState !== "saved" || Boolean(pendingKey);
  useEffect(() => { onDirtyChange?.(hasDrafts); }, [hasDrafts, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!hasDrafts) return;
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [hasDrafts]);
  useEffect(() => {
    if (focusNextRef.current && expanded && drafts[expanded]) {
      document.getElementById(`communication-${drafts[expanded].id}-content`)?.focus();
      focusNextRef.current = false;
    }
  }, [expanded, drafts]);
  const publishReviews = useAction(async () => {
    if (!(await flushReviews())) return { ok: false as const, code: "SAVE_FAILED" };
    return publishSessionReviewsAction(sessionId);
  }, { successMessage: t("studentReviewsPublishedToast"), errorMessage: { default: reviewT("failed") },
    onSuccess: () => { setStatus("published"); router.refresh(); } });
  const updateComment = (studentId: string, comment: string) => {
    dirtyReviewsRef.current.add(studentId);
    const next = reviewsRef.current.map(review => review.studentId === studentId ? { ...review, comment } : review);
    reviewsRef.current = next; setReviews(next); sequenceRef.current += 1; setReviewSaveState("saving");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 1000);
  };
  const open = (key: string, value = true) => {
    setActive(key); setExpanded(value ? key : null);
    if (value && communications.canWrite) setDrafts(current => current[key] ? current : { ...current, [key]: {
      id: newId(), occurredOn: today, channel: key === GROUP_KEY ? "class_group" : "wechat", outcome: "contacted", content: "", nextAction: "", nextFollowUpOn: "",
    } });
  };
  const save = async (key: string, next: boolean) => {
    const draft = drafts[key];
    if (!draft || submittingRef.current) return;
    const content = draft.content.trim() || (draft.outcome === "not_needed" ? m.notNeededNote : "");
    if (!draft.occurredOn || !content || (draft.outcome === "follow_up" && (!draft.nextAction.trim() || !draft.nextFollowUpOn))) {
      setError(current => ({ ...current, [key]: m.validation })); return;
    }
    submittingRef.current = true; setPendingKey(key); setError(current => ({ ...current, [key]: "" }));
    try {
      const result = await recordSessionCommunication({ ...draft, sessionId, studentId: key === GROUP_KEY ? null : key, content,
        nextAction: draft.outcome === "follow_up" ? draft.nextAction : "", nextFollowUpOn: draft.outcome === "follow_up" ? draft.nextFollowUpOn : null });
      if (!result.ok) { setError(current => ({ ...current, [key]: result.code === "SUBMISSION_CONFLICT" ? m.concurrent : result.code === "VALIDATION" ? m.validation : m.failed })); return; }
      setCommunications(result.data); setDrafts(current => removeCommunicationDraft(current, key));
      setDirty(current => ({ ...current, [key]: false })); setFeedback(current => ({ ...current, [key]: m.saved }));
      const nextKey = keys[keys.indexOf(key) + 1];
      if (next && nextKey) { focusNextRef.current = true; open(nextKey); }
      router.refresh();
    } catch { setError(current => ({ ...current, [key]: m.failed })); }
    finally { submittingRef.current = false; setPendingKey(null); }
  };
  const finish = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true; setPendingKey("finish"); setError(current => ({ ...current, finish: "" }));
    try {
      const result = await finishSessionCommunications(sessionId);
      if (result.ok) { setCommunications(result.data); router.refresh(); }
      else setError(current => ({ ...current, finish: result.code === "COMMUNICATIONS_PENDING" ? m.remaining : m.failed }));
    } catch { setError(current => ({ ...current, finish: m.failed })); }
    finally { submittingRef.current = false; setPendingKey(null); }
  };
  const reviewByStudent = new Map(reviews.map(review => [review.studentId, review]));
  const pendingReviews = reviewSaveState === "saving" || publishReviews.pending;

  return <div className="space-y-2">
    <DashboardCommandPanel>
      <DashboardCommandState><span className="text-xs text-muted">{m.progress}：{progress.contacted} / {progress.follow_up} / {progress.not_needed} / {progress.pending}</span>
        {communications.completed && <Badge variant="outline">{m.completed}</Badge>}
        {canWriteReview && <span className="text-xs text-muted" aria-live="polite">{reviewSaveState === "saving" && <LoaderCircle size={12} className="mr-1 inline animate-spin" />}
          {t(reviewSaveState === "saving" ? "studentReviewsSaving" : reviewSaveState === "error" ? "studentReviewsSaveFailed" : "studentReviewsSavedAuto")}</span>}
      </DashboardCommandState>
      <DashboardCommandActions>
        {communications.canWrite && !communications.completed && <Button size="sm" variant="secondary" disabled={Boolean(pendingKey) || !progress.canComplete || Object.values(dirty).some(Boolean)} onClick={() => void finish()}>{m.complete}</Button>}
        {canWriteReview && status === "published" && <LearningResultWithdrawButton mode="sessionReviews" targetId={sessionId} disabled={pendingReviews} onSuccess={() => setStatus("withdrawn")} />}
        {canWriteReview && reviewSaveState === "error" && <><Button size="sm" variant="ghost" onClick={() => void flushReviews()}>{t("retry")}</Button>
          <Button size="sm" variant="ghost" onClick={() => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
            dirtyReviewsRef.current.clear(); sequenceRef.current = savedSequenceRef.current;
            reviewsRef.current = savedReviewsRef.current; setReviews(savedReviewsRef.current); setReviewSaveState("saved");
          }}>{locale.startsWith("en") ? "Discard unsaved feedback" : "放弃未保存课评"}</Button></>}
        {canWriteReview && <Button size="sm" disabled={pendingReviews} onClick={() => publishReviews.run()}>{t(["published", "withdrawn", "revised"].includes(status) ? "republish" : "publishStudentReviews")}</Button>}
      </DashboardCommandActions>
    </DashboardCommandPanel>
    {error.finish && <p role="alert" className="text-xs text-rose">{error.finish}</p>}
    <p className="text-xs text-muted">{m.shortcut}</p>
    {!communications.canRead && <p className="text-xs text-muted">{m.noPermission}</p>}
    <DashboardTableShell data-followup-workbench data-session-postwork-table><Table className="min-w-[800px] text-xs" containerClassName="max-h-[70vh] overflow-auto">
      <TableHeader><TableRow><TableHead className="sticky left-0 z-20 min-w-32 bg-card">{m.student}</TableHead>
        <TableHead>{reportT("attendance")}</TableHead><TableHead>{m.learning}</TableHead><TableHead>{m.teacherFeedback}</TableHead>
        <TableHead>{m.outcome}</TableHead><TableHead>{m.nextAction}</TableHead></TableRow></TableHeader>
      <FollowupTableBody onNavigate={key => { setActive(key); return true; }}>
        {keys.map(key => {
          const row = rows.find(student => student.studentId === key);
          if (!row && !communications.canRead) return null;
          const review = reviewByStudent.get(key);
          const latest = latestSessionCommunication(communications.records, row ? key : null);
          const title = row?.displayName ?? m.classRecord;
          const detailsId = `postwork-${sessionId}-${key}`;
          return <FollowupRecordRow key={key} rowKey={key} active={active === key} expanded={expanded === key} pending={pendingKey === key}
            onActivate={() => setActive(key)} onExpandedChange={value => open(key, value)} onSave={communications.canWrite ? () => void save(key, false) : undefined}
            detailsId={detailsId} title={title} colSpan={6} summary={<>
              <TableCell className="sticky left-0 z-10 bg-inherit"><div className="flex items-center gap-1"><DashboardRowDisclosure expanded={expanded === key} controls={detailsId} label={title} onToggle={() => open(key, expanded !== key)} />
                <span className="font-medium">{title}</span></div>{dirty[key] && <p className="text-[11px] text-muted">{m.draft}</p>}</TableCell>
              <TableCell>{row ? row.attendanceStatus ? reportT(`attendance_${row.attendanceStatus}`) : reportT("notCaptured") : m.allStudents}{row?.attendanceNote && <p className="mt-1 max-w-40 whitespace-pre-wrap text-muted">{row.attendanceNote}</p>}</TableCell>
              <TableCell><div className="flex max-w-40 flex-wrap gap-1">{row?.checks.map(check => <LearningCheckStatusMark key={check.id} status={check.status} detail={check.title} solid />)}</div></TableCell>
              <TableCell className="max-w-56"><p className="line-clamp-2 whitespace-pre-wrap">{review?.comment || "—"}</p></TableCell>
              <TableCell><span>{communications.canRead ? latest ? m.outcomes[latest.outcome] : m.pending : "—"}</span><p className="mt-1 max-w-56 line-clamp-2 text-muted">{latest?.content}</p></TableCell>
              <TableCell className="max-w-56"><p className="line-clamp-2">{latest?.nextAction}</p><p className="text-muted">{latest?.nextFollowUpOn}</p></TableCell>
            </>}>
            <div className="grid gap-4 @4xl/followup-entry:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="space-y-3">
                {row && <div className="flex flex-wrap items-center gap-2">{row.checks.map(check => <span key={check.id} className="inline-flex items-center gap-1"><LearningCheckStatusMark status={check.status} detail={check.title} solid />{check.title}</span>)}{row.stars !== null && <span className="text-muted">★ {row.stars}</span>}</div>}
                {review && <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">{(["entryScore", "exitScore", "focus", "participation", "mastery"] as const).filter(field => review[field] !== null).map(field => <div key={field}><dt className="inline">{reviewT(field === "entryScore" ? "entry" : field === "exitScore" ? "exit" : field)}：</dt><dd className="inline">{review[field]}</dd></div>)}</dl>}
                {row?.reviewSource?.at && <p className="text-xs text-muted">{row.reviewSource.author} · {new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(row.reviewSource.at))}</p>}
                {canWriteReview && review && <div><Label htmlFor={`review-${sessionId}-${key}`} className="text-xs">{m.teacherFeedback}</Label><Input id={`review-${sessionId}-${key}`} value={review.comment} maxLength={2000} onChange={event => updateComment(key, event.target.value)} placeholder={t("studentReviewInputPlaceholder")} /></div>}
                {communications.canWrite && (drafts[key] ? <SessionCommunicationEntry draft={drafts[key]} locale={locale} pending={pendingKey === key} group={!row}
                  error={error[key]} hasNext={keys.indexOf(key) < keys.length - 1} onSave={next => void save(key, next)}
                  onChange={patch => { setDrafts(current => ({ ...current, [key]: { ...current[key], ...patch } })); setDirty(current => ({ ...current, [key]: true })); setFeedback(current => ({ ...current, [key]: "" })); }} />
                  : <div className="flex items-center gap-2"><span role="status" className="text-xs text-leaf-deep">{feedback[key]}</span><Button size="sm" variant="secondary" onClick={() => open(key)}>{m.addAnother}</Button></div>)}
                {dirty[key] && <Button size="sm" variant="ghost" disabled={Boolean(pendingKey)} onClick={() => { setDrafts(current => removeCommunicationDraft(current, key)); setDirty(current => ({ ...current, [key]: false })); }}>{locale.startsWith("en") ? "Discard this draft" : "放弃本条沟通草稿"}</Button>}
              </div>
              {communications.canRead && <SessionCommunicationHistory records={communications.records.filter(record => record.studentId === (row ? key : null))} locale={locale} timeZone={timeZone} />}
            </div>
          </FollowupRecordRow>;
        })}
      </FollowupTableBody>
    </Table></DashboardTableShell>
  </div>;
}
