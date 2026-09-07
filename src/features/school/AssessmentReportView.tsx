"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { AssessmentReport } from "./assessment-workflow-contract";

/** 冻结版本的家长版报告；打印只处理当前快照，不登记发送。 */
export function AssessmentReportView({ report, locale }: { report: AssessmentReport; locale: string }) {
  const t = useTranslations("school.assessmentWorkflow");
  const bands = useTranslations("school.teacherAssessment");
  const p = report.payload;
  return <>
    <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
      <Button size="sm" onClick={() => window.print()}><Printer className="size-4" />{t("printReport")}</Button>
      <p className="text-xs text-muted">{t("printHint")}</p>
    </div>
    <article className="assessment-report-root mx-auto max-w-[190mm] bg-white px-8 py-10 text-slate-950" data-assessment-report={report.id}>
      <header className="border-b-2 border-slate-800 pb-5"><p className="text-xs tracking-[0.2em] text-slate-500">MATHIN</p>
        <h1 className="mt-2 text-2xl font-semibold">{t("reportTitle")}</h1>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm"><span className="font-medium">{p.name}</span>
          <span>{p.gradeText || (p.grade ? t("grade", { grade: p.grade }) : "")}</span>
          <span>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(p.assessedAt))}</span></div>
      </header>
      {p.score !== null || p.assessmentBand ? <section className="my-6 flex flex-wrap gap-10 rounded bg-slate-50 p-5">
        {p.score !== null ? <div><p className="text-xs text-slate-500">{t("score")}</p><p className="mt-1 text-2xl font-semibold">{p.score}{p.totalScore ? <span className="text-sm font-normal text-slate-500"> / {p.totalScore}</span> : null}</p></div> : null}
        {p.assessmentBand ? <div><p className="text-xs text-slate-500">{t("band")}</p><p className="mt-1 text-2xl font-semibold">{bands("band_" + p.assessmentBand)}</p></div> : null}
      </section> : null}
      {(["strengths", "focusAreas", "teacherObservation", "recommendation"] as const).map((key) => p[key] ? <section key={key} className="mt-6">
        <h2 className="text-sm font-semibold">{t("report_" + key)}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{p[key]}</p>
      </section> : null)}
      <footer className="mt-10 border-t border-slate-200 pt-4 text-xs leading-6 text-slate-500">
        <p>{t("reportSource_" + p.resultSource)}{p.recordedByName ? " · " + p.recordedByName : ""} · {t("version", { version: report.version })}</p>
        <p>{t("reportFooter")}</p>
      </footer>
    </article>
    <style jsx global>{`
      @media print {
        @page { size: A4 portrait; margin: 14mm; }
        body:has(.assessment-report-root), body *:has(.assessment-report-root) {
          display: block !important; position: static !important;
          height: auto !important; min-height: 0 !important; max-height: none !important;
          overflow: visible !important; padding: 0 !important; margin: 0 !important;
        }
        body:has(.assessment-report-root) > :not(:has(.assessment-report-root)):not(.assessment-report-root),
        body *:has(.assessment-report-root) > :not(:has(.assessment-report-root)):not(.assessment-report-root) { display: none !important; }
        .assessment-report-root {
          width: 100%; max-width: none; padding: 0; margin: 0;
          -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
        }
        .assessment-report-root h2 { break-after: avoid; }
        .assessment-report-root p { orphans: 3; widows: 3; }
        .assessment-report-root header, .assessment-report-root footer { break-inside: avoid; }
      }
    `}</style>
  </>;
}
