"use client";

import { useState, useTransition } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { schoolCollaborationMessages, type SchoolCollaborationSettings, type SchoolBusinessRole } from "./school-collaboration-contract";
import type { StudentStageRow } from "./student-stage-contract";
import { saveSchoolCollaborationAction } from "./actions/school-collaboration";

export function SchoolCollaboratorControl({ row, settings, locale, disabled, onSaved }: {
  row: StudentStageRow; settings: SchoolCollaborationSettings; locale: string; disabled?: boolean; onSaved: (row: StudentStageRow) => void;
}) {
  const m = schoolCollaborationMessages(locale);
  const [open, setOpen] = useState(false), [pending, start] = useTransition(), [error, setError] = useState("");
  const [userId, setUserId] = useState("none"), [groupId, setGroupId] = useState("none"), [role, setRole] = useState<SchoolBusinessRole | "participant">("school_support");
  if (!settings.canManage) return null;
  return <Dialog open={open} onOpenChange={value => { if (!pending) { setOpen(value); setError(""); } }}><DialogTrigger asChild>
    <Button variant="ghost" size="sm" className="size-7 shrink-0 p-0" disabled={disabled} aria-label={`${row.name} · ${m.collaborate}`} title={m.collaborate}><Users className="size-3.5" /></Button>
  </DialogTrigger><DialogContent><DialogHeader><DialogTitle>{row.name} · {m.collaborate}</DialogTitle><DialogDescription>{m.collaborateHint}</DialogDescription></DialogHeader>
    <div className="space-y-1 text-sm">{row.participants?.map(person => <p key={`${person.userId}:${person.role}`}>{person.name} · {m.roles[person.role]}</p>)}
      {row.groups?.length ? <p className="text-muted">{row.groups.map(group => group.name).join("、")}</p> : null}</div>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); start(async () => {
      const result = await saveSchoolCollaborationAction({ kind: "participant", studentId: row.studentId, leadId: row.studentId ? null : row.leadId,
        userId: userId === "none" ? null : userId, groupId: groupId === "none" ? null : groupId, role });
      if (!result.ok) { setError(m.error); return; }
      if (result.data.subject) onSaved(result.data.subject);
      setOpen(false); setUserId("none"); setGroupId("none");
    }); }}>
      <div><Label>{m.collaborator}</Label><Select value={userId} disabled={pending} onValueChange={value => {
        setUserId(value); const person = settings.staff.find(staff => staff.id === value); if (person?.role) setRole(person.role);
      }}><SelectTrigger aria-label={m.collaborator}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{m.choose}</SelectItem>
        {settings.staff.map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></div>
      {userId !== "none" ? <div><Label>{m.role}</Label><Select value={role} disabled={pending} onValueChange={value => setRole(value as typeof role)}>
        <SelectTrigger aria-label={m.role}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(m.roles).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div> : null}
      <div><Label>{m.title}</Label><Select value={groupId} disabled={pending} onValueChange={setGroupId}><SelectTrigger aria-label={m.title}><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="none">{m.choose}</SelectItem>{settings.groups.map(group => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{m.cancel}</Button>
        <Button type="submit" disabled={pending || userId === "none" && groupId === "none"}>{pending ? m.saving : m.save}</Button></DialogFooter>
    </form></DialogContent></Dialog>;
}
