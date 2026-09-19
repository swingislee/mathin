"use client";

import { useState } from "react";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import { studentStageMessages } from "./student-stage-messages";
import { planStudentRecontactAction } from "./student-recontact-actions";
import type { StudentStageAssignee, StudentStageRow } from "./student-stage-contract";

export function StudentRecontactPlan({ rows, assignees, currentUserId, canPlanOthers, locale, today, disabled, onBusyChange }: {
  rows: StudentStageRow[]; assignees: StudentStageAssignee[]; currentUserId: string; canPlanOthers: boolean;
  locale: string; today: string; disabled: boolean; onBusyChange: (value: boolean) => void;
}) {
  const m = studentStageMessages(locale), router = useRouter();
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [id, setId] = useState(newId), [date, setDate] = useState(today), [owner, setOwner] = useState(currentUserId);
  const [name, setName] = useState(m.recontactReasons[rows[0]?.recontactReason ?? "unreachable"]);
  const owners = canPlanOthers ? assignees : [{ userId: currentUserId, displayName: m.planMine }];
  const changed = () => { setId(newId()); setError(""); };
  const save = async () => {
    if (pending || disabled || !rows.length || rows.some(row => !row.leadId)) return;
    setPending(true); onBusyChange(true); setError("");
    try {
      const result = await planStudentRecontactAction({ id, name: name.trim(), date, ownerId: owner,
        subjects: rows.map(row => ({ studentId: row.studentId, leadId: row.leadId!, expectedOwnerId: row.ownerId })) });
      if (!result.ok) { setError(["RECONTACT_CHANGED", "ASSIGNMENT_CONFLICT", "REQUEST_CONFLICT"].includes(result.code) ? m.planChanged : m.planFailed); return; }
      setOpen(false);
      router.push(`/dashboard/communication?${new URLSearchParams({ view: "worklist", worklist: result.data.id, date, scope: "mine", pageSize: "50" })}`);
    } catch { setError(m.planFailed); }
    finally { setPending(false); onBusyChange(false); }
  };
  return <Popover open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
    <PopoverTrigger asChild><Button type="button" size="sm" disabled={disabled || !rows.length}><ListPlus className="size-4" />{m.planContact} · {rows.length}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 space-y-3">
      <p className="text-xs text-muted">{m.planHint}</p>
      <Label className="grid gap-1 text-xs">{m.planPurpose}<Input value={name} maxLength={100} disabled={pending} onChange={event => { setName(event.target.value); changed(); }} /></Label>
      <Label className="grid gap-1 text-xs">{m.planDate}<DateTimePicker value={date} onValueChange={value => { setDate(value); changed(); }} disabled={pending} /></Label>
      <Label className="grid gap-1 text-xs">{m.planOwner}<Select value={owner} onValueChange={value => { setOwner(value); changed(); }} disabled={pending}>
        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{owners.map(person => <SelectItem key={person.userId} value={person.userId}>{person.displayName}</SelectItem>)}</SelectContent>
      </Select></Label>
      {error ? <p role="alert" className="text-xs text-rose">{error}</p> : null}
      <Button type="button" size="sm" className="w-full" onClick={save} disabled={pending || !name.trim() || !date || date < today || !owners.some(person => person.userId === owner)}>{pending ? m.planning : m.planSave}</Button>
    </PopoverContent>
  </Popover>;
}
