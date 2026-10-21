"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { newId } from "@/lib/uuid";
import { readPostclassLearning, savePostclassLearning } from "./postclass-learning-actions";
import { postclassLearningChanges, type PostclassLearning } from "./postclass-learning-contract";
import { LearningCheckMatrixEntry, type LearningCheckMatrixOrientation } from "./LearningCheckMatrixEntry";
import { DashboardCommandActions, DashboardCommandPanel } from "./dashboard-page";

export function PostclassLearningEditor({ sessionId, disabled, onSaved, trigger, className, beforeOpen, openInitially = false, onClose, view = "all" }: {
  sessionId: string; disabled?: boolean; onSaved: (data: PostclassLearning) => void;
  trigger?: ReactNode; className?: string; beforeOpen?: () => boolean;
  openInitially?: boolean; onClose?: () => void; view?: "learning" | "all";
}) {
  const en = useLocale() === "en";
  const reviewT = useTranslations("school.reviews");
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<PostclassLearning | null>(null);
  const [draft, setDraft] = useState<PostclassLearning | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const openedInitially = useRef(false);
  const [message, setMessage] = useState("");
  const [orientation, setOrientation] = useState<LearningCheckMatrixOrientation>("by-student");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [studentFilter, setStudentFilter] = useState("all");
  const title = view === "learning" ? (en ? "Learning records" : "学情") : (en ? "Edit learning records" : "补录／修订学情");
  const failed = en ? "Could not save. Your changes are retained." : "保存失败，已保留填写内容。";
  const dirty = Boolean(initial && draft && JSON.stringify(initial) !== JSON.stringify(draft));
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await readPostclassLearning(sessionId);
      if (!result.ok) { setMessage(en ? "Unable to load learning records." : "学情读取失败，请重试。"); return; }
      setInitial(result.data); setDraft(result.data); setStudentId(result.data.students[0]?.id ?? null); setCheckId(result.data.checks[0]?.id ?? null);
    } catch { setMessage(en ? "Unable to load learning records." : "学情读取失败，请重试。"); }
    finally { setPending(false); busy.current = false; }
  }, [en, sessionId]);
  useEffect(() => {
    if (openInitially && !openedInitially.current) { openedInitially.current = true; setOpen(true); void load(); }
  }, [openInitially, load]);
  const close = () => { setOpen(false); onClose?.(); };
  async function save() {
    if (!draft || !initial || busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await savePostclassLearning({ sessionId, revision: initial.revision, checks: draft.checks, ...postclassLearningChanges(initial, draft) });
      if (!result.ok) { setMessage(result.code === "CONFLICT" ? (en ? "Records changed elsewhere. Close and reopen to load the latest version; your draft remains here until discarded." : "记录已被其他操作更新。请核对本次草稿，关闭后重新读取最新记录再修订。") : failed); return; }
      setInitial(result.data); setDraft(result.data); onSaved(result.data); setMessage(en ? "Learning records saved." : "学情修订已保存。");
    } catch { setMessage(failed); }
    finally { setPending(false); busy.current = false; }
  }
  const review = draft?.reviews.find(row => row.studentId === studentId);
  return <>
    {!openInitially && <Button size="sm" variant="secondary" disabled={disabled} className={className} title={title} aria-label={title}
      onClick={event => { event.stopPropagation(); if (beforeOpen && !beforeOpen()) return; setOpen(true); void load(); }}>{trigger ?? title}</Button>}
    <Dialog open={open} onOpenChange={value => { if (!pending && !dirty) { if (value) setOpen(true); else close(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted">{view === "learning"
          ? (en ? "Record the whole class or select one student. Only changed observations are saved; attendance is kept separately." : "可记录整班，也可选择一名学生单独记录。只保存实际修改的学情，考勤保持独立。")
          : (en ? "Add or rename checkpoints, correct observations and teacher feedback. Saved amendments retain the previous records." : "可补充或更名检查点、更正逐生学情与教师课评；保存时保留修订前后的记录。")}</p>
        <DashboardCommandPanel><DashboardCommandActions>
          {draft && <Button size="sm" disabled={pending || draft.checks.length >= 30} variant="secondary" onClick={() => {
            const id = newId(); setDraft({ ...draft, checks: [...draft.checks, { id, title: `${en ? "Checkpoint" : "检查点"} ${draft.checks.length + 1}`, position: draft.checks.length }] }); setCheckId(id);
          }}>{en ? "Add checkpoint" : "补充检查点"}</Button>}
          <Button size="sm" disabled={pending || !dirty} onClick={() => void save()}>{en ? "Save amendments" : "保存修订"}</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(initial); close(); }}>{dirty ? (en ? "Discard changes and close" : "放弃本次修改并关闭") : (en ? "Close" : "关闭")}</Button>
        </DashboardCommandActions></DashboardCommandPanel>
        {message && <p role="status" className="text-xs">{message}</p>}
        {!draft && !pending && <Button onClick={() => void load()}>{en ? "Retry" : "重试"}</Button>}
        {draft && <>
          <div className="grid gap-2 sm:grid-cols-3">{draft.checks.map(check => <Label key={check.id} className="grid gap-1 text-xs">{check.position + 1}
            <Input value={check.title} maxLength={100} disabled={pending} onChange={event => setDraft({ ...draft, checks: draft.checks.map(row => row.id === check.id ? { ...row, title: event.target.value } : row) })} />
          </Label>)}</div>
          <Label className="flex items-center gap-3 text-xs">{en ? "Students shown" : "显示学生"}<Select value={studentFilter} disabled={pending} onValueChange={value => {
            setStudentFilter(value); setStudentId(value === "all" ? draft.students[0]?.id ?? null : value);
          }}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">{en ? "All students" : "全部学生"}</SelectItem>
            {draft.students.map(student => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}
          </SelectContent></Select></Label>
          <LearningCheckMatrixEntry students={draft.students.filter(row => studentFilter === "all" || row.id === studentFilter).map(row => ({ id: row.id, label: row.name, data: row }))}
            questions={draft.checks.map(row => ({ id: row.id, label: row.title, data: row }))} minimumSlots={0}
            orientation={orientation} onOrientationChange={setOrientation} activeStudentId={studentId} activeQuestionId={checkId}
            onActiveStudentChange={setStudentId} onActiveQuestionChange={setCheckId}
            statusFor={(sid, cid) => draft.results.find(row => row.studentId === sid && row.checkId === cid)?.status ?? "unchecked"}
            isCellPending={() => pending} onStatusChange={(cell, status) => setDraft({ ...draft, results: [
              ...draft.results.filter(row => row.studentId !== cell.student.id || row.checkId !== cell.question.id),
              { studentId: cell.student.id, checkId: cell.question.id, status },
            ] })} />
          {view === "all" && review && <div className="space-y-3">
            <div className="flex items-center gap-3"><Select value={studentId ?? ""} onValueChange={setStudentId} disabled={pending}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>
              {draft.students.map(student => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}
            </SelectContent></Select><p className="text-sm font-medium">{en ? "Teacher feedback" : "教师课评"}</p></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{(["entryScore", "exitScore", "focus", "participation", "mastery"] as const).map(field => <Label key={field} className="grid gap-1 text-xs">
              {reviewT(field === "entryScore" ? "entry" : field === "exitScore" ? "exit" : field)}
              <Input type="number" min={field.endsWith("Score") ? 0 : 1} max={field.endsWith("Score") ? 100 : 5} step={field.endsWith("Score") ? 0.1 : 1} value={review[field] ?? ""} disabled={pending}
                onChange={event => setDraft({ ...draft, reviews: draft.reviews.map(row => row.studentId === studentId ? { ...row, [field]: event.target.value === "" ? null : Number(event.target.value) } : row) })} />
            </Label>)}</div>
            <Label className="grid gap-1 text-xs">{en ? "Comment" : "学情评语"}<Textarea value={review.comment} maxLength={2000} disabled={pending}
              onChange={event => setDraft({ ...draft, reviews: draft.reviews.map(row => row.studentId === studentId ? { ...row, comment: event.target.value } : row) })} /></Label>
          </div>}
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
