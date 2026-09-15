"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMMUNICATION_CHANNELS, COMMUNICATION_OUTCOMES, type CommunicationDraft } from "./session-communication-contract";
import { sessionCommunicationMessages } from "./session-communication-messages";

export function SessionCommunicationEntry({ draft, onChange, onSave, pending, locale, error, hasNext, group }: {
  draft: CommunicationDraft; onChange: (patch: Partial<CommunicationDraft>) => void; onSave: (next: boolean) => void;
  pending: boolean; locale: string; error?: string; hasNext: boolean; group?: boolean;
}) {
  const m = sessionCommunicationMessages(locale);
  const id = `communication-${draft.id}`;
  return <div className="space-y-3" aria-busy={pending}>
    {group && <p className="text-xs text-muted">{m.groupHint}</p>}
    <div className="grid gap-3 @2xl/followup-entry:grid-cols-3">
      <div><Label htmlFor={`${id}-date`} className="text-xs">{m.occurredOn}</Label><Input id={`${id}-date`} type="date" value={draft.occurredOn} disabled={pending} onChange={event => onChange({ occurredOn: event.target.value })} /></div>
      <div><Label htmlFor={`${id}-channel`} className="text-xs">{m.channel}</Label><Select value={draft.channel} disabled={pending} onValueChange={value => onChange({ channel: value as CommunicationDraft["channel"] })}>
        <SelectTrigger id={`${id}-channel`}><SelectValue /></SelectTrigger><SelectContent>{COMMUNICATION_CHANNELS.map(value => <SelectItem key={value} value={value}>{m.channels[value]}</SelectItem>)}</SelectContent>
      </Select></div>
      <div><Label htmlFor={`${id}-outcome`} className="text-xs">{m.outcome}</Label><Select value={draft.outcome} disabled={pending} onValueChange={value => onChange({ outcome: value as CommunicationDraft["outcome"] })}>
        <SelectTrigger id={`${id}-outcome`}><SelectValue /></SelectTrigger><SelectContent>{COMMUNICATION_OUTCOMES.map(value => <SelectItem key={value} value={value}>{m.outcomes[value]}</SelectItem>)}</SelectContent>
      </Select></div>
    </div>
    <div><Label htmlFor={`${id}-content`} className="text-xs">{m.content}</Label><Textarea id={`${id}-content`} value={draft.content} maxLength={2000} disabled={pending}
      placeholder={draft.outcome === "not_needed" ? m.notNeededNote : m.notePlaceholder} onChange={event => onChange({ content: event.target.value })} className="min-h-20" /></div>
    {draft.outcome === "follow_up" && <div className="grid gap-3 @2xl/followup-entry:grid-cols-[1fr_12rem]">
      <div><Label htmlFor={`${id}-next`} className="text-xs">{m.nextAction}</Label><Input id={`${id}-next`} value={draft.nextAction} maxLength={1000} disabled={pending} onChange={event => onChange({ nextAction: event.target.value })} /></div>
      <div><Label htmlFor={`${id}-next-date`} className="text-xs">{m.nextDate}</Label><Input id={`${id}-next-date`} type="date" value={draft.nextFollowUpOn} disabled={pending} onChange={event => onChange({ nextFollowUpOn: event.target.value })} /></div>
    </div>}
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <p role="alert" className="mr-auto text-xs text-rose">{error}</p>}
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => onSave(false)}>{pending ? m.saving : m.save}</Button>
      {hasNext && <Button size="sm" disabled={pending} onClick={() => onSave(true)}>{m.saveNext}</Button>}
    </div>
  </div>;
}
