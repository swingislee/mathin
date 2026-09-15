"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LearningCheckMatrixEntry, type LearningCheckMatrixOrientation } from "./LearningCheckMatrixEntry";
import { LearningCheckStatusLegend } from "./LearningCheckStatusMark";
import { AssignmentQuestionSummary } from "./AssignmentQuestionSummary";
import { DashboardCommandActions, DashboardCommandPanel, DashboardCommandState, DashboardSection } from "./dashboard-page";
import { addAssignmentQuestionsAction, saveAssignmentQuestionResultsAction } from "./assignment-question-actions";
import { assignmentQuestionKey, assignmentQuestionUndo, mergeAssignmentQuestionResults, type AssignmentQuestionChange, type AssignmentQuestionWorkbook } from "./assignment-question-contract";

export function AssignmentQuestionWorkbench({ initial }: { initial: AssignmentQuestionWorkbook }) {
  const t = useTranslations("school.homeworkQuestions");
  const ts = useTranslations("school.session");
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [orientation, setOrientation] = useState<LearningCheckMatrixOrientation>("by-student");
  const [studentId, setStudentId] = useState<string | null>(initial.students[0]?.id ?? null);
  const [questionId, setQuestionId] = useState<string | null>(initial.questions[0]?.id ?? null);
  const [adding, setAdding] = useState(initial.questions.length === 0);
  const [titles, setTitles] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<AssignmentQuestionChange[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const results = useMemo(() => new Map(data.results.map(row => [assignmentQuestionKey(row.studentId, row.questionId), row])), [data.results]);
  const activeKey = assignmentQuestionKey(studentId ?? "", questionId ?? "");
  const activeResult = results.get(activeKey);
  const note = notes[activeKey] ?? activeResult?.note ?? "";
  const failure = (code: string) => { setMessage(t(code === "CONFLICT" ? "conflict" : code === "QUESTION_LIMIT" ? "questionLimit" : "failed")); };
  async function save(changes: AssignmentQuestionChange[], isUndo = false) {
    if (busy.current || !changes.length || !data.canWrite) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await saveAssignmentQuestionResultsAction({ assignmentId: data.assignment.id, changes });
      if (!result.ok) { failure(result.code); return; }
      setUndo(isUndo ? [] : assignmentQuestionUndo(data.results, result.data));
      setData(current => ({ ...current, results: mergeAssignmentQuestionResults(current.results, result.data) }));
      setNotes(current => { const next = { ...current }; for (const row of result.data) delete next[assignmentQuestionKey(row.studentId, row.questionId)]; return next; }); setMessage(t("saved"));
    } catch { failure("UNAVAILABLE"); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="space-y-4" data-assignment-question-workbench>
    <DashboardCommandPanel>
      <DashboardCommandState><span className="text-xs text-muted">{t("scope", { students: data.students.length, questions: data.questions.length })}</span><span className="text-xs text-muted">{t("paperHint")}</span></DashboardCommandState>
      <DashboardCommandActions>{data.canWrite && <Button size="sm" variant="secondary" onClick={() => setAdding(value => !value)} disabled={pending || data.questions.length >= 60}>{t("addQuestions")}</Button>}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => router.refresh()}>{t("reload")}</Button>
      </DashboardCommandActions>
    </DashboardCommandPanel>
    {message && <p role="status" className="text-xs text-muted">{message}</p>}
    {adding && data.canWrite && <DashboardSection title={t("addQuestions")}>
      <Label className="mb-1 block text-xs text-muted" htmlFor="homework-question-titles">{t("titlesHint")}</Label>
      <div className="flex items-end gap-3"><Textarea id="homework-question-titles" value={titles} onChange={event => setTitles(event.target.value)} rows={3} maxLength={6100} className="max-w-lg" disabled={pending} />
        <Button size="sm" disabled={pending || !titles.trim()} onClick={async () => {
          if (busy.current) return;
          busy.current = true; setPending(true); setMessage("");
          try {
            const result = await addAssignmentQuestionsAction({ assignmentId: data.assignment.id, titles: titles.split(/\r?\n/).map(value => value.trim()).filter(Boolean) });
            if (!result.ok) { failure(result.code); return; }
            setData(result.data); setTitles(""); setAdding(false); setQuestionId(current => current ?? result.data.questions[0]?.id ?? null); setUndo([]);
          } catch { failure("UNAVAILABLE"); }
          finally { busy.current = false; setPending(false); }
        }}>{t("saveQuestions")}</Button>
      </div>
    </DashboardSection>}
    <LearningCheckStatusLegend />
    {data.canWrite && data.questions.length > 0 && data.students.length > 0 && <DashboardSection title={t("entry")} description={t("entryHint")}>
      <LearningCheckMatrixEntry students={data.students.map(row => ({ id: row.id, label: row.name, data: row }))}
        questions={data.questions.map(row => ({ id: row.id, label: row.title, data: row }))} minimumSlots={0}
        orientation={orientation} onOrientationChange={setOrientation}
        activeStudentId={studentId} activeQuestionId={questionId} onActiveStudentChange={setStudentId} onActiveQuestionChange={setQuestionId}
        statusFor={(sid, qid) => results.get(assignmentQuestionKey(sid, qid))?.status ?? "unchecked"} isCellPending={() => pending}
        onStatusChange={(cell, status) => {
          const key = assignmentQuestionKey(cell.student.id, cell.question.id); const old = results.get(key);
          void save([{ studentId: cell.student.id, questionId: cell.question.id, status, expectedVersion: old?.version ?? 0, note: notes[key] ?? old?.note ?? "" }]);
        }}
        fill={{ pending, canUndo: undo.length > 0, labels: count => ({
          rail: ts(orientation === "by-student" ? "learningQuestionFillRail" : "learningFillRail"),
          remaining: ts(orientation === "by-student" ? "learningQuestionFillRemaining" : "learningFillRemaining", { count }),
          complete: ts(orientation === "by-student" ? "learningQuestionFillComplete" : "learningFillComplete"),
          action: status => ts(orientation === "by-student" ? "learningQuestionFillAction" : "learningFillAction", { count, status }),
          undo: t("undo"),
        }), onUndo: () => { void save(undo, true); }, onFill: (cells, status) => {
          void save(cells.map(cell => { const key = assignmentQuestionKey(cell.student.id, cell.question.id); const old = results.get(key); return { studentId: cell.student.id, questionId: cell.question.id, status, note: notes[key] ?? old?.note ?? "", expectedVersion: old?.version ?? 0 }; }));
        } }}
      />
      <div className="mt-3 flex items-end gap-3"><div className="min-w-0 flex-1">
        <Label htmlFor="homework-question-note" className="text-xs text-muted">{t("note", { student: data.students.find(row => row.id === studentId)?.name ?? "", question: data.questions.find(row => row.id === questionId)?.title ?? "" })}</Label>
        <Textarea id="homework-question-note" rows={2} value={note} maxLength={2000} disabled={pending} onChange={event => setNotes(current => ({ ...current, [activeKey]: event.target.value }))} />
      </div><Button size="sm" variant="secondary" disabled={pending || note === (activeResult?.note ?? "")} onClick={() => { if (studentId && questionId) void save([{ studentId, questionId, status: activeResult?.status ?? "unchecked", note, expectedVersion: activeResult?.version ?? 0 }]); }}>{t("saveNote")}</Button></div>
    </DashboardSection>}
    <DashboardSection title={t("overview")}><AssignmentQuestionSummary data={data} /></DashboardSection>
  </div>;
}
