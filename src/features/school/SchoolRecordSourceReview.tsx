"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getSchoolRecordContextAction } from "./actions/school-record-review";
import { schoolRecordReviewMessages, type SchoolRecordSubject, type SchoolRecordContext } from "./school-record-review-contract";
import { Student360Trigger } from "./Student360Sheet";

function SourceRecord({ record, locale, initiallyOpen }: { record: SchoolRecordContext["sources"][number]; locale: string; initiallyOpen: boolean }) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  const m = schoolRecordReviewMessages(locale);
  const id = `source-fields-${record.id}`;
  return <section className="py-3">
    <Button variant="ghost" className="h-auto w-full justify-start gap-2 whitespace-normal px-0 text-left" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
      {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
      <span><span className="block">{record.table || m.sourceTitle}{record.date ? ` · ${record.date}` : ""}</span>
        <span className="block break-all text-xs font-normal text-muted">{record.source}</span></span>
    </Button>
    {record.association === "inferred" ? <Badge variant="outline" className="mt-1">{m.inferred}</Badge> : null}
    {expanded ? <dl id={id} className="mt-3 grid grid-cols-[minmax(6rem,1fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-sm">
      {record.cells.map((cell, index) => <div key={`${cell.id}:${index}`} className="contents">
        <dt className="break-words text-muted">{cell.name}</dt><dd className="whitespace-pre-wrap break-words">{cell.text}</dd>
      </div>)}
    </dl> : null}
  </section>;
}

/** 点击后再读取原表全文；各来源记录按自己的字段和值展示。 */
export function SchoolRecordSourceReview({ subject, locale }: { subject: SchoolRecordSubject; locale: string }) {
  const m = schoolRecordReviewMessages(locale);
  const [open, setOpen] = useState(false), [data, setData] = useState<SchoolRecordContext | null>(null);
  const [pending, setPending] = useState(false), [failedPage, setFailedPage] = useState<number | null>(null);
  async function load(page: number) {
    if (pending) return;
    setPending(true); setFailedPage(null);
    try {
      const result = await getSchoolRecordContextAction({ subject, page });
      if (result.ok) setData(result.data); else setFailedPage(page);
    } catch { setFailedPage(page); }
    finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value && !data && !pending) void load(1); }}>
    <DialogTrigger asChild><Button variant="secondary" size="sm" className="h-auto whitespace-normal text-left">{m.open}</Button></DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-3xl">
      <DialogHeader><DialogTitle>{m.open}</DialogTitle><DialogDescription>{m.sourceHint}</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto pr-2" aria-busy={pending}>
        {pending ? <p role="status" className="py-3 text-sm text-muted">{m.loading}</p> : null}
        {failedPage !== null ? <div role="alert" className="flex items-center gap-3 py-3 text-sm"><span>{m.failed}</span><Button variant="secondary" size="sm" disabled={pending} onClick={() => void load(failedPage)}>{m.retry}</Button></div> : null}
        {data ? <>
          {data.candidates.length > 0 ? <section className="pb-5">
            <h3 className="text-sm font-medium"><Badge variant="outline">{m.possibleDuplicate} · {data.candidates.length}</Badge></h3>
            <p className="mt-2 text-xs leading-5 text-muted">{m.duplicateHint} {m.decisionHint}</p>
            <ul aria-label={m.candidates} className="mt-3 space-y-2">{data.candidates.map(candidate => <li key={candidate.studentId ?? candidate.leadId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{candidate.name} · {candidate.studentId ? m.student : m.lead} · {candidate.phone || m.unknown}{candidate.school ? ` · ${candidate.school}` : ""}</span>
              <Student360Trigger subject={candidate} fallback={candidate} className="text-xs text-primary">{m.view}</Student360Trigger>
            </li>)}</ul>
          </section> : null}
          <h3 className="text-sm font-medium">{m.sourceTitle} · {data.sourceCount}</h3>
          {data.sources.length ? data.sources.map((record, index) => <SourceRecord key={record.id} record={record} locale={locale} initiallyOpen={index === 0} />) : <p className="py-3 text-sm text-muted">{m.empty}</p>}
        </> : null}
      </div>
      {data && data.sourceCount > data.pageSize ? <div className="flex items-center justify-between gap-3 pt-2 text-xs text-muted">
        <Button variant="secondary" size="sm" disabled={pending || data.page === 1} onClick={() => void load(data.page - 1)}>{m.previous}</Button>
        <span>{data.page} / {Math.ceil(data.sourceCount / data.pageSize)}</span>
        <Button variant="secondary" size="sm" disabled={pending || data.page * data.pageSize >= data.sourceCount} onClick={() => void load(data.page + 1)}>{m.next}</Button>
      </div> : null}
    </DialogContent>
  </Dialog>;
}
