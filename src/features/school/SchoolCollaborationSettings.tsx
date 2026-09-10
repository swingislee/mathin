"use client";

import { useState, useTransition } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardPage, DashboardCommandPanel, DashboardCommandActions, DashboardSection, DashboardTableShell } from "./dashboard-page";
import { schoolCollaborationMessages, SCHOOL_BUSINESS_ROLES, type SchoolBusinessRole, type SchoolCollaborationSettings as Settings } from "./school-collaboration-contract";
import { saveSchoolCollaborationAction } from "./actions/school-collaboration";

export function SchoolCollaborationSettings({ initial, locale }: { initial: Settings; locale: string }) {
  const m = schoolCollaborationMessages(locale), router = useRouter();
  const [settings, setSettings] = useState(initial), [pending, start] = useTransition();
  const [message, setMessage] = useState(""), [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null);
  const save = (input: Parameters<typeof saveSchoolCollaborationAction>[0]) => start(async () => {
    setMessage("");
    const result = await saveSchoolCollaborationAction(input);
    if (!result.ok) { setMessage(m.error); return; }
    setSettings(result.data.settings); setEditing(null); setMessage(m.saved); router.refresh();
  });
  return <DashboardPage title={m.title} density="compact" summary={<p className="text-sm text-muted">{m.description} {m.sourceHint}</p>}
    commandPanel={<DashboardCommandPanel><DashboardCommandActions>
      <Link href="/dashboard/students" className="text-sm text-muted">{m.back}</Link>
      {settings.canManage ? <Button size="sm" onClick={() => setEditing({ id: null, name: "" })}>{m.add}</Button> : null}
    </DashboardCommandActions></DashboardCommandPanel>}>
    <p role="status" className="text-sm text-muted">{message}</p>
    <DashboardSection title={m.title}><DashboardTableShell><Table><TableHeader><TableRow>
      <TableHead>{m.name}</TableHead><TableHead>{m.members}</TableHead>{settings.canManage ? <TableHead /> : null}
    </TableRow></TableHeader><TableBody>{settings.groups.map(group => <TableRow key={group.id}>
      <TableCell>{group.name}</TableCell><TableCell>{group.memberIds.length}</TableCell>
      {settings.canManage ? <TableCell><Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing({ id: group.id, name: group.name })}>{m.rename}</Button></TableCell> : null}
    </TableRow>)}</TableBody></Table></DashboardTableShell>{!settings.groups.length ? <p className="text-sm text-muted">{m.empty}</p> : null}</DashboardSection>
    {settings.canManage ? <DashboardSection title={m.staff}><p className="text-sm text-muted">{m.memberHint}</p>
      <DashboardTableShell><Table><TableHeader><TableRow><TableHead>{m.staff}</TableHead><TableHead>{m.role}</TableHead>{settings.groups.map(group => <TableHead key={group.id}>{group.name}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{settings.staff.map(staff => <TableRow key={staff.id}><TableCell>{staff.name}</TableCell><TableCell>
          <Select value={staff.role ?? ""} disabled={pending} onValueChange={role => save({ kind: "role", userId: staff.id, role: role as SchoolBusinessRole })}>
            <SelectTrigger aria-label={`${staff.name} · ${m.role}`} className="w-48"><SelectValue placeholder={m.choose} /></SelectTrigger><SelectContent>{SCHOOL_BUSINESS_ROLES.map(role => <SelectItem key={role} value={role}>{m.roles[role]}</SelectItem>)}</SelectContent>
          </Select></TableCell>{settings.groups.map(group => <TableCell key={group.id}><Checkbox aria-label={`${staff.name} · ${group.name}`} disabled={pending}
            checked={group.memberIds.includes(staff.id)} onCheckedChange={active => save({ kind: "member", userId: staff.id, groupId: group.id, active: active === true })} /></TableCell>)}</TableRow>)}</TableBody>
      </Table></DashboardTableShell></DashboardSection> : null}
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open && !pending) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>{editing?.id ? m.rename : m.add}</DialogTitle></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); if (editing) save({ kind: "group", ...editing }); }}>
        <Label htmlFor="school-group-name">{m.name}</Label><Input id="school-group-name" value={editing?.name ?? ""} maxLength={80} disabled={pending} autoFocus
          onChange={event => setEditing(current => current ? { ...current, name: event.target.value } : null)} />
        <DialogFooter className="mt-4"><Button type="button" variant="ghost" disabled={pending} onClick={() => setEditing(null)}>{m.cancel}</Button>
          <Button type="submit" disabled={pending || !editing?.name.trim()}>{pending ? m.saving : m.save}</Button></DialogFooter>
      </form></DialogContent></Dialog>
  </DashboardPage>;
}
