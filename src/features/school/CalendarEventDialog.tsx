"use client";

import { useRef, useState } from "react";
import { Check, LoaderCircle, Save, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { newId } from "@/lib/uuid";
import { changeCalendarEventStatusAction, respondCalendarInvitationAction, saveCalendarEventAction } from "./calendar-actions";
import { CALENDAR_EVENT_KINDS, type CalendarEvent, type CalendarEventKind, type CalendarWorkspace } from "./calendar-contract";
import { CalendarRecurrenceFields, calendarRecurrenceInput, newCalendarRecurrenceDraft } from "./CalendarRecurrenceFields";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

export function calendarErrorKey(code: string) {
  if (code === "FORBIDDEN" || code === "UNAUTHENTICATED") return "errorForbidden";
  if (code === "VALIDATION") return "errorValidation";
  if (code === "CONFLICT") return "errorConflict";
  if (code === "TIME_UNAVAILABLE" || code === "SLOT_BOOKED") return "errorBusy";
  if (code === "NOT_FOUND") return "errorNotFound";
  if (code === "ATTENDEE_UNAVAILABLE") return "errorAttendee";
  if (code === "CAMPUS_UNAVAILABLE") return "errorCampus";
  if (code === "EVENT_CLOSED") return "errorClosed";
  if (code === "REPEAT_VALIDATION") return "errorRepeat";
  if (code === "STRATEGY_RANGE") return "errorStrategyRange";
  return "errorFailed";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  kind: CalendarEventKind;
  startsAt: string;
  timeZone: string;
  workspace: CalendarWorkspace;
  campuses: { id: string; name: string }[];
  initialAttendeeIds?: string[];
  initialCampusId?: string;
  onSaved: (event: CalendarEvent) => void;
}

export function CalendarEventDialog(props: Props) {
  return props.open ? <CalendarEventEditor key={props.event?.id ?? "new"} {...props} /> : null;
}

function defaultEventDuration(kind: CalendarEventKind) {
  return kind === "strategy" ? 365 * 86_400_000 : (kind === "task" || kind === "milestone" ? 30 : 60) * 60_000;
}

function CalendarEventEditor({ onOpenChange, event, kind, startsAt, timeZone, workspace, campuses, initialAttendeeIds = [], initialCampusId, onSaved }: Props) {
  const t = useTranslations("school.calendar");
  const [id] = useState(() => event?.id ?? newId());
  const [draft, setDraft] = useState(() => ({
    kind: event?.kind ?? kind, title: event?.title ?? "", description: event?.description ?? "",
    start: zonedDateTimeInputValue(new Date(event?.startsAt ?? startsAt), timeZone),
    end: zonedDateTimeInputValue(new Date(event?.endsAt ?? Date.parse(startsAt) + defaultEventDuration(kind)), timeZone),
    location: event?.location ?? "", campusId: event ? event.campusId ?? "" : initialCampusId ?? "",
    attendeeIds: event?.attendees.filter(person => person.userId !== event.organizerId).map(person => person.userId) ?? initialAttendeeIds,
  }));
  const [repeat, setRepeat] = useState(() => newCalendarRecurrenceDraft(
    zonedDateTimeInputValue(new Date(event?.startsAt ?? startsAt), timeZone).slice(0, 10)));
  const [peopleSearch, setPeopleSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveLock = useRef(false);
  const editable = !event || event.canEdit;
  const finished = event?.status === "cancelled" || event?.status === "completed";
  const myInvitation = event?.attendees.find(person => person.userId === workspace.currentUserId);
  const organizerId = event?.organizerId ?? workspace.currentUserId;
  const availablePeople = workspace.people.filter(person => person.id !== organizerId && person.displayName.toLocaleLowerCase().includes(peopleSearch.toLocaleLowerCase()));
  const patch = (value: Partial<typeof draft>) => { setDraft(current => ({ ...current, ...value })); setError(null); };

  async function act(action: () => Promise<ActionResult<CalendarEvent>>) {
    if (saveLock.current) return;
    saveLock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) { setError(result.code); return; }
      onSaved(result.data);
      toast.success(t("saved"));
      onOpenChange(false);
    } catch { setError("UNKNOWN"); }
    finally { saveLock.current = false; setPending(false); }
  }

  function save() {
    if (saveLock.current || !editable || finished) return;
    const start = dateTimeInputToInstant(draft.start, timeZone);
    const end = draft.kind === "milestone" && start ? new Date(start.getTime() + 30 * 60_000) : dateTimeInputToInstant(draft.end, timeZone);
    if (!draft.title.trim() || !start || !end || end <= start) { setError("VALIDATION"); return; }
    if (draft.kind === "strategy" && end.getTime() - start.getTime() > 370 * 86_400_000) { setError("STRATEGY_RANGE"); return; }
    const recurrence = event ? null : calendarRecurrenceInput(repeat, draft.start.slice(0, 10), timeZone);
    if (recurrence === undefined) { setError("REPEAT_VALIDATION"); return; }
    void act(() => saveCalendarEventAction({
      id, kind: draft.kind, title: draft.title.trim(), description: draft.description.trim(),
      startsAt: start.toISOString(), endsAt: end.toISOString(), location: draft.location.trim(),
      campusId: draft.campusId || null, attendeeIds: draft.attendeeIds, expectedUpdatedAt: event?.updatedAt ?? null,
      ...(!event ? { recurrence } : {}),
    }));
  }

  return <Sheet open onOpenChange={open => { if (!pending) onOpenChange(open); }}>
    <SheetContent className="w-full sm:w-[480px] sm:max-w-[480px]" closeLabel={t("close")} onEscapeKeyDown={e => { if (pending) e.preventDefault(); }} onPointerDownOutside={e => { if (pending) e.preventDefault(); }}>
      <SheetHeader className="pr-8 text-left">
        <SheetTitle>{event ? t(`kind_${event.kind}`) : t("create")}</SheetTitle>
        <SheetDescription>{event ? t("organizedBy", { name: event.organizerName }) : t("internalHint")}</SheetDescription>
      </SheetHeader>
      {event && myInvitation && organizerId !== workspace.currentUserId && !finished ? <div className="mt-5 border-y border-line py-3">
        <p className="mb-2 text-sm">{t(`response_${myInvitation.response}`)}</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={myInvitation.response === "accepted" ? "secondary" : "primary"} disabled={pending || myInvitation.response === "accepted"}
            onClick={() => void act(() => respondCalendarInvitationAction({ id, response: "accepted" }))}><Check className="size-4" />{t("accept")}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending || myInvitation.response === "declined"}
            onClick={() => void act(() => respondCalendarInvitationAction({ id, response: "declined" }))}><X className="size-4" />{t("decline")}</Button>
        </div>
      </div> : null}
      <form className="mt-5 space-y-5" onSubmit={e => { e.preventDefault(); save(); }}>
        {finished ? <p className="text-sm text-muted">{t(`status_${event.status}`)}</p> : null}
        <fieldset disabled={pending || !editable || finished} className="space-y-4 disabled:opacity-80">
          <div className="space-y-1.5"><Label htmlFor="calendar-kind">{t("kind")}</Label>
            <Select value={draft.kind} onValueChange={value => {
              const nextKind = value as CalendarEventKind;
              const start = dateTimeInputToInstant(draft.start, timeZone);
              patch({ kind: nextKind, ...(start ? { end: zonedDateTimeInputValue(new Date(start.getTime() + defaultEventDuration(nextKind)), timeZone) } : {}) });
            }} disabled={pending || !editable || finished || Boolean(event)}>
              <SelectTrigger id="calendar-kind"><SelectValue /></SelectTrigger>
              <SelectContent>{CALENDAR_EVENT_KINDS.map(value => <SelectItem key={value} value={value}>{t(`kind_${value}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="calendar-title">{t("eventTitle")}</Label>
            <Input id="calendar-title" value={draft.title} required maxLength={160} placeholder={t(`placeholder_${draft.kind}`)} onChange={e => patch({ title: e.target.value })} />
          </div>
          <div className={draft.kind === "milestone" ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
            <div className="min-w-0 space-y-1.5"><Label htmlFor="calendar-start">{t(draft.kind === "milestone" ? "milestoneAt" : "startsAt")}</Label>
              <Input id="calendar-start" type="datetime-local" required value={draft.start} onChange={e => patch({ start: e.target.value })} />
            </div>
            {draft.kind !== "milestone" ? <div className="min-w-0 space-y-1.5"><Label htmlFor="calendar-end">{t("endsAt")}</Label>
              <Input id="calendar-end" type="datetime-local" required min={draft.start} value={draft.end} onChange={e => patch({ end: e.target.value })} />
            </div> : null}
          </div>
          <p className="text-xs text-muted">{timeZone}</p>
          {draft.kind === "strategy" ? <p className="text-xs text-muted">{t("strategyTimingHint")}</p> : null}
          {event?.seriesId ? <p className="text-xs text-muted">{t("seriesEditHint")}</p> : null}
          {!event ? <CalendarRecurrenceFields prefix="calendar-repeat" draft={repeat} startDate={draft.start.slice(0, 10)}
            disabled={pending || !editable || Boolean(finished)} onChange={value => { setRepeat(value); setError(null); }} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5"><Label htmlFor="calendar-campus">{t("campus")}</Label>
              <Select value={draft.campusId || "none"} onValueChange={value => patch({ campusId: value === "none" ? "" : value })} disabled={pending || !editable || finished}>
                <SelectTrigger id="calendar-campus"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("noCampus")}</SelectItem>
                  {campuses.map(campus => <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5"><Label htmlFor="calendar-location">{t("location")}</Label>
              <Input id="calendar-location" value={draft.location} maxLength={240} onChange={e => patch({ location: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="calendar-description">{t("description")}</Label>
            <Textarea id="calendar-description" value={draft.description} maxLength={4000} rows={3} onChange={e => patch({ description: e.target.value })} />
          </div>
          {editable ? <div className="space-y-2">
            <Label htmlFor="calendar-people-search">{t(draft.kind === "task" ? "assignees" : "attendees")}</Label>
            <Input id="calendar-people-search" placeholder={t("findPeople")} value={peopleSearch} onChange={e => setPeopleSearch(e.target.value)} />
            <div className="max-h-48 space-y-1 overflow-y-auto border-y border-line py-2">
              {availablePeople.map(person => <Label key={person.id} className="flex min-h-8 cursor-pointer items-center gap-2 px-1 text-sm font-normal">
                <Checkbox checked={draft.attendeeIds.includes(person.id)} onCheckedChange={checked => patch({ attendeeIds: checked ? [...draft.attendeeIds, person.id] : draft.attendeeIds.filter(id => id !== person.id) })} />
                <span className="min-w-0 flex-1 truncate">{person.displayName}</span>
                {event?.attendees.find(value => value.userId === person.id) ? <span className="text-xs text-muted">{t(`response_${event.attendees.find(value => value.userId === person.id)!.response}`)}</span> : null}
              </Label>)}
              {!availablePeople.length ? <p className="px-1 text-xs text-muted">{t("noPeople")}</p> : null}
            </div>
            <p className="text-xs text-muted">{t("selectedPeople", { count: draft.attendeeIds.length })}</p>
          </div> : null}
        </fieldset>
        {!editable && event ? <div className="space-y-2 border-y border-line py-3">
          <h3 className="text-sm font-medium">{t(event.kind === "task" ? "assignees" : "attendees")}</h3>
          {event.attendees.map(person => <div key={person.userId} className="flex justify-between gap-2 text-sm"><span>{person.displayName}</span>
            <span className="text-xs text-muted">{person.completedAt ? t("status_completed") : t(`response_${person.response}`)}</span></div>)}
        </div> : null}
        {error ? <p role="alert" className="text-sm text-rose">{t(calendarErrorKey(error))}</p> : null}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {editable && !finished ? <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{t(event ? "save" : draft.attendeeIds.length ? "createAndInvite" : "create")}</Button> : null}
          {event?.canComplete && event.status === "scheduled" && !event.myCompletedAt ? <Button type="button" variant="secondary" disabled={pending}
            onClick={() => void act(() => changeCalendarEventStatusAction({ id, status: "completed", expectedUpdatedAt: event.updatedAt }))}><Check className="size-4" />{t("completeTask")}</Button> : null}
          {event?.myCompletedAt ? <p className="self-center text-sm text-muted">{t("myTaskCompleted")}</p> : null}
          {event?.canEdit && event.status === "scheduled" ? <Button type="button" variant="ghost" disabled={pending}
            onClick={() => void act(() => changeCalendarEventStatusAction({ id, status: "cancelled", expectedUpdatedAt: event.updatedAt }))}>{t("cancelEvent")}</Button> : null}
          {event?.canEdit && finished ? <Button type="button" disabled={pending}
            onClick={() => void act(() => changeCalendarEventStatusAction({ id, status: "scheduled", expectedUpdatedAt: event.updatedAt }))}>{t("restoreEvent")}</Button> : null}
        </div>
      </form>
    </SheetContent>
  </Sheet>;
}
