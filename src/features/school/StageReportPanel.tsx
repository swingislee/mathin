"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import type { SchoolTermRow } from "./courses";
import { schoolTermLabel } from "./school-periods";
import {
  autosaveStageReportDraftAction,
  decideLearningResultReviewAction,
  saveStageReportDraftAction,
  submitLearningResultReviewAction,
} from "./learning-result-actions";
import type { SaveStageReportInput } from "./learning-result-actions";
import { LearningResultWithdrawButton } from "./LearningResultWithdrawButton";
import type { StaffLearningResult } from "./learning-results";
import { StageReportEvidence } from "./StageReportEvidence";
import type { StudentLearning } from "./students";

function localDateTime(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function contentText(result: StaffLearningResult | null, key: string) {
  const content = result?.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return "";
  const value = content[key];
  return typeof value === "string" ? value : "";
}

export function StageReportPanel({
  studentId,
  reports,
  terms,
  learning,
  canWrite,
  initialReportId,
}: {
  studentId: string;
  reports: StaffLearningResult[];
  terms: SchoolTermRow[];
  learning: StudentLearning;
  canWrite: boolean;
  initialReportId?: string;
}) {
  const t = useTranslations("school.learningResults");
  const scheduleT = useTranslations("school.schedule");
  const router = useRouter();
  const defaultTerm = terms.find((term) => term.isCurrent) ?? terms[0] ?? null;
  const initialReport = reports.find((report) => report.headId === initialReportId) ?? null;
  const [editorOpen, setEditorOpen] = useState(Boolean(initialReport));
  const [headId, setHeadId] = useState<string | null>(initialReport?.headId ?? null);
  const [termId, setTermId] = useState(initialReport?.termId ?? defaultTerm?.id ?? "");
  const [periodStart, setPeriodStart] = useState(initialReport?.periodStart ?? defaultTerm?.startsOn ?? "");
  const [periodEnd, setPeriodEnd] = useState(initialReport?.periodEnd ?? defaultTerm?.endsOn ?? "");
  const [title, setTitle] = useState(contentText(initialReport, "title"));
  const [summary, setSummary] = useState(contentText(initialReport, "summary"));
  const [teacherComment, setTeacherComment] = useState(contentText(initialReport, "teacherComment"));
  const [dataCutoffAt, setDataCutoffAt] = useState(initialReport?.dataCutoffAt ? localDateTime(new Date(initialReport.dataCutoffAt)) : localDateTime());
  const [reviewNote, setReviewNote] = useState("");
  const [status, setStatus] = useState(initialReport?.status ?? "draft");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const draftRef = useRef<SaveStageReportInput>({
    headId: initialReport?.headId ?? null,
    studentId,
    termId: initialReport?.termId ?? defaultTerm?.id ?? "",
    periodStart: initialReport?.periodStart ?? defaultTerm?.startsOn ?? "",
    periodEnd: initialReport?.periodEnd ?? defaultTerm?.endsOn ?? "",
    title: contentText(initialReport, "title"),
    summary: contentText(initialReport, "summary"),
    teacherComment: contentText(initialReport, "teacherComment"),
    dataCutoffAt: initialReport?.dataCutoffAt ? localDateTime(new Date(initialReport.dataCutoffAt)) : localDateTime(),
  });
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const didMountRef = useRef(false);
  const suppressNextSaveRef = useRef(false);

  const selected = useMemo(() => reports.find((report) => report.headId === headId) ?? null, [headId, reports]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) await savingRef.current;
    if (savedSequenceRef.current === sequenceRef.current) return true;
    const input = draftRef.current;
    if (!input.termId || !input.periodStart || !input.periodEnd || !input.dataCutoffAt) return false;
    const sequence = sequenceRef.current;
    setSaveState("saving");
    const request = autosaveStageReportDraftAction(input).then((result) => {
      if (!result.ok) {
        setSaveState("error");
        return false;
      }
      setHeadId(result.data.headId);
      draftRef.current.headId = result.data.headId;
      if (result.data.status === "draft" || result.data.status === "revised") setStatus(result.data.status);
      savedSequenceRef.current = sequence;
      setSaveState("saved");
      if (sequenceRef.current !== sequence) timerRef.current = window.setTimeout(() => void flushRef.current(), 1_000);
      return true;
    }).catch(() => {
      setSaveState("error");
      return false;
    }).finally(() => {
      savingRef.current = null;
    });
    savingRef.current = request;
    return request;
  }, [setHeadId, setSaveState, setStatus]);

  useEffect(() => { flushRef.current = flush; }, [flush]);

  const submit = useAction(async (input: SaveStageReportInput) => {
    const saved = await saveStageReportDraftAction(input);
    if (!saved.ok) return saved;
    setHeadId(saved.data.headId);
    draftRef.current.headId = saved.data.headId;
    return submitLearningResultReviewAction(saved.data.headId);
  }, {
    successMessage: t("reviewSubmitted"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setStatus("review");
      router.refresh();
    },
  });
  const decide = useAction(async (input: Parameters<typeof decideLearningResultReviewAction>[0]) => {
    const result = await decideLearningResultReviewAction(input);
    if (result.ok) setStatus(input.decision === "publish" ? "published" : "draft");
    return result;
  }, {
    successMessage: t("reviewDecided"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setReviewNote("");
      router.refresh();
    },
  });
  const pending = saveState === "saving" || submit.pending || decide.pending;

  const startNew = () => {
    const term = terms.find((item) => item.isCurrent) ?? terms[0] ?? null;
    setHeadId(null);
    setTermId(termId || term?.id || "");
    setPeriodStart(periodStart || term?.startsOn || "");
    setPeriodEnd(periodEnd || term?.endsOn || "");
    setTitle("");
    setSummary("");
    setTeacherComment("");
    setDataCutoffAt(localDateTime());
    setReviewNote("");
    setStatus("draft");
    suppressNextSaveRef.current = false;
    setEditorOpen(true);
  };
  const openReport = (report: StaffLearningResult) => {
    suppressNextSaveRef.current = true;
    setHeadId(report.headId);
    setTermId(report.termId);
    setPeriodStart(report.periodStart ?? "");
    setPeriodEnd(report.periodEnd ?? "");
    setTitle(contentText(report, "title"));
    setSummary(contentText(report, "summary"));
    setTeacherComment(contentText(report, "teacherComment"));
    setDataCutoffAt(report.dataCutoffAt ? localDateTime(new Date(report.dataCutoffAt)) : localDateTime());
    setReviewNote("");
    setStatus(report.status);
    setEditorOpen(true);
  };
  const changeTerm = (value: string) => {
    setTermId(value);
    const term = terms.find((item) => item.id === value);
    if (term) {
      setPeriodStart(term.startsOn ?? "");
      setPeriodEnd(term.endsOn ?? "");
    }
  };
  useEffect(() => {
    draftRef.current = {
      headId,
      studentId,
      termId,
      periodStart,
      periodEnd,
      title,
      summary,
      teacherComment,
      dataCutoffAt,
    };
  }, [dataCutoffAt, headId, periodEnd, periodStart, studentId, summary, teacherComment, termId, title]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (!editorOpen || !canWrite || status === "review") return;
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }
    sequenceRef.current += 1;
    setSaveState("saving");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushRef.current(), 1_000);
  }, [canWrite, dataCutoffAt, editorOpen, flush, periodEnd, periodStart, status, summary, teacherComment, termId, title]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    void flush();
  }, [flush]);

  const metricVersion = selected?.metricVersion === "mathin-learning-report-v1"
    ? t("metricVersionMathinLearningReportV1")
    : selected?.metricVersion;

  const editor = editorOpen && canWrite ? (
    <section className="min-w-0 rounded-2xl border border-line bg-card p-4 @3xl/page:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium text-ink">{selected ? t("editStageReport") : t("newStageReport")}</h3>
          <p className="mt-1 text-xs text-muted">{t("editorEvidenceHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status === "published" ? "default" : "outline"}>{t(`status_${status}`)}</Badge>
          <Button size="sm" variant="ghost" onClick={() => { void flush(); setEditorOpen(false); }}>{t("closeEditor")}</Button>
        </div>
      </div>
      <div className="mt-4 grid gap-4">
        <Label className="grid gap-1 text-xs text-muted">
          {t("term")}
          <Select value={termId} onValueChange={changeTerm} disabled={Boolean(headId)}>
            <SelectTrigger><SelectValue placeholder={t("chooseTerm")} /></SelectTrigger>
            <SelectContent>
              {terms.map((term) => <SelectItem key={term.id} value={term.id}>{schoolTermLabel(term, scheduleT(`period${term.term}`))}</SelectItem>)}
            </SelectContent>
          </Select>
        </Label>
        <Label className="grid gap-1 text-xs text-muted">
          {t("reportTitle")}
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={status === "review"} />
        </Label>
        <Label className="grid gap-1 text-xs text-muted">
          {t("reportSummary")}
          <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={10000} rows={10} disabled={status === "review"} />
        </Label>
        <Label className="grid gap-1 text-xs text-muted">
          {t("teacherComment")}
          <Textarea value={teacherComment} onChange={(event) => setTeacherComment(event.target.value)} maxLength={5000} rows={5} disabled={status === "review"} />
        </Label>
        <Label className="grid gap-1 text-xs text-muted md:max-w-sm">
          {t("dataCutoffAt")}
          <DateTimePicker mode="datetime" value={dataCutoffAt} onValueChange={setDataCutoffAt} disabled={status === "review"} />
        </Label>
        {metricVersion && (
          <p className="rounded-xl bg-line/30 px-3 py-2 text-xs text-muted">
            {t("snapshotMeta", { version: metricVersion, timezone: selected?.timezone ?? "—" })}
          </p>
        )}
        {status === "review" && (
          <Label className="grid gap-1 text-xs text-muted">
            {t("reviewNote")}
            <Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} rows={3} />
          </Label>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {status === "published" && headId && (
            <LearningResultWithdrawButton mode="head" targetId={headId} disabled={pending} onSuccess={() => setStatus("withdrawn")} />
          )}
          {status === "review" && headId ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !reviewNote.trim()}
                onClick={() => decide.run({ headId, decision: "changes_requested", note: reviewNote })}
              >
                {t("requestChanges")}
              </Button>
              <Button size="sm" disabled={pending} onClick={() => decide.run({ headId, decision: "publish", note: reviewNote })}>
                {t("publishStageReport")}
              </Button>
            </>
          ) : (
            <>
              <span className={saveState === "error" ? "self-center text-xs text-rose" : "self-center text-xs text-muted"} aria-live="polite">
                {saveState === "saving" ? <LoaderCircle size={13} className="mr-1 inline animate-spin motion-reduce:animate-none" /> : null}
                {saveState === "saving" ? t("stageReportSaving") : saveState === "error" ? t("stageReportSaveFailed") : t("stageReportSavedAuto")}
              </span>
              {saveState === "error" && (
                <Button size="sm" variant="ghost" onClick={() => void flush()}>{t("retry")}</Button>
              )}
              {(status === "draft" || status === "revised") && (
                <Button
                  size="sm"
                  disabled={pending || !termId || !periodStart || !periodEnd || !title.trim() || !summary.trim()}
                  onClick={() => submit.run(draftRef.current)}
                >
                  {t("submitReview")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  ) : null;

  return (
    <div className="grid gap-5">
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-ink">{t("stageReportsTitle")}</h2>
            <p className="mt-1 text-xs text-muted">{t("stageReportsHint")}</p>
          </div>
          {canWrite && <Button size="sm" variant="secondary" onClick={startNew}>{t("newStageReport")}</Button>}
        </div>

        {reports.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("noStageReports")}</p>
        ) : (
          <ul className="mt-4 grid gap-2 @2xl/page:grid-cols-2 @6xl/page:grid-cols-3">
            {reports.map((report) => (
              <li key={report.headId}>
                <button
                  className="flex w-full items-start justify-between gap-3 rounded-xl border border-line px-3 py-2 text-left hover:bg-line/30 disabled:cursor-default disabled:hover:bg-transparent"
                  onClick={() => openReport(report)}
                  disabled={!canWrite}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{contentText(report, "title") || t("untitledStageReport")}</span>
                    <span className="mt-1 block text-xs text-muted">{report.periodStart} — {report.periodEnd} · {t("revision", { no: report.revisionNo ?? 0 })}</span>
                  </span>
                  <Badge variant={report.status === "published" ? "default" : "outline"}>{t(`status_${report.status}`)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={editor ? "grid min-w-0 gap-5 @6xl/page:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]" : "grid min-w-0"}>
        {editor}
        <StageReportEvidence
          learning={learning}
          periodStart={periodStart}
          periodEnd={periodEnd}
          onPeriodStartChange={setPeriodStart}
          onPeriodEndChange={setPeriodEnd}
          lockPeriod={Boolean(editor && headId)}
        />
      </div>
    </div>
  );
}
