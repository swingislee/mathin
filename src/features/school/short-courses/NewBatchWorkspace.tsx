"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { newId } from "@/lib/uuid";
import { useRouter } from "@/i18n/navigation";
import { DashboardCommandActions, DashboardCommandPanel, DashboardTableShell } from "../dashboard-page";
import type { StaffOption } from "../classes";
import type { SchoolTermRow } from "../courses";
import type { RoomOptionV2 } from "../organization-locations";
import { createShortCourseBatchAction, previewShortCourseBatchAction } from "./actions";
import { SHORT_COURSES_HREF, shortCourseDraftSchema, shortCourseLevelSchema, type ShortCourseDraft, type ShortCourseGroupDraft, type ShortCoursePreview } from "./contract";
import { shortCourseDraftKey } from "./schedule";
import { shortCourseMessages } from "./messages";

function Choice({ label, value, onChange, choices }: { label: string; value: string; onChange: (value: string) => void; choices: Array<{ value: string; label: string }> }) {
  return <div className="min-w-0 space-y-1"><Label className="text-xs text-muted">{label}</Label>
    <Select value={value || "__empty"} onValueChange={selected => onChange(selected === "__empty" ? "" : selected)}>
      <SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{choices.map(choice => <SelectItem key={choice.value || "__empty"} value={choice.value || "__empty"}>{choice.label}</SelectItem>)}</SelectContent>
    </Select></div>;
}

export function NewBatchWorkspace({ locale, userId, initial, teachers, rooms, terms, timeZone }: {
  locale: string; userId: string; initial: ShortCourseDraft; teachers: StaffOption[]; rooms: RoomOptionV2[]; terms: SchoolTermRow[]; timeZone: string;
}) {
  const m = shortCourseMessages(locale), router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [preview, setPreview] = useState<{ inputKey: string; data: ShortCoursePreview } | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [restored, setRestored] = useState(false);
  const draftLoaded = useRef(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const storageKey = `mathin:short-course-batch:${userId}`;
  const inputKey = shortCourseDraftKey(draft);
  const currentPreview = preview?.inputKey === inputKey ? preview.data : null;
  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        // Partially filled fields remain useful drafts. Validate the persisted
        // shape with placeholder UUIDs before restoring the original values.
        const saved = JSON.parse(raw) as ShortCourseDraft;
        const parsed = shortCourseDraftSchema.safeParse({ ...saved,
          topic: saved.topic || initial.topic, name: saved.name || "Draft", termId: saved.termId || initial.termId,
          startsOn: saved.startsOn || initial.startsOn,
          classes: saved.classes?.map(row => ({ ...row, name: row.name || "Class", teacherId: row.teacherId || initial.requestId })),
        });
        if (parsed.success) { setDraft(saved); setRestored(true); }
      }
    } catch { /* A missing/corrupt device draft never blocks creation. */ }
    draftLoaded.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey, initial]);
  useEffect(() => {
    if (!draftLoaded.current) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* Storage may be unavailable. */ }
  }, [draft, storageKey]);

  function change(next: ShortCourseDraft) {
    generation.current += 1;
    setDraft(next); setNotice("");
  }
  function updateClass(key: string, values: Partial<ShortCourseGroupDraft>) {
    change({ ...draft, classes: draft.classes.map(row => row.key === key ? { ...row, ...values } : row) });
  }
  function addClass(source?: ShortCourseGroupDraft) {
    const first = source ?? draft.classes.at(-1) ?? initial.classes[0];
    change({ ...draft, classes: [...draft.classes, { ...first, key: newId(), name: source ? source.name : "", plannedStudents: null,
      weeklySlots: first.weeklySlots.map(slot => ({ ...slot })) }] });
  }
  function errorMessage(code: string) {
    if (code === "VALIDATION") return m.validation;
    if (code === "REQUEST_ALREADY_SAVED") return m.savedRequest;
    if (code === "PREVIEW_CHANGED") return m.stale;
    if (code === "SCHEDULE_CONFLICT") return m.conflictHint;
    return m.error;
  }
  async function runPreview() {
    if (inFlight.current) return;
    const parsed = shortCourseDraftSchema.safeParse(draft);
    if (!parsed.success) { setNotice(m.validation); return; }
    inFlight.current = true; setPending(true); setNotice("");
    const version = generation.current;
    try {
      const result = await previewShortCourseBatchAction(parsed.data, locale);
      if (version !== generation.current) return;
      if (result.ok) setPreview({ inputKey, data: result.data }); else setNotice(errorMessage(result.code));
    } catch { if (version === generation.current) setNotice(m.calendarError); }
    finally { inFlight.current = false; setPending(false); }
  }
  async function save() {
    if (inFlight.current || !currentPreview) return;
    inFlight.current = true; setPending(true); setNotice("");
    try {
      const result = await createShortCourseBatchAction(draft, locale, currentPreview.scheduleKey);
      if (!result.ok) { setNotice(errorMessage(result.code)); if (result.code === "PREVIEW_CHANGED") setPreview(null); return; }
      try { sessionStorage.removeItem(storageKey); } catch { /* Navigation still succeeds. */ }
      router.push(`${SHORT_COURSES_HREF}?batch=${result.data.batchId}`);
      router.refresh();
    } catch { setNotice(m.error); }
    finally { inFlight.current = false; setPending(false); }
  }

  return <div className="space-y-5">
    <fieldset disabled={pending} className="space-y-5 disabled:opacity-80">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-xs text-muted">{m.topic}<Input value={draft.topic} maxLength={100} onChange={event => change({ ...draft, topic: event.target.value })} /></label>
        <label className="space-y-1 text-xs text-muted">{m.batchName}<Input value={draft.name} maxLength={100} onChange={event => change({ ...draft, name: event.target.value })} /></label>
        <div className="space-y-1"><Label className="text-xs text-muted">{m.startsOn}</Label><DateTimePicker aria-label={m.startsOn} value={draft.startsOn} onValueChange={startsOn => change({ ...draft, startsOn })} /></div>
        <Choice label={m.term} value={draft.termId} onChange={termId => change({ ...draft, termId })} choices={[{ value: "", label: m.unspecified }, ...terms.map(term => ({ value: term.id, label: term.name }))]} />
        <label className="space-y-1 text-xs text-muted">{m.lessons}<Input type="number" min={1} max={40} value={draft.sessionCount || ""} onChange={event => change({ ...draft, sessionCount: Number(event.target.value) })} /></label>
        <label className="space-y-1 text-xs text-muted">{m.duration}<Input type="number" min={1} max={600} value={draft.durationMin || ""} onChange={event => change({ ...draft, durationMin: Number(event.target.value) })} /></label>
      </div>
      <div className="divide-y divide-line border-y border-line">
        {draft.classes.map((row, index) => <section key={row.key} className="py-4">
          <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm font-medium">{index + 1}. {row.name || m.name}</span>
            <div className="flex gap-1"><Button type="button" size="sm" variant="ghost" disabled={draft.classes.length >= 30} aria-label={m.copyClass} title={m.copyClass} onClick={() => addClass(row)}><Copy className="size-4" /></Button>
              <Button type="button" size="sm" variant="ghost" disabled={draft.classes.length === 1} aria-label={m.remove} title={m.remove} onClick={() => change({ ...draft, classes: draft.classes.filter(value => value.key !== row.key) })}><Trash2 className="size-4" /></Button></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-xs text-muted">{m.name}<Input value={row.name} maxLength={100} onChange={event => updateClass(row.key, { name: event.target.value })} /></label>
            <Choice label={m.level} value={row.level} onChange={value => updateClass(row.key, { level: shortCourseLevelSchema.parse(value) })} choices={shortCourseLevelSchema.options.map(level => ({ value: level, label: m[level] }))} />
            <label className="space-y-1 text-xs text-muted">{m.grades}<Input defaultValue={row.grades.join(", ")} placeholder={m.gradesHint} onBlur={event => {
              const value = event.target.value.trim();
              updateClass(row.key, { grades: value ? [...new Set(value.split(/[,，\s]+/).map(Number))] : [] });
            }} /></label>
            <Choice label={m.teacher} value={row.teacherId} onChange={teacherId => updateClass(row.key, { teacherId })} choices={[{ value: "", label: m.chooseTeacher }, ...teachers.map(teacher => ({ value: teacher.id, label: teacher.name }))]} />
            <Choice label={m.room} value={row.roomId ?? ""} onChange={roomId => updateClass(row.key, { roomId: roomId || null })} choices={[{ value: "", label: m.roomTbd }, ...rooms.map(room => ({ value: room.id, label: `${room.campusName} · ${room.name}` }))]} />
            <label className="space-y-1 text-xs text-muted">{m.capacity}<Input type="number" min={1} max={500} value={row.capacity || ""} onChange={event => updateClass(row.key, { capacity: Number(event.target.value) })} /></label>
            <label className="space-y-1 text-xs text-muted">{m.planned}<Input type="number" min={0} max={row.capacity} value={row.plannedStudents ?? ""} onChange={event => updateClass(row.key, { plannedStudents: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {row.weeklySlots.map((slot, slotIndex) => <div key={slotIndex} className="flex items-end gap-2">
              <Choice label={`${m.weekly} ${slotIndex + 1}`} value={String(slot.weekday)} onChange={value => updateClass(row.key, { weeklySlots: row.weeklySlots.map((s, i) => i === slotIndex ? { ...s, weekday: Number(value) } : s) })}
                choices={[1, 2, 3, 4, 5, 6, 0].map(day => ({ value: String(day), label: m.weekdays[day] }))} />
              <DateTimePicker aria-label={`${row.name} ${m.weekdays[slot.weekday]}`} mode="time" value={slot.time} onValueChange={time => updateClass(row.key, { weeklySlots: row.weeklySlots.map((s, i) => i === slotIndex ? { ...s, time } : s) })} />
              {row.weeklySlots.length > 1 && <Button type="button" variant="ghost" size="sm" aria-label={m.remove} onClick={() => updateClass(row.key, { weeklySlots: row.weeklySlots.filter((_, i) => i !== slotIndex) })}><Trash2 className="size-4" /></Button>}
            </div>)}
            {row.weeklySlots.length < 7 && <Button type="button" size="sm" variant="secondary" onClick={() => updateClass(row.key, { weeklySlots: [...row.weeklySlots, { weekday: [1, 2, 3, 4, 5, 6, 0].find(day => !row.weeklySlots.some(slot => slot.weekday === day))!, time: "17:00" }] })}><Plus className="size-4" />{m.addSlot}</Button>}
          </div>
        </section>)}
      </div>
      <DashboardCommandPanel><DashboardCommandActions>
        <Button type="button" variant="secondary" disabled={draft.classes.length >= 30} onClick={() => addClass()}><Plus className="size-4" />{m.addClass}</Button>
        <Button type="button" onClick={runPreview}>{pending ? m.saving : m.preview}</Button>
      </DashboardCommandActions></DashboardCommandPanel>
    </fieldset>
    <p className="text-xs text-muted">{m.plannedHint} · {restored ? m.restoreDraft : m.draftSaved}</p>
    {notice && <p role="alert" className="text-sm text-rose">{notice}</p>}
    {currentPreview && <section className="space-y-3" aria-label={m.preview}>
      <DashboardTableShell><Table mobileLayout="stacked"><TableHeader><TableRow><TableHead>{m.name}</TableHead>{Array.from({ length: draft.sessionCount }, (_, index) => <TableHead key={index}>{m.lesson(index + 1)}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{currentPreview.classes.map(row => <TableRow key={row.key}><TableCell mobileLabel={m.name} className="font-medium">{row.name}</TableCell>{row.sessions.map((session, index) => <TableCell key={session.scheduledAt} mobileLabel={m.lesson(index + 1)} className="whitespace-nowrap text-xs">{dateFormat.format(new Date(session.scheduledAt))}</TableCell>)}</TableRow>)}</TableBody>
      </Table></DashboardTableShell>
      {currentPreview.conflicts.length > 0 && <div role="alert" className="space-y-2 border-l-2 border-rose pl-3 text-sm"><p className="font-medium">{m.conflicts}</p>
        <ul className="space-y-1 text-xs">{currentPreview.conflicts.map((conflict, index) => <li key={index}>{draft.classes.find(row => row.key === conflict.classKey)?.name} · {conflict.otherName} · {dateFormat.format(new Date(conflict.scheduledAt))} · {[conflict.teacher ? m.teacherConflict : "", conflict.room ? m.roomConflict : ""].filter(Boolean).join(" / ")}</li>)}</ul><p>{m.conflictHint}</p></div>}
      <DashboardCommandPanel><DashboardCommandActions><Button type="button" disabled={pending || currentPreview.conflicts.length > 0} onClick={save}>{pending ? m.creating : m.save}</Button></DashboardCommandActions></DashboardCommandPanel>
    </section>}
  </div>;
}
