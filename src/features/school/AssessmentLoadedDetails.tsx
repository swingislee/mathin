"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { getAssessmentListDetailAction } from "./assessment-list-actions";
import { AssessmentRecordDetails } from "./AssessmentRecordDetails";
import { SourceCompletionNotice } from "./SourceCompletionNotice";
import type { AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { assessmentAppointmentClosed } from "./assessment-workbench-contract";

/** 展开后的证据独立读取；失败时保留当前行并允许重试。 */
export function AssessmentLoadedDetails(props: ComponentProps<typeof AssessmentRecordDetails> & { onLoaded?: (row: AssessmentWorkbenchRow) => void }) {
  const [detail, setDetail] = useState<{ row: AssessmentWorkbenchRow; version: string } | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const key = props.row.id, summary = props.row.listSummary, version = props.row.updatedAt;
  useEffect(() => {
    if (!summary) return;
    let active = true;
    getAssessmentListDetailAction(key).then(result => {
      if (!active) return;
      if (result.ok) { setDetail({ row: result.data, version }); props.onLoaded?.(result.data); } else setFailed(true);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  // onLoaded 只接收该次请求的同一行；父级回调身份不影响正在进行的读取。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, summary, version, attempt]);
  const row = props.row.listSummary ? detail?.row.id === key && detail.version === version ? detail.row : null : props.row;
  if (!row) return <div className="px-4 py-3 text-sm text-muted" role="status">
    {failed ? <Button variant="secondary" size="sm" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>
      {props.locale.startsWith("en") ? "Could not load details. Retry" : "详情读取失败，重试"}
    </Button> : props.locale.startsWith("en") ? "Loading…" : "正在读取…"}
  </div>;
  return <>
    {row.sourceCompletion ? <div className="px-4 py-3"><SourceCompletionNotice summary={row.sourceCompletion} locale={props.locale} /></div> : null}
    {assessmentAppointmentClosed(row) ? null : <AssessmentRecordDetails {...props} row={row} onSaved={row => { setDetail({ row, version }); props.onSaved(row); }} />}
  </>;
}
