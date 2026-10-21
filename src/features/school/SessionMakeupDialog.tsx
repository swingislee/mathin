"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { newId } from "@/lib/uuid";
import { ATTENDANCE_STATUSES } from "./learning";
import { LearningCheckMatrixEntry, type LearningCheckMatrixOrientation } from "./LearningCheckMatrixEntry";
import { readSessionMakeups, saveSessionMakeup } from "./session-makeup-actions";
import { type MakeupRecord, type SessionMakeups } from "./session-makeup-contract";

function localDateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
}

export function SessionMakeupDialog({ sessionId, sessionTitle, onClose }: {
  sessionId: string; sessionTitle: string; onClose: () => void;
}) {
  const locale = useLocale();
  const en = locale.startsWith("en");
  const t = useTranslations("school.classes");
  const [data, setData] = useState<SessionMakeups | null>(null);
  const [draft, setDraft] = useState<MakeupRecord | null>(null);
  const [initial, setInitial] = useState<MakeupRecord | null>(null);
  const [pending, setPending] = useState(true);
  const [message, setMessage] = useState("");
  const [orientation, setOrientation] = useState<LearningCheckMatrixOrientation>("by-student");
  const [activeStudent, setActiveStudent] = useState<string | null>(null);
  const [activeCheck, setActiveCheck] = useState<string | null>(null);
  const busy = useRef(false);
  const initiallyLoaded = useRef(false);
  const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(initial));
  const makeNew = useCallback((value: SessionMakeups): MakeupRecord => ({
    id: newId(), revision: 0, recordedBy: "", updatedAt: "", scheduledAt: new Date().toISOString(), durationMin: 45, status: "planned", note: "",
    checks: value.checks.length ? value.checks : [{ id: newId(), title: en ? "Makeup learning" : "补课内容" }],
    students: value.students.filter(student => student.attendance === "absent" || student.attendance === "leave")
      .map(student => ({ studentId: student.id, name: student.name, attendance: null, note: "", results: [] })),
  }), [en]);
  const selectRecord = (record: MakeupRecord) => {
    if (dirty) { setMessage(en ? "Save or discard the current changes first." : "请先保存或放弃当前修改，再切换记录。"); return; }
    setDraft(record); setInitial(record); setMessage(""); setActiveStudent(record.students[0]?.studentId ?? null); setActiveCheck(record.checks[0]?.id ?? null);
  };
  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await readSessionMakeups(sessionId);
      if (!result.ok) { setMessage(en ? "Unable to load makeup records." : "补课记录读取失败，请重试。"); return; }
      const record = result.data.records[0] ?? makeNew(result.data);
      setData(result.data); setDraft(record); setInitial(record);
      setActiveStudent(record.students[0]?.studentId ?? null); setActiveCheck(record.checks[0]?.id ?? null);
    } catch { setMessage(en ? "Unable to load makeup records." : "补课记录读取失败，请重试。"); }
    finally { setPending(false); busy.current = false; }
  }, [en, makeNew, sessionId]);
  useEffect(() => {
    if (!initiallyLoaded.current) { initiallyLoaded.current = true; void load(); }
  }, [load]);
  async function save() {
    if (!draft || busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await saveSessionMakeup({ id: draft.id, sessionId, revision: draft.revision, record: draft });
      if (!result.ok) {
        setMessage(result.code === "CONFLICT"
          ? (en ? "This record changed elsewhere. Your draft is retained; reopen to read the latest record." : "记录已被其他操作更新；本次填写仍保留，请核对后重新打开最新记录。")
          : (en ? "Could not save. Check the students, time and checkpoint titles. Your draft is retained." : "保存失败，请核对学生、时间和检查点名称；填写内容已保留。"));
        return;
      }
      const record = result.data.records.find(row => row.id === draft.id);
      if (!record) throw new Error("MAKEUP_RECEIPT_MISSING");
      setData(result.data); setDraft(record); setInitial(record); setMessage(en ? "Makeup record saved." : "补课记录已保存。");
    } catch { setMessage(en ? "Could not save. Your draft is retained." : "保存失败，填写内容已保留。"); }
    finally { setPending(false); busy.current = false; }
  }
  const availableStudents = [...new Map([
    ...(draft?.students ?? []).map(student => ({ id: student.studentId, name: student.name, attendance: null })),
    ...(data?.students ?? []),
  ].map(student => [student.id, student])).values()];
  return <Dialog open onOpenChange={open => { if (!open && !pending) {
    if (dirty) setMessage(en ? "Save or discard your changes before closing." : "请保存修改，或使用下方“放弃修改并关闭”。"); else onClose();
  } }}>
    <DialogContent className="max-h-[90dvh] sm:max-w-5xl">
      <DialogHeader><DialogTitle>{en ? "Makeup lesson" : "补课"} · {sessionTitle}</DialogTitle></DialogHeader>
      <p className="text-xs text-muted">{en ? "Choose students and record this makeup lesson here. The original lesson's attendance and learning records are kept." : "选择学生，在这里保存补课安排、考勤和学情。原课的缺勤与学情记录保留。"}</p>
      {message && <p role="status" className="text-sm">{message}</p>}
      {!data && (pending ? <p role="status" className="text-sm text-muted">{en ? "Loading…" : "正在读取…"}</p>
        : <Button onClick={() => { setPending(true); setMessage(""); void load(); }}>{en ? "Retry" : "重试"}</Button>)}
      {data && draft && <fieldset disabled={pending} className="min-w-0 space-y-5">
        <div className="flex flex-wrap gap-2" aria-label={en ? "Makeup records" : "补课记录"}>
          {data.records.map(record => <Button key={record.id} size="sm" variant={draft.id === record.id ? "secondary" : "ghost"}
            aria-pressed={draft.id === record.id} onClick={() => selectRecord(record)}>
            {new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(record.scheduledAt))}
            {" · "}{record.status === "completed" ? (en ? "Completed" : "已补课") : (en ? "Planned" : "待补课")}{" · "}{record.students.length}{en ? " students" : "人"}
          </Button>)}
          <Button size="sm" variant={draft.revision === 0 ? "secondary" : "ghost"} onClick={() => selectRecord(makeNew(data))}>{en ? "New makeup" : "新增补课"}</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr_1fr]">
          <Label className="grid gap-1 text-xs">{en ? "Time (local)" : "补课时间"}<Input type="datetime-local" value={localDateTime(draft.scheduledAt)}
            onChange={event => setDraft({ ...draft, scheduledAt: Number.isFinite(Date.parse(event.target.value)) ? new Date(event.target.value).toISOString() : "" })} /></Label>
          <Label className="grid gap-1 text-xs">{en ? "Duration (minutes)" : "时长（分钟）"}<Input type="number" min={1} max={480} value={draft.durationMin}
            onChange={event => setDraft({ ...draft, durationMin: Number(event.target.value) })} /></Label>
          <Label className="grid gap-1 text-xs">{en ? "Status" : "补课状态"}<Select value={draft.status} disabled={pending}
            onValueChange={value => setDraft({ ...draft, status: value as MakeupRecord["status"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="planned">{en ? "Planned" : "待补课"}</SelectItem><SelectItem value="completed">{en ? "Completed" : "已补课"}</SelectItem>
            </SelectContent></Select></Label>
        </div>
        <div className="space-y-2"><p className="text-sm font-medium">{en ? "Students" : "补课学生"}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-3">{availableStudents.map(student => <Label key={student.id} className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.students.some(row => row.studentId === student.id)} onChange={event => {
              setDraft({ ...draft, students: event.target.checked
                ? [...draft.students, { studentId: student.id, name: student.name, attendance: null, note: "", results: [] }]
                : draft.students.filter(row => row.studentId !== student.id) });
            }} />{student.name}{student.attendance && <span className="text-xs text-muted">{t(student.attendance)}</span>}
          </Label>)}</div>
          {!draft.students.length && <p className="text-xs text-muted">{en ? "Select at least one student." : "请选择一名或多名学生。"}</p>}
        </div>
        {draft.students.length > 0 && <div className="divide-y divide-line border-y border-line">{draft.students.map(student => <div key={student.studentId} className="flex flex-wrap items-center gap-3 py-2">
          <span className="w-28 text-sm font-medium">{student.name}</span><Label className="text-xs">{en ? "Makeup attendance" : "补课考勤"}</Label>
          <Select value={student.attendance ?? "unmarked"} disabled={pending} onValueChange={value => setDraft({ ...draft, students: draft.students.map(row => row.studentId === student.studentId
            ? { ...row, attendance: value === "unmarked" ? null : value as typeof row.attendance } : row) })}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unmarked">{en ? "Not marked" : "未登记"}</SelectItem>
              {ATTENDANCE_STATUSES.map(status => <SelectItem key={status} value={status}>{t(status)}</SelectItem>)}
            </SelectContent></Select>
          <Input className="min-w-40 flex-1" aria-label={(en ? "Note for " : "补课备注 · ") + student.name} placeholder={en ? "Student note (optional)" : "这名学生的补课备注（选填）"}
            value={student.note} maxLength={1000} onChange={event => setDraft({ ...draft, students: draft.students.map(row => row.studentId === student.studentId ? { ...row, note: event.target.value } : row) })} />
        </div>)}</div>}
        <div className="space-y-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{en ? "Makeup learning" : "补课学情"}</p>
          <Button size="sm" variant="secondary" disabled={pending || draft.checks.length >= 30} onClick={() => {
            const id = newId(); setDraft({ ...draft, checks: [...draft.checks, { id, title: `${en ? "Checkpoint" : "检查点"} ${draft.checks.length + 1}` }] }); setActiveCheck(id);
          }}>{en ? "Add checkpoint" : "补充检查点"}</Button></div>
          <div className="grid gap-2 sm:grid-cols-3">{draft.checks.map((check, index) => <Label key={check.id} className="grid gap-1 text-xs">{index + 1}<Input value={check.title} maxLength={100}
            onChange={event => setDraft({ ...draft, checks: draft.checks.map(row => row.id === check.id ? { ...row, title: event.target.value } : row) })} /></Label>)}</div>
          {draft.students.length > 0 && <LearningCheckMatrixEntry
            students={draft.students.map(student => ({ id: student.studentId, label: student.name, data: student }))}
            questions={draft.checks.map(check => ({ id: check.id, label: check.title, data: check }))} minimumSlots={0}
            orientation={orientation} onOrientationChange={setOrientation} activeStudentId={activeStudent} activeQuestionId={activeCheck}
            onActiveStudentChange={setActiveStudent} onActiveQuestionChange={setActiveCheck} isCellPending={() => pending}
            statusFor={(studentId, checkId) => draft.students.find(student => student.studentId === studentId)?.results.find(result => result.checkId === checkId)?.status ?? "unchecked"}
            onStatusChange={(cell, status) => setDraft({ ...draft, students: draft.students.map(student => student.studentId === cell.student.id
              ? { ...student, results: [...student.results.filter(result => result.checkId !== cell.question.id), { checkId: cell.question.id, status }] } : student) })} />}
        </div>
        <Label className="grid gap-1 text-xs">{en ? "Makeup note (optional)" : "补课说明（选填）"}<Textarea rows={2} value={draft.note} maxLength={2000}
          onChange={event => setDraft({ ...draft, note: event.target.value })} /></Label>
        {draft.recordedBy && <p className="text-xs text-muted">{en ? "Recorded by " : "登记老师："}{draft.recordedBy}</p>}
      </fieldset>}
      <DialogFooter>
        <Button variant="ghost" disabled={pending} onClick={onClose}>{dirty ? (en ? "Discard and close" : "放弃修改并关闭") : (en ? "Close" : "关闭")}</Button>
        {dirty && <Button variant="secondary" disabled={pending} onClick={() => { setDraft(initial); setMessage(""); }}>{en ? "Discard changes" : "放弃修改"}</Button>}
        <Button disabled={pending || !draft?.students.length || (!dirty && draft.revision > 0) || !Number.isFinite(Date.parse(draft?.scheduledAt ?? ""))
          || !draft?.checks.every(check => check.title.trim()) || !draft?.durationMin} onClick={() => void save()}>{pending ? (en ? "Saving…" : "处理中…") : (en ? "Save makeup record" : "保存补课记录")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
