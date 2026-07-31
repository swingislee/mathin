"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import type { SchoolTermRow } from "./courses";
import {
  decideLearningResultReviewAction,
  saveStageReportDraftAction,
  submitLearningResultReviewAction,
} from "./learning-result-actions";
import { LearningResultWithdrawButton } from "./LearningResultWithdrawButton";
import type { StaffLearningResult } from "./learning-results";

function localDateTime(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function contentText(result: StaffLearningResult, key: string) {
  const content = result.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return "";
  const value = content[key];
  return typeof value === "string" ? value : "";
}

export function StageReportPanel({
  studentId,
  reports,
  terms,
  canWrite,
}: {
  studentId: string;
  reports: StaffLearningResult[];
  terms: SchoolTermRow[];
  canWrite: boolean;
}) {
  const t = useTranslations("school.learningResults");
  const router = useRouter();
  const defaultTerm = terms.find((term) => term.isCurrent) ?? terms[0] ?? null;
  const [headId, setHeadId] = useState<string | null>(null);
  const [termId, setTermId] = useState(defaultTerm?.id ?? "");
  const [periodStart, setPeriodStart] = useState(defaultTerm?.startsOn ?? "");
  const [periodEnd, setPeriodEnd] = useState(defaultTerm?.endsOn ?? "");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [teacherComment, setTeacherComment] = useState("");
  const [dataCutoffAt, setDataCutoffAt] = useState(localDateTime());
  const [reviewNote, setReviewNote] = useState("");

  const selected = useMemo(() => reports.find((report) => report.headId === headId) ?? null, [headId, reports]);
  const status = selected?.status ?? "draft";

  const save = useAction(saveStageReportDraftAction, {
    successMessage: t("stageReportSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: (result) => {
      setHeadId(result.headId);
      router.refresh();
    },
  });
  const submit = useAction(submitLearningResultReviewAction, {
    successMessage: t("reviewSubmitted"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const decide = useAction(decideLearningResultReviewAction, {
    successMessage: t("reviewDecided"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setReviewNote("");
      router.refresh();
    },
  });
  const pending = save.pending || submit.pending || decide.pending;

  const reset = () => {
    const term = terms.find((item) => item.isCurrent) ?? terms[0] ?? null;
    setHeadId(null);
    setTermId(term?.id ?? "");
    setPeriodStart(term?.startsOn ?? "");
    setPeriodEnd(term?.endsOn ?? "");
    setTitle("");
    setSummary("");
    setTeacherComment("");
    setDataCutoffAt(localDateTime());
    setReviewNote("");
  };
  const openReport = (report: StaffLearningResult) => {
    setHeadId(report.headId);
    setTermId(report.termId);
    setPeriodStart(report.periodStart ?? "");
    setPeriodEnd(report.periodEnd ?? "");
    setTitle(contentText(report, "title"));
    setSummary(contentText(report, "summary"));
    setTeacherComment(contentText(report, "teacherComment"));
    setDataCutoffAt(report.dataCutoffAt ? localDateTime(new Date(report.dataCutoffAt)) : localDateTime());
    setReviewNote("");
  };
  const changeTerm = (value: string) => {
    setTermId(value);
    const term = terms.find((item) => item.id === value);
    if (term) {
      setPeriodStart(term.startsOn);
      setPeriodEnd(term.endsOn);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">{t("stageReportsTitle")}</h2>
          <p className="mt-1 text-xs text-muted">{t("stageReportsHint")}</p>
        </div>
        {canWrite && <Button size="sm" variant="secondary" onClick={reset}>{t("newStageReport")}</Button>}
      </div>

      {reports.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("noStageReports")}</p>
      ) : (
        <ul className="mt-4 grid gap-2 md:grid-cols-2">
          {reports.map((report) => (
            <li key={report.headId}>
              <button
                className="flex w-full items-start justify-between gap-3 rounded-xl border border-line px-3 py-2 text-left hover:bg-line/30"
                onClick={() => openReport(report)}
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

      {canWrite && (
        <div className="mt-5 grid gap-4 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-ink">{selected ? t("editStageReport") : t("newStageReport")}</h3>
            <Badge variant={status === "published" ? "default" : "outline"}>{t(`status_${status}`)}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Label className="grid gap-1 text-xs text-muted">
              {t("term")}
              <Select value={termId} onValueChange={changeTerm} disabled={Boolean(headId)}>
                <SelectTrigger><SelectValue placeholder={t("chooseTerm")} /></SelectTrigger>
                <SelectContent>
                  {terms.map((term) => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Label>
            <Label className="grid gap-1 text-xs text-muted">
              {t("periodStart")}
              <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} disabled={Boolean(headId)} />
            </Label>
            <Label className="grid gap-1 text-xs text-muted">
              {t("periodEnd")}
              <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} disabled={Boolean(headId)} />
            </Label>
          </div>
          <Label className="grid gap-1 text-xs text-muted">
            {t("reportTitle")}
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
          </Label>
          <Label className="grid gap-1 text-xs text-muted">
            {t("reportSummary")}
            <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={10000} rows={7} />
          </Label>
          <Label className="grid gap-1 text-xs text-muted">
            {t("teacherComment")}
            <Textarea value={teacherComment} onChange={(event) => setTeacherComment(event.target.value)} maxLength={5000} rows={4} />
          </Label>
          <Label className="grid gap-1 text-xs text-muted md:max-w-sm">
            {t("dataCutoffAt")}
            <Input type="datetime-local" value={dataCutoffAt} onChange={(event) => setDataCutoffAt(event.target.value)} />
          </Label>
          {selected?.metricVersion && (
            <p className="rounded-xl bg-line/30 px-3 py-2 text-xs text-muted">
              {t("snapshotMeta", { version: selected.metricVersion, timezone: selected.timezone ?? "—" })}
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
              <LearningResultWithdrawButton mode="head" targetId={headId} disabled={pending} />
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
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || !termId || !periodStart || !periodEnd || !title.trim() || !summary.trim()}
                  onClick={() => save.run({
                    headId,
                    studentId,
                    termId,
                    periodStart,
                    periodEnd,
                    title,
                    summary,
                    teacherComment,
                    dataCutoffAt,
                  })}
                >
                  {t("saveStageReport")}
                </Button>
                {(status === "draft" || status === "revised") && headId && (
                  <Button size="sm" disabled={pending} onClick={() => submit.run(headId)}>{t("submitReview")}</Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
