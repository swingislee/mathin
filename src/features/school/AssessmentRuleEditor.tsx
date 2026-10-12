"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Textarea } from "@/components/ui/textarea";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveAssessmentRuleAction } from "./assessment-rules-actions";
import { ruleMinuteLabel, ruleTimeMinute, type AssessmentRuleDefinition, type AssessmentRulesWorkspace, type SaveAssessmentRuleInput } from "./assessment-rules-contract";
import { ASSESSMENT_SLOT_GRADES } from "./assessment-availability-contract";

export function assessmentRuleError(code: string) {
  return ({ UNAUTHENTICATED: "forbidden", FORBIDDEN: "forbidden", VALIDATION: "invalid", NOT_FOUND: "notFound",
    CONFLICT: "conflict", TIME_UNAVAILABLE: "timeUnavailable", NO_ELIGIBLE_TEACHER: "teacherUnavailable",
    CAMPUS_UNAVAILABLE: "campusUnavailable", RULE_TOO_LARGE: "tooLarge" } as Record<string, string>)[code] ?? "failed";
}

export function AssessmentRuleEditor({ initial, workspace, onSaved, onClose, onPendingChange }: {
  initial: SaveAssessmentRuleInput; workspace: AssessmentRulesWorkspace;
  onSaved: (data: AssessmentRulesWorkspace) => void; onClose: () => void; onPendingChange: (value: boolean) => void;
}) {
  const en = useLocale() === "en";
  const t = useTranslations("school.assessmentRules");
  const a = useTranslations("school.assessmentAvailability");
  const [draft, setDraft] = useState(initial);
  const [start, setStart] = useState(ruleMinuteLabel(initial.definition.startMinute));
  const [end, setEnd] = useState(ruleMinuteLabel(initial.definition.endMinute));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const d = draft.definition;
  const open = d.kind === "open";
  const patch = (value: Partial<AssessmentRuleDefinition>) => { setDraft(current => ({ ...current, definition: { ...current.definition, ...value } })); setError(""); };
  const toggle = (values: number[], value: number) => values.includes(value) ? values.filter(x => x !== value) : [...values, value].sort((a,b) => a-b);

  async function save() {
    if (lock.current) return;
    const startMinute = ruleTimeMinute(start), endMinute = ruleTimeMinute(end);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) { setError("invalid"); return; }
    lock.current = true; setPending(true); onPendingChange(true); setError("");
    try {
      const result = await saveAssessmentRuleAction({ ...draft, definition: { ...d, startMinute, endMinute } });
      if (result.ok) onSaved(result.data); else setError(assessmentRuleError(result.code));
    } catch { setError("failed"); }
    finally { lock.current = false; setPending(false); onPendingChange(false); }
  }

  return <form className="space-y-3 py-2" onSubmit={event => { event.preventDefault(); void save(); }}
    onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); } }}>
    <fieldset disabled={pending} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Label className="grid gap-1">{t("label")}<Input value={d.label} maxLength={120} onChange={event => patch({ label: event.target.value })} placeholder={t(open ? "open" : "exclude")} /></Label>
        <Label className="grid gap-1">{t("campus")}<Select value={d.campusId ?? "all"} onValueChange={value => patch({ campusId: value === "all" ? null : value })}>
          <SelectTrigger><SelectValue placeholder={t("campus")} /></SelectTrigger><SelectContent>
            {!open && <SelectItem value="all">{t("allCampuses")}</SelectItem>}
            {workspace.campuses.filter(c => c.active || c.id === d.campusId).map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.active ? "" : ` · ${t("disabled")}`}</SelectItem>)}
          </SelectContent></Select></Label>
        <Label className="grid gap-1">{t("from")}<Input type="date" required value={d.from} onChange={event => patch({ from: event.target.value })} /></Label>
        <Label className="grid gap-1">{t("until")}<Input type="date" required min={d.from} value={d.until} onChange={event => patch({ until: event.target.value })} /></Label>
      </div>
      {open && <div className="grid gap-3 sm:grid-cols-2"><Label className="grid gap-1">{en ? "Mode" : "预约方式"}<Select value={d.mode || "campus"} onValueChange={mode => patch({ mode: mode as "campus" | "online" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="campus">{en ? "At campus" : "到校"}</SelectItem><SelectItem value="online">{en ? "Online" : "线上"}</SelectItem></SelectContent></Select></Label><Label className="grid gap-1">{en ? "Joining instructions (shown after booking)" : "参加说明（预约成功后可见）"}<Textarea maxLength={2000} required={d.mode === "online"} value={d.joiningInstructions || ""} onChange={e => patch({ joiningInstructions: e.target.value })} /></Label></div>}
      <div className="flex flex-wrap items-end gap-3">
        <Label className="grid gap-1">{t("start")}<Input className="w-28" value={start} required placeholder="09:00" onChange={event => setStart(event.target.value)} /></Label>
        <Label className="grid gap-1">{t("end")}<Input className="w-28" value={end} required placeholder="24:00" onChange={event => setEnd(event.target.value)} /></Label>
        {open ? <Label className="grid gap-1">{t("duration")}<Input className="w-28" type="number" min={5} max={240} step={1} required value={d.durationMinutes ?? ""} onChange={event => patch({ durationMinutes: event.target.value ? Number(event.target.value) : null })} /></Label>
          : <Button variant="secondary" type="button" onClick={() => { setStart("00:00"); setEnd("24:00"); }}>{t("wholeDay")}</Button>}
        <Label className="flex min-h-9 items-center gap-2"><Checkbox checked={d.enabled} onCheckedChange={value => patch({ enabled: value === true })} />{t("enabled")}</Label>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><span className="text-sm text-muted">{t("weekdays")}</span>
        {!open && <Label className="flex items-center gap-2"><Checkbox checked={!d.weekdays.length} onCheckedChange={value => patch({ weekdays: value ? [] : [1,2,3,4,5,6,7] })} />{t("everyDay")}</Label>}
        {[1,2,3,4,5,6,7].map(day => <Label key={day} className="flex items-center gap-1.5"><Checkbox checked={d.weekdays.includes(day)} onCheckedChange={() => patch({ weekdays: toggle(d.weekdays, day) })} />{t(`day${day}`)}</Label>)}
      </div>
      {open && <>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><span className="text-sm text-muted">{t("topics")}</span>
          {workspace.topics.filter(topic => topic.enabled || d.topics.includes(topic.id)).map(topic => <Label key={topic.id} className="flex items-center gap-1.5"><Checkbox checked={d.topics.includes(topic.id)} onCheckedChange={value => patch({ topics: value ? [...d.topics, topic.id] : d.topics.filter(id => id !== topic.id) })} />{topic.name}{topic.enabled ? "" : ` · ${t("disabled")}`}</Label>)}
          {!workspace.topics.some(topic => topic.enabled) && <span className="text-sm text-muted">{t("noTopics")}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><span className="text-sm text-muted">{t("grades")}</span>
          <Label className="flex items-center gap-1.5"><Checkbox checked={!d.grades.length} onCheckedChange={value => patch({ grades: value ? [] : [...ASSESSMENT_SLOT_GRADES] })} />{t("allGrades")}</Label>
          {ASSESSMENT_SLOT_GRADES.map(grade => <Label key={grade} className="flex items-center gap-1.5"><Checkbox checked={d.grades.includes(grade)} onCheckedChange={() => patch({ grades: toggle(d.grades, grade) })} />{grade === -1 ? a("kindergartenMiddle") : grade === 0 ? a("kindergartenSenior") : a("grade", { grade })}</Label>)}
        </div>
      </>}
    </fieldset>
    <p className="text-xs text-muted">{t("preserveBookings")}</p>
    {error && <p role="alert" className="text-sm text-rose">{t(error)}</p>}
    <div className="flex justify-end gap-2"><Button variant="ghost" type="button" disabled={pending} onClick={onClose}>{t("close")}</Button>
      <Button type="submit" disabled={pending}><Save className="size-4" />{t(pending ? "saving" : "save")}</Button></div>
  </form>;
}
