"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { FollowupChoice, type FollowupTone } from "./dashboard-page/FollowupChoice";
import { reviseCommunicationRecordAction, type ReviseCommunicationRecordInput } from "./communication-workday-actions";
import type { CommunicationDayEvent, CommunicationWorkday } from "./communication-workday-contract";

/** 发生时间按上海时间录入，登记时间与修订时间始终保留。 */
function localDateTime(value: string) { return new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16); }

function CommunicationRecord({ event }: { event: CommunicationDayEvent }) {
  const t = useTranslations("school.communicationWorkday");
  const invitationT = useTranslations("school.invitations");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [note, setNote] = useState(event.note);
  const [channel, setChannel] = useState(event.channel);
  const [occurredAt, setOccurredAt] = useState(localDateTime(event.occurredAt));
  const [outcome, setOutcome] = useState(event.outcome);
  const [wechat, setWechat] = useState(event.wechatAdded == null ? "unknown" : String(event.wechatAdded));
  const [visit, setVisit] = useState(event.visitCommitted == null ? "unknown" : String(event.visitCommitted));
  const [interest, setInterest] = useState(event.interestLevel ?? "");
  const [route, setRoute] = useState(event.route ?? "continue_follow_up");
  const startEditing = () => {
    setNote(event.note); setChannel(event.channel); setOccurredAt(localDateTime(event.occurredAt)); setOutcome(event.outcome);
    setWechat(event.wechatAdded == null ? "unknown" : String(event.wechatAdded)); setVisit(event.visitCommitted == null ? "unknown" : String(event.visitCommitted));
    setInterest(event.interestLevel ?? ""); setRoute(event.route ?? "continue_follow_up"); setError(""); setEditing(true);
  };
  const outcomeLabel = event.source === "invitation" ? invitationT(`state_${event.outcome}`) : t(`outcome_${event.outcome}`);
  const outcomeOptions = (event.source === "contact" ? ["connected", "unreachable", "declined", "invalid_number"] : ["connected", "unreachable"]).map((value) => ({ value, label: t(`outcome_${value}`), tone: (value === "connected" ? "healthy" : value === "unreachable" ? "attention" : "unhealthy") as FollowupTone }));
  const booleanOptions = [{ value: "unknown", label: t("unknown"), tone: "neutral" as const }, { value: "true", label: t("yes"), tone: "healthy" as const }, { value: "false", label: t("no"), tone: "attention" as const }];
  const save = () => {
    setError("");
    startTransition(async () => {
      if (!occurredAt || !Number.isFinite(Date.parse(`${occurredAt}+08:00`))) { setError(t("invalidTime")); return; }
      const values = {
        note, channel, occurredAt: occurredAt === localDateTime(event.occurredAt) ? event.occurredAt : new Date(`${occurredAt}+08:00`).toISOString(),
        ...(event.source !== "invitation" ? { outcome } : {}),
        ...(event.source === "contact" ? { wechatAdded: wechat === "unknown" ? null : wechat === "true", visitCommitted: visit === "unknown" ? null : visit === "true", interestLevel: interest || null } : {}),
        ...(event.source === "post_activity" ? { route } : {}),
      };
      const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== event[key as keyof CommunicationDayEvent]));
      if (!Object.keys(patch).length) { setEditing(false); return; }
      const result = await reviseCommunicationRecordAction({ source: event.source, eventId: event.id, expectedRevision: event.revisionId, patch } as ReviseCommunicationRecordInput);
      if (!result.ok) { setError(t(result.code === "CORRECTION_REQUIRES_WORKFLOW" ? "correctionWorkflow" : result.code === "REVISION_CONFLICT" ? "revisionConflict" : "revisionFailed")); return; }
      setEditing(false); router.refresh();
    });
  };
  return <li className="min-w-0 border-b border-line/60 py-3 last:border-0" data-communication-event={event.id}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <time className="tabular-nums text-muted" dateTime={event.occurredAt}>{localDateTime(event.occurredAt).replace("T", " ")}</time>
      <span>{event.recordedByName}</span><span className="text-muted">{invitationT(`channel_${event.channel}`)}</span><span>{outcomeLabel}</span>
      {event.revisedAt ? <span className="text-blue" title={localDateTime(event.revisedAt).replace("T", " ")}>{t("revised")}</span> : null}
      {event.canRevise && !editing ? <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={startEditing}>{t("revise")}</Button> : null}
    </div>
    {event.note ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{event.note}</p> : null}
    {event.recordedAt !== event.occurredAt ? <p className="mt-1 text-xs text-muted">{t("recordedAt", { time: localDateTime(event.recordedAt).replace("T", " ") })}</p> : null}
    {editing ? <form className="mt-3 grid min-w-0 gap-3 rounded-xl border border-line bg-card/60 p-3" onSubmit={(submit) => { submit.preventDefault(); save(); }}>
      <p className="text-xs text-muted">{t("revisionHint")}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="min-w-0 space-y-1 text-xs text-muted"><span>{t("occurredAt")}</span><Input type="datetime-local" value={occurredAt} onChange={(change) => setOccurredAt(change.target.value)} required className="h-8 min-w-0" /></label>
        <div className="min-w-0 space-y-1 text-xs text-muted"><span>{t("channel")}</span><FollowupChoice value={channel} onValueChange={setChannel} label={t("channel")} options={["phone", "wechat", "in_person", "other"].map((value) => ({ value, label: invitationT(`channel_${value}`) }))} /></div>
        {event.source !== "invitation" ? <div className="min-w-0 space-y-1 text-xs text-muted"><span>{t("outcome")}</span><FollowupChoice value={outcome} onValueChange={setOutcome} label={t("outcome")} options={outcomeOptions} /></div> : null}
        {event.source === "contact" ? <>
          <div className="min-w-0 space-y-1 text-xs text-muted"><span>{t("wechat")}</span><FollowupChoice value={wechat} onValueChange={setWechat} label={t("wechat")} options={booleanOptions} /></div>
          <div className="min-w-0 space-y-1 text-xs text-muted"><span>{t("visit")}</span><FollowupChoice value={visit} onValueChange={setVisit} label={t("visit")} options={booleanOptions} /></div>
          <div className="min-w-0 space-y-1 text-xs text-muted"><span>{t("interest")}</span><FollowupChoice value={interest} onValueChange={setInterest} label={t("interest")} options={[{ value: "", label: t("unknown") }, { value: "A", label: "A", tone: "healthy" }, { value: "B", label: "B", tone: "attention" }, { value: "C", label: "C", tone: "unhealthy" }]} /></div>
        </> : null}
        {event.source === "post_activity" ? <div className="min-w-0 space-y-1 text-xs text-muted"><span>{t("route")}</span><FollowupChoice value={route} onValueChange={setRoute} label={t("route")} options={["continue_follow_up", "await_product", "closed", "enrollment_pending"].map((value) => ({ value, label: t(`route_${value}`), tone: value === "closed" ? "unhealthy" : value === "enrollment_pending" ? "healthy" : "attention" }))} /></div> : null}
      </div>
      <Textarea value={note} onChange={(change) => setNote(change.target.value)} aria-label={t("note")} placeholder={t("note")} maxLength={2000} className="min-h-20 resize-y" />
      {error ? <p role="alert" className="text-xs text-rose">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>{t("cancel")}</Button><Button type="submit" size="sm" disabled={pending}>{t("saveRevision")}</Button></div>
    </form> : null}
  </li>;
}

export function CommunicationDaySummary({ workday, rowKey }: { workday?: CommunicationWorkday; rowKey: string }) {
  const t = useTranslations("school.communicationWorkday");
  const events = workday?.events.filter((event) => event.key === rowKey) ?? [];
  if (!events.length) return null;
  return <section className="min-w-0 border-b border-line pb-3" aria-label={t("dayRecords", { date: workday!.date })}>
    <p className="text-xs font-medium text-muted">{t("dayRecords", { date: workday!.date })}</p>
    <ul className="min-w-0">{events.map((event) => <CommunicationRecord key={`${event.source}:${event.id}:${event.revisionId ?? "original"}`} event={event} />)}</ul>
  </section>;
}
