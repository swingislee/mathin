"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveAssessmentRuleAction } from "./assessment-rules-actions";
import { assessmentRuleError } from "./AssessmentRuleEditor";
import { ASSESSMENT_SLOT_GRADES } from "./assessment-availability-contract";
import { ruleMinuteLabel, ruleTimeMinute, type AssessmentRuleDefinition, type AssessmentRulesWorkspace, type SaveAssessmentRuleInput } from "./assessment-rules-contract";

export function AssessmentInlineRule({ initial, workspace, onSaved, onCancel }: {
  initial: SaveAssessmentRuleInput; workspace: AssessmentRulesWorkspace;
  onSaved: (data: AssessmentRulesWorkspace) => void; onCancel?: () => void;
}) {
  const t = useTranslations("school.assessmentRules"), a = useTranslations("school.assessmentAvailability");
  const [draft, setDraft] = useState(initial);
  const [start, setStart] = useState(ruleMinuteLabel(initial.definition.startMinute));
  const [end, setEnd] = useState(ruleMinuteLabel(initial.definition.endMinute));
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), d = draft.definition, open = d.kind === "open";
  const patch = (value: Partial<AssessmentRuleDefinition>) => { setDraft(current => ({ ...current, definition: { ...current.definition, ...value } })); setError(""); };
  const dirty = !initial.expectedUpdatedAt || JSON.stringify(draft) !== JSON.stringify(initial)
    || start !== ruleMinuteLabel(initial.definition.startMinute) || end !== ruleMinuteLabel(initial.definition.endMinute);
  const scopeOptions = draft.scope?.kind === "groups" ? workspace.groups : workspace.teachers.map(teacher => ({ id: teacher.id, name: teacher.displayName }));
  function reset() { setDraft(initial); setStart(ruleMinuteLabel(initial.definition.startMinute)); setEnd(ruleMinuteLabel(initial.definition.endMinute)); setError(""); onCancel?.(); }
  async function save() {
    if (lock.current) return;
    const startMinute = ruleTimeMinute(start), endMinute = ruleTimeMinute(end);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) { setError("invalid"); return; }
    lock.current = true; setPending(true); setError("");
    try {
      const result = await saveAssessmentRuleAction({ ...draft, definition: { ...d, startMinute, endMinute } });
      if (result.ok) onSaved(result.data); else setError(assessmentRuleError(result.code));
    } catch { setError("failed"); }
    finally { lock.current = false; setPending(false); }
  }
  return <form className="space-y-2 py-2" onClick={event => event.stopPropagation()}
    onSubmit={event => { event.preventDefault(); void save(); }}
    onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); } }}>
    <fieldset disabled={pending} className="space-y-2">
      {draft.scope && <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs text-muted">{t("teacherScope")}</Label>
        <Select value={draft.scope.kind} onValueChange={kind => setDraft(current => ({ ...current, scope: { kind: kind as "all" | "groups" | "teachers", ids: [] } }))}>
          <SelectTrigger className="h-7 w-36" aria-label={t("teacherScope")}><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">{t("allTeachers")}</SelectItem><SelectItem value="groups">{t("byGroup")}</SelectItem><SelectItem value="teachers">{t("selectedTeachers")}</SelectItem>
          </SelectContent>
        </Select>
        {draft.scope.kind !== "all" && scopeOptions.map(option => <Label key={option.id} className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={draft.scope!.ids.includes(option.id)} onCheckedChange={value => setDraft(current => ({ ...current, scope: { ...current.scope!, ids: value ? [...current.scope!.ids, option.id] : current.scope!.ids.filter(id => id !== option.id) } }))} />{option.name}
        </Label>)}
        {draft.scope.kind !== "all" && !scopeOptions.length && <span className="text-xs text-muted">{t("configureStaffFirst")}</span>}
      </div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Label className="flex items-center gap-1.5 text-xs"><Checkbox checked={d.enabled} onCheckedChange={value => patch({ enabled: value === true })} />{t("enabled")}</Label>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("weekdays")}>
          {[1,2,3,4,5,6,7].map(day => <button key={day} type="button" aria-pressed={d.weekdays.includes(day)}
            className={`min-h-7 min-w-7 rounded border px-1 text-xs ${d.weekdays.includes(day) ? "border-moon bg-moon/20 text-ink" : "border-line text-muted"}`}
            onClick={() => patch({ weekdays: d.weekdays.includes(day) ? d.weekdays.filter(x => x !== day) : [...d.weekdays, day].sort() })}>{t(`day${day}`)}</button>)}
          {!open && <button type="button" aria-pressed={!d.weekdays.length} className={`min-h-7 rounded border px-1.5 text-xs ${!d.weekdays.length ? "border-moon bg-moon/20" : "border-line text-muted"}`} onClick={() => patch({ weekdays: [] })}>{t("everyDay")}</button>}
        </div>
        <div className="flex items-center gap-1"><Input className="h-7 w-[4.5rem] px-1 text-xs" value={start} aria-label={t("start")} placeholder="09:00" onChange={event => setStart(event.target.value)} />
          <span className="text-muted">–</span><Input className="h-7 w-[4.5rem] px-1 text-xs" value={end} aria-label={t("end")} placeholder="24:00" onChange={event => setEnd(event.target.value)} /></div>
        {open ? <Label className="flex items-center gap-1 text-xs"><Input className="h-7 w-14 px-1 text-xs" type="number" min={5} max={240} value={d.durationMinutes ?? ""} onChange={event => patch({ durationMinutes: event.target.value ? Number(event.target.value) : null })} />{t("minutesEach")}</Label>
          : <button type="button" className="text-xs text-muted underline" onClick={() => { setStart("00:00"); setEnd("24:00"); }}>{t("wholeDay")}</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1"><Input className="h-7 w-[8.5rem] px-1 text-xs" type="date" required value={d.from} aria-label={t("from")} onChange={event => patch({ from: event.target.value })} />
          <span className="text-muted">–</span><Input className="h-7 w-[8.5rem] px-1 text-xs" type="date" required min={d.from} value={d.until} aria-label={t("until")} onChange={event => patch({ until: event.target.value })} /></div>
        <Select value={d.campusId ?? "all"} onValueChange={value => patch({ campusId: value === "all" ? null : value })}>
          <SelectTrigger className="h-7 w-32 text-xs" aria-label={t("campus")}><SelectValue placeholder={t("campus")} /></SelectTrigger><SelectContent>
            {!open && <SelectItem value="all">{t("allCampuses")}</SelectItem>}
            {workspace.campuses.filter(campus => campus.active || campus.id === d.campusId).map(campus => <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {open && workspace.topics.filter(topic => topic.enabled || d.topics.includes(topic.id)).map(topic => <Label key={topic.id} className="flex items-center gap-1 text-xs">
          <Checkbox checked={d.topics.includes(topic.id)} onCheckedChange={value => patch({ topics: value ? [...d.topics, topic.id] : d.topics.filter(id => id !== topic.id) })} />{topic.name}
        </Label>)}
        <details className="text-xs text-muted"><summary className="cursor-pointer">{t("moreRuleFields")}{open && d.grades.length ? ` · ${d.grades.map(grade => grade > 0 ? a("grade", { grade }) : grade === 0 ? a("kindergartenSenior") : a("kindergartenMiddle")).join("、")}` : ""}</summary>
          <div className="flex flex-wrap items-center gap-2 py-2"><Input className="h-7 w-40 text-xs" maxLength={120} value={d.label} aria-label={t("label")} placeholder={t("label")} onChange={event => patch({ label: event.target.value })} />
            {open && <><Label className="flex items-center gap-1"><Checkbox checked={!d.grades.length} onCheckedChange={value => patch({ grades: value ? [] : [...ASSESSMENT_SLOT_GRADES] })} />{t("allGrades")}</Label>
              {ASSESSMENT_SLOT_GRADES.map(grade => <Label key={grade} className="flex items-center gap-1"><Checkbox checked={d.grades.includes(grade)} onCheckedChange={value => patch({ grades: value ? [...d.grades, grade].sort((a,b) => a-b) : d.grades.filter(x => x !== grade) })} />{grade > 0 ? a("grade", { grade }) : grade === 0 ? a("kindergartenSenior") : a("kindergartenMiddle")}</Label>)}</>}
          </div>
        </details>
        {d.label && <span className="text-xs text-muted">{d.label}</span>}
      </div>
    </fieldset>
    {error && <p role="alert" className="text-xs text-rose">{t(error)}</p>}
    {(dirty || pending) && <div className="flex items-center justify-end gap-2"><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>{t("cancelChanges")}</Button>
      <Button type="submit" size="sm" disabled={pending}>{t(pending ? "saving" : "save")}</Button></div>}
  </form>;
}
