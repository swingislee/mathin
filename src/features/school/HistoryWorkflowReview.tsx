"use client";
import { useState } from "react";
import { useRouter, Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Student360Trigger } from "./Student360Sheet";
import { decideHistoryWorkflowReview } from "./history-workflow-review-actions";
import type { WorkflowReviewRow } from "./history-workflow-review";

export function HistoryWorkflowReview({ rows, canEdit, locale }: { rows: WorkflowReviewRow[]; canEdit: boolean; locale: string }) {
  const en = locale.startsWith("en"), router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({}), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  const decide = async (row: WorkflowReviewRow, decision: "continue" | "archive") => {
    setBusy(row.key); setError("");
    try {
      const result = await decideHistoryWorkflowReview({ key: row.key, decision, note: notes[row.key]?.trim() || (decision === "continue" ? "实际办理时恢复" : "实际办理时核对为历史"), expectedAt: row.decided_at });
      if (result.ok) router.refresh();
      else setError(en ? "Could not save. Refresh to check the latest decision and try again." : "保存未完成，请刷新核对最新决定后重试。");
    } finally { setBusy(null); }
  };
  return <div className="space-y-3">{error ? <p role="alert">{error}</p> : null}{rows.map(row => <div key={row.key} className="rounded-lg border border-border p-3 text-sm">
    <div className="flex flex-wrap items-center gap-3"><strong>{row.name}</strong><span className="text-muted">{row.record_id ? (en ? "Source business record" : "来源业务记录") : (en ? "Student worklist" : "学员办理名单")}</span>
      {row.record_id ? <Link href={`/dashboard/history-import?record=${encodeURIComponent(row.record_id)}`}>{en ? "Review source" : "核对原始资料"}</Link>
        : <Student360Trigger subject={{ studentId: row.student_id, leadId: row.lead_id }} fallback={{ name: row.name, grade: null }}>{en ? "Review history" : "核对完整经历"}</Student360Trigger>}
    </div>
    <p className="mt-1 text-xs text-muted">{en ? "Inferred historical from import evidence · check when needed." : "按导入线索暂判为历史 · 有疑点，办理时核对。"}{row.latest_period ? ` ${en ? "Source period" : "来源期次"}：${row.latest_period}` : ""}</p>
    <p className="mt-1 text-xs text-muted">{row.record_id ? (en ? "Continue makes this source's business facts available for processing; the student worklist is reviewed separately." : "继续办理会启用这条来源中的业务事实；学员是否进入办理名单单独确认。") : (en ? "Continue returns this person to the worklist. Historical business records keep their own review decisions." : "继续办理会将此人放回办理名单；历史业务记录保留各自的复核决定。")}</p>
    {row.note ? <p className="mt-1 text-xs">{row.decision === "continue" ? (en ? "Continue" : "继续办理") : (en ? "Keep historical" : "保留历史")} · {row.note}</p> : null}
    {canEdit ? <div className="mt-2 flex flex-wrap gap-2"><Input className="min-w-48 flex-1" aria-label={`${en ? "Decision reason" : "判断依据"} · ${row.name}`} placeholder={en ? "Optional note" : "补充说明（选填）"} maxLength={1000} value={notes[row.key] ?? ""} onChange={e => setNotes(current => ({ ...current, [row.key]: e.target.value }))} />
      <Button size="sm" disabled={Boolean(busy)} onClick={() => decide(row, "continue")}>{en ? "Restore to worklist" : "恢复办理"}</Button>
      <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => decide(row, "archive")}>{en ? "Keep historical" : "保留历史"}</Button></div> : null}
  </div>)}</div>;
}
