"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { DashboardCommandActions, DashboardCommandPanel, DashboardCommandState, DashboardTableShell } from "./dashboard-page";
import { FollowupRecordRow, FollowupTableBody } from "./dashboard-page/FollowupRecordRow";
import { DashboardRowDisclosure } from "./dashboard-page/DashboardRowDisclosure";
import { LearningCheckStatusMark } from "./LearningCheckStatusMark";
import { publishSessionReviewsAction } from "./learning-result-actions";
import { LearningResultWithdrawButton } from "./LearningResultWithdrawButton";
import type { LearningResultStatus } from "./learning-results";
import { saveSessionReviewsAction, type ReviewRecord } from "./review-actions";
import { latestSessionCommunication, type SessionCommunications } from "./session-communication-contract";
import { useSessionCommunicationAutosave } from "./use-session-communication-autosave";
import { sessionCommunicationMessages } from "./session-communication-messages";
import { SessionCommunicationEntry } from "./SessionCommunicationEntry";
import { finishSessionCommunications, recordSessionCommunication } from "./session-communication-actions";
import { SessionCommunicationHistory } from "./SessionCommunicationHistory";
import { PostclassLearningEditor } from "./PostclassLearningEditor";
import type { PostclassLearning } from "./postclass-learning-contract";

export interface SessionStudentPostworkRow {
  studentId: string; displayName: string; attendanceStatus: "present" | "absent" | "late" | "leave" | null; stars: number | null;
  attendanceNote?: string;
  reviewSource?: { author: string | null; at: string };
  checks: Array<{ id: string; title: string; status: "explained" | "independent" | "prompted" | "imitated" | "incomplete" | "unchecked" }>;
}

const GROUP_KEY = "class";
// 保留上一版已打开页面的提交引用；发布时核对新旧 Server Action manifest。
const retainedCommunicationActions = { recordSessionCommunication, finishSessionCommunications };

export function SessionStudentPostworkTable({ sessionId, rows, initialReviews, resultStatus, canWriteReview, initialCommunications, locale, timeZone, today, onDirtyChange, onReviewsSaved, workspaceLink }: {
  sessionId: string; rows: SessionStudentPostworkRow[]; initialReviews: ReviewRecord[]; resultStatus: LearningResultStatus;
  canWriteReview: boolean; initialCommunications: SessionCommunications; locale: string; timeZone: string; today: string;
  onDirtyChange?: (dirty: boolean) => void;
  onReviewsSaved?: (records: ReviewRecord[]) => void;
  workspaceLink?: ReactNode;
}) {
  const t = useTranslations("school.session");
  const reviewT = useTranslations("school.reviews");
  const reportT = useTranslations("classroom.report");
  const m = sessionCommunicationMessages(locale);
  const router = useRouter();
  const [learningEdit, setLearningEdit] = useState<PostclassLearning | null>(null);
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
  const continuingNavigation = useRef(false);
  const autosave = useSessionCommunicationAutosave(sessionId, initialCommunications, locale, today);
  const { communications, entries } = autosave;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const studentIds = rows.map(row => row.studentId);
  const keys = [GROUP_KEY, ...studentIds];

  const flushReviews = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return await savingRef.current ? flushRef.current() : false;
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
    const saved = await request;
    return saved && savedSequenceRef.current !== sequenceRef.current ? flushRef.current() : saved;
  }, [sessionId]);
  useEffect(() => { flushRef.current = flushReviews; }, [flushReviews]);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); void flushReviews(); }, [flushReviews]);
  const hasDrafts = autosave.dirty || reviewSaveState !== "saved";
  const flushCommunications = autosave.flush;
  useEffect(() => { onDirtyChange?.(hasDrafts); }, [hasDrafts, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!hasDrafts) return;
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [hasDrafts]);
  useEffect(() => {
    if (!hasDrafts) return;
    const beforeNavigate = (event: MouseEvent) => {
      if (continuingNavigation.current || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || link.target && link.target !== "_self" || link.href.split("#")[0] === window.location.href.split("#")[0]) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void Promise.all([flushReviews(), flushCommunications()]).then(([reviewsSaved, communicationsSaved]) => {
        if (!reviewsSaved || !communicationsSaved || !link.isConnected) return;
        continuingNavigation.current = true;
        try { link.click(); } finally { continuingNavigation.current = false; }
      });
    };
    document.addEventListener("click", beforeNavigate, true);
    return () => document.removeEventListener("click", beforeNavigate, true);
  }, [hasDrafts, flushReviews, flushCommunications]);
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
    if ((expanded && expanded !== key) || !value) void autosave.flush(expanded ?? key);
    if (value) autosave.open(key);
  };
  const reviewByStudent = new Map(reviews.map(review => [review.studentId, review]));
  const pendingReviews = reviewSaveState === "saving" || publishReviews.pending;

  return <div className="space-y-2">
    <DashboardCommandPanel>
      <DashboardCommandState>
        {communications.completed && !autosave.dirty && <Badge variant="outline">{m.completed}</Badge>}
        {(canWriteReview || communications.canWrite) && <span className="text-xs text-muted" role="status">
          {(reviewSaveState === "saving" || Object.values(entries).some(entry => entry.state === "saving")) && <LoaderCircle size={12} className="mr-1 inline animate-spin" />}
          {reviewSaveState === "error" || Object.values(entries).some(entry => entry.error) ? m.needsAttention : hasDrafts ? m.saving : m.autosaved}</span>}
      </DashboardCommandState>
      <DashboardCommandActions>
        {canWriteReview && <PostclassLearningEditor sessionId={sessionId} disabled={hasDrafts || pendingReviews} onSaved={data => {
          setLearningEdit(data); setReviews(data.reviews); reviewsRef.current = data.reviews; savedReviewsRef.current = data.reviews;
          onReviewsSavedRef.current?.(data.reviews.filter(review => review.comment.trim() || [review.entryScore, review.exitScore, review.focus, review.participation, review.mastery].some(value => value !== null)));
          setStatus(current => current === "published" ? "revised" : current); router.refresh();
        }} />}
        {canWriteReview && status === "published" && <LearningResultWithdrawButton mode="sessionReviews" targetId={sessionId} disabled={pendingReviews} onSuccess={() => setStatus("withdrawn")} />}
        {canWriteReview && reviewSaveState === "error" && <><Button size="sm" variant="ghost" onClick={() => void flushReviews()}>{t("retry")}</Button>
          <Button size="sm" variant="ghost" onClick={() => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
            dirtyReviewsRef.current.clear(); sequenceRef.current = savedSequenceRef.current;
            reviewsRef.current = savedReviewsRef.current; setReviews(savedReviewsRef.current); setReviewSaveState("saved");
          }}>{locale.startsWith("en") ? "Discard unsaved feedback" : "放弃未保存课评"}</Button></>}
        {canWriteReview && <Button size="sm" disabled={pendingReviews} onClick={() => publishReviews.run()}>{t(["published", "withdrawn", "revised"].includes(status) ? "republish" : "publishStudentReviews")}</Button>}
        {workspaceLink}
      </DashboardCommandActions>
    </DashboardCommandPanel>
    {!communications.canRead && <p className="text-xs text-muted">{m.noPermission}</p>}
    <DashboardTableShell data-followup-workbench data-session-postwork-table><Table className="min-w-[800px] text-xs" containerClassName="max-h-[70vh] overflow-auto">
      <TableHeader><TableRow><TableHead className="sticky left-0 z-20 min-w-32 bg-card">{m.student}</TableHead>
        <TableHead>{reportT("attendance")}</TableHead><TableHead>{m.learning}</TableHead><TableHead>{m.teacherFeedback}</TableHead>
        <TableHead>{m.outcome}</TableHead><TableHead>{m.nextAction}</TableHead></TableRow></TableHeader>
      <FollowupTableBody onNavigate={key => { setActive(key); return true; }}>
        {keys.map(key => {
          const original = rows.find(student => student.studentId === key);
          const row = original && learningEdit ? { ...original, checks: learningEdit.checks.map(check => ({ id: check.id, title: check.title,
            status: learningEdit.results.find(result => result.studentId === key && result.checkId === check.id)?.status ?? "unchecked" as const })) } : original;
          if (!row && !communications.canRead) return null;
          const review = reviewByStudent.get(key);
          const latest = latestSessionCommunication(communications.records, row ? key : null);
          const title = row?.displayName ?? m.classRecord;
          const detailsId = `postwork-${sessionId}-${key}`;
          const entry = entries[key];
          return <FollowupRecordRow key={key} rowKey={key} active={active === key} expanded={expanded === key}
            onActivate={() => setActive(key)} onExpandedChange={value => open(key, value)} onSave={communications.canWrite ? () => void autosave.flush(key) : undefined}
            detailsId={detailsId} title={title} colSpan={6} summary={<>
              <TableCell className="sticky left-0 z-10 bg-inherit"><div className="flex items-center gap-1"><DashboardRowDisclosure expanded={expanded === key} controls={detailsId} label={title} onToggle={() => open(key, expanded !== key)} />
                <span className="font-medium">{title}</span></div>{entry?.dirty && <p className="text-[11px] text-muted">{entry.error ? m.needsAttention : m.saving}</p>}</TableCell>
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
                {communications.canWrite && entry && <SessionCommunicationEntry draft={entry.draft} locale={locale} group={!row}
                  retainedActions={retainedCommunicationActions}
                  error={entry.error} saving={entry.state === "saving"} saved={Boolean(entry.saved) && !entry.dirty}
                  onFlush={() => void autosave.flush(key)} onChange={patch => autosave.change(key, patch)}
                  onNext={keys.indexOf(key) < keys.length - 1 ? () => open(keys[keys.indexOf(key) + 1]) : undefined}
                  onAddAnother={entry.saved && !entry.dirty ? () => autosave.addAnother(key) : undefined} />}
                {entry?.error && !entry.request && <Button size="sm" variant="ghost" onClick={() => { autosave.discard(key); autosave.open(key); }}>{m.discard}</Button>}
              </div>
              {communications.canRead && <SessionCommunicationHistory records={communications.records.filter(record => record.studentId === (row ? key : null))} locale={locale} timeZone={timeZone} />}
            </div>
          </FollowupRecordRow>;
        })}
      </FollowupTableBody>
    </Table></DashboardTableShell>
  </div>;
}
