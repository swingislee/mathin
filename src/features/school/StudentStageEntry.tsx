"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { newId } from "@/lib/uuid";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { FollowupContactFacts } from "./FollowupContactFacts";
import { InvitationDraftFields } from "./InvitationDraftFields";
import { invitationDraftIsComplete, invitationCanHaveNextContactReminder, INVITATION_KINDS, INVITATION_STATES } from "./invitation-contract";
import { emptyInvitationDraft } from "./followup-entry-contract";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { studentStageMessages } from "./student-stage-messages";
import { getStudentStageOptionsAction, saveStudentStageEntryAction } from "./student-stage-actions";
import type { StudentEntryMode, StudentStageEntryInput, StudentStageOptions, StudentStageRow, StudentStageSaved } from "./student-stage-contract";

const draftSchema = z.object({
  requestId: z.string().uuid(), note: z.string().max(2000), nextContactAt: z.string().nullable(),
  outcome: z.enum(["connected","unreachable","declined","invalid_number"]).nullable(), wechatAdded: z.boolean().nullable(), interestLevel: z.enum(["A","B","C"]).nullable(),
  invitation: z.object({ kind: z.enum(INVITATION_KINDS), state: z.enum(INVITATION_STATES), activityId: z.string().nullable(), assessorId: z.string().nullable(),
    parentTimeOptions: z.array(z.string()), assessorTimeOptions: z.array(z.string()), scheduledAt: z.string().nullable(), locationText: z.string(), nextContactAt: z.string().nullable().optional() }).nullable(),
  courseId: z.string(), termId: z.string(), result: z.enum(["considering","committed","payment_pending","not_enrolled","nurturing","confirm"]), paymentEvidence: z.string().max(1000),
});
type Draft = z.infer<typeof draftSchema>;
function readDraft(key: string, row: StudentStageRow): Draft {
  if (typeof window !== "undefined") {
    try { const stored = draftSchema.safeParse(JSON.parse(sessionStorage.getItem(key) ?? "null")); if (stored.success) return stored.data; } catch { /* 无可恢复草稿时使用当前事实。 */ }
  }
  return { requestId: newId(), note: "", nextContactAt: row.nextContactAt, outcome: null, wechatAdded: null, interestLevel: null,
    invitation: row.invitation, courseId: row.courseId ?? "", termId: "", result: "considering", paymentEvidence: "" };
}
function storeDraft(key: string, draft: Draft | null) {
  try { if (draft) sessionStorage.setItem(key, JSON.stringify(draft)); else sessionStorage.removeItem(key); } catch { /* 会话存储不可用时，保持当前行内草稿。 */ }
}

export function StudentStageEntry({ row, requestedMode, locale, currentUserId, canEnroll, onSaved, onBusyChange, canAdvance }: {
  row: StudentStageRow; requestedMode: StudentEntryMode; locale: string; currentUserId: string; canEnroll: boolean;
  onSaved: (saved: StudentStageSaved, advance: boolean) => void; onBusyChange: (busy: boolean) => void; canAdvance: boolean;
}) {
  const m = studentStageMessages(locale);
  const storageKey = `mathin:student-stage:v1:${currentUserId}:${row.key}`;
  const [draft, setDraft] = useState(() => readDraft(storageKey, row));
  const [mode, setMode] = useState(requestedMode);
  const [acceptedMode, setAcceptedMode] = useState(requestedMode);
  if (requestedMode !== acceptedMode) {
    setMode(requestedMode); setAcceptedMode(requestedMode);
    setDraft(current => ({ ...current, requestId: newId() }));
  }
  const [options, setOptions] = useState<StudentStageOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const change = (patch: Partial<Draft>) => setDraft(current => {
    const next = { ...current, ...patch, requestId: newId() }; storeDraft(storageKey, next); return next;
  });
  useEffect(() => {
    let active = true;
    void getStudentStageOptionsAction({ studentId: row.studentId, leadId: row.leadId }).then(result => {
      if (!active) return;
      if (result.ok) { setOptions(result.data); setLoadError(false); } else setLoadError(true);
      setLoading(false);
    }).catch(() => { if (active) { setLoadError(true); setLoading(false); } });
    return () => { active = false; };
  }, [row.studentId, row.leadId, revision]);
  const enrollmentType = row.stage === "awaiting_renewal" ? "renewal" : row.stage === "former_student" ? "reactivate" : "new";
  const matchingOpportunity = options?.opportunities.find(o => o.course_id === draft.courseId && o.term_id === draft.termId && o.opportunity_type === enrollmentType);
  const reminderAllowed = mode === "contact" ? draft.outcome === "unreachable" || draft.outcome === "declined"
    : mode === "invitation" ? Boolean(draft.invitation && invitationCanHaveNextContactReminder(draft.invitation)) : true;
  const invitationValue = draft.invitation ?? emptyInvitationDraft("assessment_1v1");
  const businessLoaded = options !== null;
  const disabled = pending || !row.canWrite;
  const valid = mode === "note" ? Boolean(row.studentId && draft.note.trim())
    : mode === "contact" ? Boolean(row.canContact && draft.outcome)
    : mode === "invitation" ? row.canContact && businessLoaded && draft.invitation !== null && invitationDraftIsComplete(invitationValue)
    : Boolean(row.studentId && businessLoaded && draft.courseId && draft.termId && matchingOpportunity?.stage !== "enrolled"
      && (draft.result !== "confirm" || canEnroll && draft.paymentEvidence.trim()));
  const save = async (advance: boolean) => {
    if (saving.current || disabled || !valid) return;
    saving.current = true;
    const input: StudentStageEntryInput = { studentId: row.studentId, leadId: row.leadId, mode, note: draft.note,
      nextContactAt: reminderAllowed ? draft.nextContactAt : null, outcome: mode === "contact" ? draft.outcome : null,
      wechatAdded: mode === "contact" ? draft.wechatAdded : null, interestLevel: mode === "contact" ? draft.interestLevel : null,
      invitation: mode === "invitation" ? { ...invitationValue, nextContactAt: reminderAllowed ? draft.nextContactAt : null } : null,
      expectedInvitationId: row.invitation?.id ?? null, expectedInvitationUpdatedAt: row.invitation?.updatedAt ?? null,
      enrollment: mode === "enrollment" ? { courseId: draft.courseId, termId: draft.termId, type: enrollmentType,
        stage: draft.result === "confirm" ? "committed" : draft.result, confirm: draft.result === "confirm", paymentEvidence: draft.paymentEvidence,
        expectedOpportunityId: matchingOpportunity?.id ?? null } : null };
    setPending(true); onBusyChange(true); setError("");
    try {
      const result = await saveStudentStageEntryAction(draft.requestId, input);
      if (!result.ok) {
        const message = result.code.includes("CONFLICT") ? m.conflict : result.code === "STUDENT_PHONE_REQUIRED" ? m.phoneRequired
          : result.code === "ACTIVE_INVITATION_EXISTS" ? m.activeKind : result.code === "IDENTITY_NOT_CONFIRMED" ? m.needIdentity : m.saveFailed;
        setError(message); toast.error(message); return;
      }
      // 只清除本次已保存的内容；未提交的另一个业务模块继续保留。
      const next: Draft = { ...draft, requestId: newId(), note: "", outcome: null,
        invitation: mode === "invitation" ? result.data.subject.invitation : draft.invitation,
        nextContactAt: result.data.subject.nextContactAt,
        ...(mode === "enrollment" ? { paymentEvidence: "", result: "considering" as const } : {}) };
      setDraft(next); storeDraft(storageKey, next);
      if (result.data.subject.key !== row.key) { storeDraft(storageKey, null); storeDraft(`mathin:student-stage:v1:${currentUserId}:${result.data.subject.key}`, next); }
      if (mode === "contact" && result.data.subject.studentId) setMode("note");
      setOptions(current => current ? { ...current, row: result.data.subject,
        opportunities: mode === "enrollment" && result.data.opportunityId ? [
          ...current.opportunities.filter(o => o.id !== result.data.opportunityId),
          { id: result.data.opportunityId, course_id: draft.courseId, term_id: draft.termId, opportunity_type: enrollmentType,
            stage: result.data.enrollmentId ? "enrolled" : input.enrollment!.stage, updated_at: result.data.savedAt },
        ] : current.opportunities } : current);
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT)); toast.success(m.saved); onSaved(result.data, advance);
    } catch { setError(m.saveFailed); toast.error(m.saveFailed); }
    finally { saving.current = false; setPending(false); onBusyChange(false); }
  };
  const switchMode = (value: string) => { if (!pending) { setMode(value as StudentEntryMode); change({}); setError(""); } };
  const enrollmentLabel = row.stage === "awaiting_renewal" ? m.renewal : row.stage === "former_student" ? m.reactivate : m.enrollment;
  return <div className="space-y-4" data-student-stage-entry={row.key}>
    <Tabs value={mode} onValueChange={switchMode}>
      <TabsList className="h-auto flex-wrap justify-start gap-1">
        {row.studentId ? <TabsTrigger value="note" disabled={pending}>{m.note}</TabsTrigger> : null}
        {row.stage === "awaiting_first_contact" && row.canContact ? <TabsTrigger value="contact" disabled={pending}>{m.contact}</TabsTrigger> : null}
        {row.canContact ? <TabsTrigger value="invitation" disabled={pending}>{m.invitation}</TabsTrigger> : null}
        {row.studentId ? <TabsTrigger value="enrollment" disabled={pending}>{enrollmentLabel}</TabsTrigger> : null}
      </TabsList>
    </Tabs>
    <FollowupEntryFields id={`student-stage-${row.key}`} note={draft.note} onNoteChange={note => change({ note })}
      pending={pending} disabled={!row.canWrite} saveDisabled={!valid} onSave={advance => { void save(advance); }} canAdvance={canAdvance}
      reminder={reminderAllowed ? { value: draft.nextContactAt, onChange: nextContactAt => change({ nextContactAt }) } : undefined}
      noteLabel={m.note} hint={error ? <span role="alert" className="text-rose">{error}</span> : mode === "contact" ? m.firstContactHint : m.noteHint}
      tools={draft.note || draft.invitation || draft.paymentEvidence ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
        storeDraft(storageKey, null); setDraft(readDraft(storageKey, row)); setError("");
      }}>{m.discard}</Button> : undefined}>
      {mode === "note" ? <div className="space-y-3 text-sm leading-6">
        <p className="font-medium">{m.stages[row.stage]} · {m.details[row.detail] ?? row.detail}</p>
        {row.courseTitle ? <p>{row.courseTitle} · {row.termName}</p> : null}
        {row.note ? <div className="space-y-1"><p className="text-xs text-muted">{m.recent}</p><p className="whitespace-pre-wrap">{row.note}</p></div> : null}
        {row.stage === "awaiting_renewal" ? <p className="text-xs text-muted">{m.renewalHint}</p> : null}
        {row.stage === "former_student" ? <p className="text-xs text-muted">{m.formerHint}</p> : null}
      </div> : null}
      {mode === "contact" ? <div className="space-y-5">
        <div className="space-y-2"><Label className="text-xs">{m.contactOutcome}</Label><div className="flex flex-wrap gap-2">
          {(["unreachable","connected","declined","invalid_number"] as const).map(value => <Button key={value} size="sm"
            variant={draft.outcome === value ? "primary" : "secondary"} aria-pressed={draft.outcome === value} disabled={disabled}
            onClick={() => change({ outcome: value, ...(["unreachable","invalid_number"].includes(value) ? { wechatAdded: null, interestLevel: null } : {}) })}>
            {value === "connected" ? m.connected : value === "declined" ? m.declined : m.details[value]}</Button>)}
        </div></div>
        {draft.outcome === "connected" || draft.outcome === "declined" ? <FollowupContactFacts wechat={draft.wechatAdded} onWechatChange={wechatAdded => change({ wechatAdded })}
          interest={draft.interestLevel ?? ""} onInterestChange={value => change({ interestLevel: value || null })} disabled={disabled} /> : null}
      </div> : null}
      {mode === "invitation" || mode === "enrollment" ? loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{m.loading}</p>
        : loadError ? <p className="text-sm text-muted">{m.loadFailed}<Button variant="ghost" size="sm" onClick={() => { setLoading(true); setRevision(v => v + 1); }}>{m.retry}</Button></p> : null : null}
      {mode === "invitation" && options ? <div className="space-y-3">
        {row.invitation ? <p className="text-xs text-muted">{m.activeInvitation}</p> : null}
        <InvitationDraftFields value={invitationValue} activities={options.invitations.activities} assessors={options.invitations.assessors}
          locale={locale} disabled={disabled} allowNone={false} showReminder={false} gradeHint={row.grade}
          enableProgressShortcuts={false} onChange={invitation => change({ invitation })} />
      </div> : null}
      {mode === "enrollment" && options ? <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label className="text-xs" htmlFor={`stage-course-${row.key}`}>{m.course}</Label>
            <Select value={draft.courseId} onValueChange={courseId => change({ courseId })} disabled={disabled}><SelectTrigger id={`stage-course-${row.key}`}><SelectValue placeholder={m.choose} /></SelectTrigger>
              <SelectContent>{options.enrollment.courses.map(course => <SelectItem key={course.id} value={course.id}>{course.title}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label className="text-xs" htmlFor={`stage-term-${row.key}`}>{m.term}</Label>
            <Select value={draft.termId} onValueChange={termId => change({ termId })} disabled={disabled}><SelectTrigger id={`stage-term-${row.key}`}><SelectValue placeholder={m.choose} /></SelectTrigger>
              <SelectContent>{options.enrollment.terms.map(term => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="space-y-1.5"><Label className="text-xs" htmlFor={`stage-result-${row.key}`}>{m.enrollmentResult}</Label>
          <Select value={draft.result} onValueChange={result => change({ result: result as Draft["result"] })} disabled={disabled}><SelectTrigger id={`stage-result-${row.key}`}><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="considering">{m.considering}</SelectItem><SelectItem value="committed">{m.committed}</SelectItem><SelectItem value="payment_pending">{m.paymentPending}</SelectItem>
            <SelectItem value="not_enrolled">{m.notEnrolled}</SelectItem><SelectItem value="nurturing">{m.nurturing}</SelectItem>
            {canEnroll ? <SelectItem value="confirm">{m.confirmEnrollment}</SelectItem> : null}
          </SelectContent></Select></div>
        {draft.result === "confirm" ? <div className="space-y-1.5"><Label className="text-xs" htmlFor={`stage-payment-${row.key}`}>{m.paymentEvidence}</Label>
          <Input id={`stage-payment-${row.key}`} value={draft.paymentEvidence} onChange={event => change({ paymentEvidence: event.target.value })} maxLength={1000} placeholder={m.evidenceHint} disabled={disabled} /></div> : null}
        <p className="text-xs leading-5 text-muted">{m.enrollmentHint}</p>
      </div> : null}
    </FollowupEntryFields>
  </div>;
}
