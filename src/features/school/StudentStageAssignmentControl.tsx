"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { assignStudentStageAction } from "./student-stage-actions";
import { studentStageMessages } from "./student-stage-messages";
import type { StudentStageAssignee, StudentStageAssignment, StudentStageRow } from "./student-stage-contract";

type AssignmentProps = {
  rows: StudentStageRow[]; assignees: StudentStageAssignee[]; locale: string; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onAssigned: (result: StudentStageAssignment[]) => void;
};

/** 行内和批量分配共用选人、提交与失败反馈。 */
export function StudentStageAssignmentControl({ rows, assignees, locale, disabled, onBusyChange, onAssigned }: AssignmentProps) {
  const m = studentStageMessages(locale);
  const [staffUserId, setStaffUserId] = useState("");
  const [error, setError] = useState("");
  const sending = useRef(false);
  const submit = async () => {
    if (sending.current || disabled || !staffUserId || !rows.length) return;
    sending.current = true; onBusyChange(true); setError("");
    try {
      const result = await assignStudentStageAction({ staffUserId, subjects: rows.map(row => ({ studentId: row.studentId, leadId: row.leadId, expectedOwnerId: row.ownerId })) });
      if (!result.ok) {
        setError(result.code === "ASSIGNMENT_CONFLICT" ? m.assignmentConflict : result.code === "TARGET_CANNOT_FOLLOW_UP" ? m.assigneeUnavailable : m.assignmentFailed);
        return;
      }
      toast.success(m.assigned); onAssigned(result.data);
    } catch { setError(m.assignmentFailed); }
    finally { sending.current = false; onBusyChange(false); }
  };
  return <div className="flex min-w-0 flex-wrap items-center gap-2" data-student-stage-assignment>
    <FollowupChoice presentation="select" value={staffUserId} onValueChange={setStaffUserId} disabled={disabled}
      label={m.chooseOwner} className="w-40" options={assignees.map(member => ({ value: member.userId, label: member.displayName }))} />
    <Button size="sm" disabled={disabled || !staffUserId || !rows.length} onClick={() => { void submit(); }}>{m.assign}</Button>
    {error ? <p role="alert" className="w-full whitespace-normal text-xs text-rose">{error}</p> : null}
  </div>;
}

export function StudentStageOwnerControl({ row, ...props }: Omit<AssignmentProps, "rows"> & { row: StudentStageRow }) {
  const [open, setOpen] = useState(false);
  const m = studentStageMessages(props.locale);
  return <Popover open={open} onOpenChange={value => { if (!props.disabled) setOpen(value); }}>
    <PopoverTrigger asChild><Button variant="ghost" size="sm" disabled={props.disabled} aria-label={`${m.assign} · ${row.name}`}
      className="h-7 w-full min-w-0 justify-start gap-1 px-0 text-xs"><span className="truncate">{row.ownerName || m.unassigned}</span><ChevronDown className="size-3 shrink-0 text-muted" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-72 space-y-2 p-3"><p className="truncate text-xs font-medium">{row.name} · {m.owner}</p>
      <StudentStageAssignmentControl {...props} rows={[row]} onAssigned={result => { setOpen(false); props.onAssigned(result); }} />
    </PopoverContent>
  </Popover>;
}
