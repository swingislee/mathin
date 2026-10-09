"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { assignStudentStageAction } from "./student-stage-actions";
import { studentStageMessages } from "./student-stage-messages";
import type { StudentStageAssignee, StudentStageAssignment, StudentStageRow } from "./student-stage-contract";

type AssignmentProps = {
  rows: StudentStageRow[]; assignees: StudentStageAssignee[]; locale: string; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onAssigned: (result: StudentStageAssignment[]) => void;
  context?: "lead";
};

function assignmentMessages(locale: string, context?: "lead") {
  const m = studentStageMessages(locale);
  if (context !== "lead") return m;
  return { ...m, ...(locale.startsWith("en") ? {
    owner: "Owner", unassigned: "Assign owner", chooseOwner: "Choose owner", assigned: "Owner assigned",
    assignmentConflict: "The owner or profile has changed. Refresh the list before assigning.",
    assigneeUnavailable: "This staff member cannot receive follow-ups. Choose another owner.",
  } : {
    owner: "负责人", unassigned: "分配负责人", chooseOwner: "选择负责人", assigned: "负责人已分配",
    assignmentConflict: "负责人或档案已有变化，请刷新名单后分配。",
    assigneeUnavailable: "该员工暂时不能接收跟进，请重新选择负责人。",
  }) };
}

function useOwnerAssignment({ rows, locale, disabled, onBusyChange, onAssigned, context }: AssignmentProps) {
  const m = assignmentMessages(locale, context);
  const [pendingOwnerId, setPendingOwnerId] = useState("");
  const [error, setError] = useState("");
  const sending = useRef(false);
  const submit = async (staffUserId: string) => {
    if (sending.current || disabled || !staffUserId || !rows.length) return;
    sending.current = true; onBusyChange(true); setPendingOwnerId(staffUserId); setError("");
    try {
      const result = await assignStudentStageAction({ staffUserId, subjects: rows.map(row => ({ studentId: row.studentId, leadId: row.leadId, expectedOwnerId: row.ownerId })) });
      if (!result.ok) {
        setError(result.code === "ASSIGNMENT_CONFLICT" ? m.assignmentConflict : result.code === "TARGET_CANNOT_FOLLOW_UP" ? m.assigneeUnavailable : m.assignmentFailed);
        return;
      }
      toast.success(m.assigned); onAssigned(result.data);
    } catch { setError(m.assignmentFailed); }
    finally { sending.current = false; setPendingOwnerId(""); onBusyChange(false); }
  };
  return { m, error, pendingOwnerId, submit };
}

/** 行内和批量分配共用提交、权限检查与失败反馈。 */
export function StudentStageAssignmentControl(props: AssignmentProps) {
  const { rows, assignees, disabled } = props;
  const [staffUserId, setStaffUserId] = useState("");
  const { m, error, pendingOwnerId, submit } = useOwnerAssignment(props);
  return <div className="flex min-w-0 flex-wrap items-center gap-2" data-student-stage-assignment>
    <FollowupChoice presentation="select" value={staffUserId} onValueChange={setStaffUserId} disabled={disabled || Boolean(pendingOwnerId)}
      label={m.chooseOwner} className="w-40" options={assignees.map(member => ({ value: member.userId, label: member.displayName }))} />
    <Button size="sm" disabled={disabled || Boolean(pendingOwnerId) || !staffUserId || !rows.length} onClick={() => { void submit(staffUserId); }}>{m.assign}</Button>
    {error ? <p role="alert" className="w-full whitespace-normal text-xs text-rose">{error}</p> : null}
  </div>;
}

function LeadOwnerControl({ row, ...props }: Omit<AssignmentProps, "rows"> & { row: StudentStageRow }) {
  const [saved, setSaved] = useState<{ base: StudentStageRow; subject: StudentStageRow } | null>(null);
  const current = saved?.base === row ? saved.subject : row;
  const { m, error, pendingOwnerId, submit } = useOwnerAssignment({ ...props, rows: [current], onAssigned: result => {
    const subject = result.find(item => item.key === current.key)?.subject;
    if (subject) setSaved({ base: row, subject });
    props.onAssigned(result);
  } });
  return <div className="min-w-0" data-lead-owner-control onClick={event => event.stopPropagation()}>
    <div className="flex items-center gap-1" aria-busy={Boolean(pendingOwnerId)}>
      <select value={pendingOwnerId || current.ownerId || ""} aria-label={`${m.chooseOwner} · ${row.name}`}
        title={`${m.owner} · ${current.ownerName || m.unassigned}`} disabled={props.disabled || Boolean(pendingOwnerId)}
        onChange={event => { if (event.target.value !== current.ownerId) void submit(event.target.value); }}
        className={`h-8 w-full min-w-0 rounded-md border px-1 text-xs text-ink ${current.ownerId ? "border-line bg-card" : "border-crater/40 bg-moon/20"}`}>
        {!current.ownerId ? <option value="" disabled>{m.unassigned}</option> : null}
        {current.ownerId && !props.assignees.some(member => member.userId === current.ownerId) ? <option value={current.ownerId} disabled>{current.ownerName}</option> : null}
        {props.assignees.map(member => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
      </select>
      {pendingOwnerId ? <LoaderCircle className="size-3 shrink-0 animate-spin text-muted" aria-label={m.saving} /> : null}
    </div>
    {error ? <p role="alert" className="mt-1 whitespace-normal text-xs text-rose">{error}</p> : null}
  </div>;
}

export function StudentStageOwnerControl({ row, ...props }: Omit<AssignmentProps, "rows"> & { row: StudentStageRow }) {
  const [open, setOpen] = useState(false);
  const m = assignmentMessages(props.locale, props.context);
  if (props.context === "lead") return <LeadOwnerControl row={row} {...props} />;
  return <Popover open={open} onOpenChange={value => { if (!props.disabled) setOpen(value); }}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" disabled={props.disabled} aria-label={`${m.assign} · ${m.owner} · ${row.name}`}
      title={`${m.owner} · ${row.ownerName || m.unassigned}`}
      className="h-7 w-full min-w-0 justify-start gap-1 px-0 text-xs"><span className="truncate">{row.ownerName || m.unassigned}</span><ChevronDown className="size-3 shrink-0 text-muted" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-72 space-y-2 p-3"><p className="truncate text-xs font-medium">{row.name} · {m.owner}</p>
      <StudentStageAssignmentControl {...props} rows={[row]} onAssigned={result => { setOpen(false); props.onAssigned(result); }} />
    </PopoverContent>
  </Popover>;
}
