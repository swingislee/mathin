"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, LoaderCircle, Mail, Plus, RefreshCw, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { AssessmentSlotDialog } from "./AssessmentSlotDialog";
import { CalendarCanvas, CalendarMiniMonth } from "./CalendarCanvas";
import { CalendarEventDialog } from "./CalendarEventDialog";
import { getWeekSchedule } from "./actions/schedule";
import { loadAssessmentSlotManagementAction } from "./assessment-availability-actions";
import type { AssessmentAvailabilitySlot, AssessmentSlotManagement } from "./assessment-availability-contract";
import { loadCalendarWorkspaceAction } from "./calendar-actions";
import type { CalendarEvent, CalendarEventKind, CalendarWorkspace } from "./calendar-contract";
import { CALENDAR_KINDS, CALENDAR_TONES, calendarAnchor, calendarRange, shiftCalendarAnchor, type CalendarItem, type CalendarItemKind, type CalendarView } from "./calendar-layout";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardCommandState, DashboardPage } from "./dashboard-page";
import type { RoomOptionV2 } from "./organization-locations";
import { addCalendarDays, calendarDayKey, dateTimeInputToInstant, markConflicts, zonedDateTimeInputValue, type ScheduleEntry } from "./schedule";

interface Props {
  locale: string;
  timeZone: string;
  now: number;
  currentUserId: string;
  currentUserName: string;
  canManageAvailability: boolean;
  canViewAssessments: boolean;
  roomOptions: RoomOptionV2[];
  mode?: "all" | "availability";
  refreshKey?: string;
  initialDate?: string;
}

type Editor = { kind: CalendarEventKind | "availability"; start: string; event: CalendarEvent | null; slot: AssessmentAvailabilitySlot | null };

export function CalendarWorkbench({ locale, timeZone, now, currentUserId, currentUserName, canManageAvailability, canViewAssessments, roomOptions, mode = "all", refreshKey, initialDate }: Props) {
  const t = useTranslations("school.calendar");
  const a = useTranslations("school.assessmentAvailability");
  const router = useRouter();
  const today = calendarDayKey(new Date(now), timeZone);
  const [anchor, setAnchor] = useState(initialDate && dateTimeInputToInstant(`${initialDate}T12:00`, timeZone) ? initialDate : today);
  const [view, setView] = useState<CalendarView>("week");
  const [kinds, setKinds] = useState<CalendarItemKind[]>(mode === "availability" ? ["lesson", "availability", "meeting", "preparation"] : [...CALENDAR_KINDS]);
  const [person, setPerson] = useState("all");
  const [campus, setCampus] = useState("all");
  const [room, setRoom] = useState("all");
  const [search, setSearch] = useState("");
  const [invitationsOnly, setInvitationsOnly] = useState(false);
  const [lessons, setLessons] = useState<ScheduleEntry[]>([]);
  const [workspace, setWorkspace] = useState<CalendarWorkspace | null>(null);
  const [availability, setAvailability] = useState<AssessmentSlotManagement | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const request = useRef(0);
  const range = useMemo(() => calendarRange(anchor, view, timeZone), [anchor, view, timeZone]);
  const from = range.start.toISOString();
  const to = range.end.toISOString();
  const loadKey = [from, to, timeZone, canManageAvailability, refreshKey, revision].join("|");
  const loading = loadedKey !== loadKey;
  const visibleErrors = loading ? [] : errors;

  useEffect(() => {
    const requestId = ++request.current;
    let cancelled = false;
    void Promise.allSettled([
      getWeekSchedule(from, to),
      loadCalendarWorkspaceAction({ from, to }),
      canManageAvailability ? loadAssessmentSlotManagementAction({ from: calendarDayKey(new Date(from), timeZone), to: calendarDayKey(addCalendarDays(new Date(to), -1, timeZone), timeZone) }) : Promise.resolve(null),
    ]).then(([scheduleResult, calendarResult, slotResult]) => {
      if (cancelled || requestId !== request.current) return;
      const failures: string[] = [];
      if (scheduleResult.status === "fulfilled") setLessons(scheduleResult.value);
      else { setLessons([]); failures.push("loadLessonsFailed"); }
      if (calendarResult.status === "fulfilled" && calendarResult.value.ok) setWorkspace(calendarResult.value.data);
      else { setWorkspace(null); failures.push("loadEventsFailed"); }
      if (slotResult.status === "fulfilled" && slotResult.value?.ok) setAvailability(slotResult.value.data);
      else { setAvailability(null); if (canManageAvailability) failures.push("loadAvailabilityFailed"); }
      setErrors(failures);
      setLoadedKey(loadKey);
    });
    return () => { cancelled = true; };
  }, [from, to, timeZone, canManageAvailability, refreshKey, revision, loadKey]);

  const people = useMemo(() => {
    const choices = new Map((workspace?.people ?? []).map(value => [value.id, value.displayName]));
    availability?.teachers.forEach(value => choices.set(value.id, value.displayName));
    if (!choices.has(currentUserId)) choices.set(currentUserId, currentUserName);
    return Array.from(choices, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [workspace, availability, currentUserId, currentUserName, locale]);
  const selectedPersonId = person === "me" ? currentUserId : person;
  const campuses = useMemo(() => {
    const choices = new Map(roomOptions.map(value => [value.campusId, value.campusName]));
    availability?.campuses.forEach(value => choices.set(value.id, value.name));
    return Array.from(choices, ([id, name]) => ({ id, name }));
  }, [roomOptions, availability]);
  const campusName = (id: string | null) => campuses.find(value => value.id === id)?.name ?? "";
  const teacherName = (id: string) => people.find(value => value.id === id)?.name ?? a("teacherUnavailableLabel");
  const pending = (workspace?.events ?? []).filter(event => event.status === "scheduled" && event.organizerId !== currentUserId && event.attendees.some(value => value.userId === currentUserId && value.response === "pending"));

  const items: CalendarItem[] = [
    ...markConflicts(lessons).filter(entry => !invitationsOnly && (person === "all" || entry.teacherIds?.includes(selectedPersonId))
      && (campus === "all" || entry.campusId === campus) && (room === "all" || entry.roomId === room)).map(entry => ({
      id: `lesson-${entry.sessionId}`, sourceId: entry.sessionId, kind: "lesson" as const,
      startsAt: entry.scheduledAt, endsAt: new Date(Date.parse(entry.scheduledAt) + Math.max(1, entry.durationMin) * 60_000).toISOString(),
      title: entry.classroomName || t("kind_lesson"), subtitle: [entry.lectureName, entry.teacherName].filter(Boolean).join(" · "),
      detail: [entry.campusName, entry.roomName].filter(Boolean).join(" · "), conflict: entry.conflict,
    })),
    ...(availability?.slots ?? []).filter(slot => !invitationsOnly && room === "all" && (person === "all" || slot.teacherId === selectedPersonId) && (campus === "all" || slot.campusId === campus)).map(slot => {
      const booked = slot.activeBooked ?? slot.booked;
      const state = booked ? "slotBooked" : !slot.enabled ? "slotClosed" : Date.parse(slot.endsAt) <= now ? "slotPast" : slot.blocked ? "slotBlocked" : "slotAvailable";
      return {
        id: `availability-${slot.id}`, sourceId: slot.id, kind: "availability" as const,
        startsAt: slot.startsAt, endsAt: slot.endsAt, title: `${teacherName(slot.teacherId)} · ${t(state)}`,
        subtitle: slot.subjects.map(subject => a(`subject_${subject}`)).join(" / "), detail: campusName(slot.campusId),
        state: t(state), muted: !slot.enabled || Date.parse(slot.endsAt) <= now, conflict: Boolean(slot.blocked),
      };
    }),
    ...(workspace?.events ?? []).filter(event => room === "all" && (campus === "all" || event.campusId === campus)
      && (person === "all" || event.organizerId === selectedPersonId || event.attendees.some(value => value.userId === selectedPersonId && value.response !== "declined"))
      && (!invitationsOnly || pending.some(value => value.id === event.id))).map(event => {
      const me = event.attendees.find(value => value.userId === currentUserId);
      return {
        id: `event-${event.id}`, sourceId: event.id, kind: event.kind, title: event.title,
        startsAt: event.startsAt, endsAt: event.endsAt,
        subtitle: event.attendees.filter(value => value.response !== "declined").map(value => value.displayName).join("、"),
        detail: [campusName(event.campusId), event.location].filter(Boolean).join(" · "),
        state: event.status !== "scheduled" ? t(`status_${event.status}`) : me?.response === "pending" ? t("response_pending") : undefined,
        muted: event.status !== "scheduled" || me?.response === "declined", pending: event.status === "scheduled" && me?.response === "pending",
      };
    }),
  ];
  const visible = items.filter(item => (invitationsOnly || kinds.includes(item.kind)) && [item.title, item.subtitle, item.detail, item.state].filter(Boolean).join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const monthFormatter = new Intl.DateTimeFormat(locale, { timeZone, year: "numeric", month: "long" });
  const dayFormatter = new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric" });
  const rangeLabel = view === "month" ? monthFormatter.format(calendarAnchor(anchor, timeZone)) : view === "day"
    ? new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "long" }).format(range.start)
    : `${dayFormatter.format(range.start)} – ${dayFormatter.format(addCalendarDays(range.end, -1, timeZone))}`;
  const canCreate = Boolean(workspace?.canCreate);

  function begin(kind: Editor["kind"], start?: Date) {
    if (kind === "availability" && !availability) return;
    if (kind !== "availability" && !workspace?.canCreate) return;
    const clock = new Date();
    const clockDay = calendarDayKey(clock, timeZone);
    const defaultDay = anchor < clockDay ? clockDay : anchor;
    const at = start ?? (defaultDay === clockDay ? new Date(Math.ceil((clock.getTime() + 1) / 1_800_000) * 1_800_000)
      : dateTimeInputToInstant(`${defaultDay}T09:00`, timeZone)!);
    setCreateMenuOpen(false);
    setEditor({ kind, start: at.toISOString(), event: null, slot: null });
  }

  function openItem(item: CalendarItem) {
    if (item.kind === "lesson") {
      router.push(`/dashboard/schedule?session=${encodeURIComponent(item.sourceId)}&date=${anchor}`, { scroll: false });
    } else if (item.kind === "availability") {
      const slot = availability?.slots.find(value => value.id === item.sourceId);
      if (slot) setEditor({ kind: "availability", start: slot.startsAt, event: null, slot });
    } else {
      const event = workspace?.events.find(value => value.id === item.sourceId);
      if (event) setEditor({ kind: event.kind, start: event.startsAt, event, slot: null });
    }
  }

  function revealSaved(startsAt: string) {
    if (Date.parse(startsAt) < range.start.getTime() || Date.parse(startsAt) >= range.end.getTime()) setAnchor(calendarDayKey(new Date(startsAt), timeZone));
    setInvitationsOnly(false);
    setRoom("all");
    if (!editor?.event && !editor?.slot) setSearch("");
    setRevision(value => value + 1);
  }

  function toggleKind(kind: CalendarItemKind) {
    setInvitationsOnly(false);
    setKinds(current => current.includes(kind) ? current.filter(value => value !== kind) : [...current, kind]);
  }

  const filters = <>
    <Select value={person} onValueChange={setPerson}><SelectTrigger className="h-9 w-36" aria-label={t("member")}><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="all">{t("allPeople")}</SelectItem><SelectItem value="me">{t("myCalendar")}</SelectItem>
      {people.filter(value => value.id !== currentUserId).map(value => <SelectItem key={value.id} value={value.id}>{value.name}</SelectItem>)}
    </SelectContent></Select>
    {campuses.length ? <Select value={campus} onValueChange={value => { setCampus(value); setRoom("all"); }}><SelectTrigger className="h-9 w-36" aria-label={t("campus")}><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="all">{t("allCampuses")}</SelectItem>{campuses.map(value => <SelectItem key={value.id} value={value.id}>{value.name}</SelectItem>)}
    </SelectContent></Select> : null}
    {roomOptions.length ? <Select value={room} onValueChange={setRoom}><SelectTrigger className="h-9 w-36" aria-label={t("room")}><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="all">{t("allRooms")}</SelectItem>{roomOptions.filter(value => campus === "all" || value.campusId === campus).map(value => <SelectItem key={value.id} value={value.id}>{value.name}</SelectItem>)}
    </SelectContent></Select> : null}
    <div className="relative min-w-32 flex-1 sm:max-w-44"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
      <Input className="h-9 pl-8" aria-label={t("search")} placeholder={t("search")} value={search} onChange={e => setSearch(e.target.value)} />
    </div>
  </>;

  return <>
    <DashboardPage title={t(mode === "availability" ? "availabilityTitle" : "title")} meta={<span>{rangeLabel}</span>} density="compact"
      className="panel-canvas flex min-h-0 w-full flex-1 flex-col" bodyClassName="min-h-0 flex-1" contentClassName="flex min-h-0 flex-1 flex-col"
      commandPanel={<DashboardCommandPanel>
        <DashboardCommandState>
          <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={t("previous")} onClick={() => setAnchor(shiftCalendarAnchor(anchor, view, -1, timeZone))}><ChevronLeft className="size-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(today)}>{t("today")}</Button>
          <Button variant="ghost" size="sm" className="size-8 p-0" aria-label={t("next")} onClick={() => setAnchor(shiftCalendarAnchor(anchor, view, 1, timeZone))}><ChevronRight className="size-4" /></Button>
          <div className="flex rounded-md border border-line p-0.5" aria-label={t("view")}>{(["day", "week", "month"] as const).map(value =>
            <button type="button" key={value} aria-pressed={view === value} className={cn("rounded px-2.5 py-1 text-sm", view === value ? "bg-moon/50 font-medium" : "text-muted hover:bg-moon/20")} onClick={() => setView(value)}>{t(`view_${value}`)}</button>)}</div>
        </DashboardCommandState>
        <DashboardCommandFilters>{filters}</DashboardCommandFilters>
        <DashboardCommandActions>
          <Button type="button" variant="ghost" size="sm" className="size-8 p-0" aria-label={t("refresh")} disabled={loading} onClick={() => setRevision(value => value + 1)}>
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
          <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}><PopoverTrigger asChild><Button size="sm" disabled={loading || (!canCreate && !availability)}><Plus className="size-4" />{t("create")}</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-44 space-y-1 p-1.5">
              {canManageAvailability ? <Button type="button" variant="ghost" className="w-full justify-start" disabled={!availability} onClick={() => begin("availability")}><CalendarPlus className="mr-1 size-4" />{t("kind_availability")}</Button> : null}
              {(["meeting", "task", "preparation"] as const).map(kind => <Button type="button" variant="ghost" className="w-full justify-start" key={kind} disabled={!canCreate} onClick={() => begin(kind)}>{t(`kind_${kind}`)}</Button>)}
            </PopoverContent>
          </Popover>
        </DashboardCommandActions>
      </DashboardCommandPanel>}>
      {visibleErrors.length ? <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 text-sm text-rose">{visibleErrors.map(error => <span key={error}>{t(error)}</span>)}<Button variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)}>{t("retry")}</Button></div> : null}
      <div className="flex min-h-0 flex-1 border-y border-line">
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-line py-4 pr-4 lg:block">
          <CalendarMiniMonth key={anchor.slice(0, 7)} anchor={anchor} today={today} locale={locale} timeZone={timeZone} onSelect={setAnchor} />
          <h2 className="mb-3 mt-6 text-sm font-medium">{t("calendars")}</h2>
          <div className="space-y-2.5">{CALENDAR_KINDS.filter(kind => kind !== "availability" || canManageAvailability).map(kind => <Label key={kind} className="flex cursor-pointer items-center gap-2 text-sm font-normal">
            <Checkbox checked={kinds.includes(kind) && !invitationsOnly} onCheckedChange={() => toggleKind(kind)} /><span className={cn("size-2 rounded-full", CALENDAR_TONES[kind].dot)} />{t(`kind_${kind}`)}
          </Label>)}</div>
          <button type="button" aria-pressed={invitationsOnly} className={cn("mt-6 flex w-full items-center gap-2 rounded-md py-2 text-left text-sm hover:bg-moon/20", invitationsOnly && "bg-moon/40")}
            onClick={() => setInvitationsOnly(value => !value)}><Mail className="size-4" /><span className="flex-1">{t("invitations")}</span><span className="text-muted">{pending.length}</span></button>
          <p className="mt-4 text-xs leading-relaxed text-muted">{t(mode === "availability" ? "availabilityHint" : "calendarHint")}</p>
          <p className="mt-3 text-[10px] text-muted">{timeZone}</p>
          {canViewAssessments ? <Link href="/dashboard/assessments" className="mt-4 block text-xs text-muted hover:text-ink hover:underline">{t("assessmentWorkbench")}</Link> : null}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-2 py-2 lg:hidden">
            {CALENDAR_KINDS.filter(kind => kind !== "availability" || canManageAvailability).map(kind => <button type="button" key={kind} aria-pressed={kinds.includes(kind) && !invitationsOnly}
              className={cn("flex items-center gap-1.5 text-xs", (!kinds.includes(kind) || invitationsOnly) && "opacity-40")} onClick={() => toggleKind(kind)}><span className={cn("size-2 rounded-full", CALENDAR_TONES[kind].dot)} />{t(`kind_${kind}`)}</button>)}
            <button type="button" aria-pressed={invitationsOnly} className={cn("text-xs", invitationsOnly && "font-bold text-rose")} onClick={() => setInvitationsOnly(value => !value)}>{t("invitations")} {pending.length}</button>
          </div>
          {!loading && visible.length === 0 ? <p className="border-b border-line px-3 py-2 text-xs text-muted">{t(invitationsOnly ? "noInvitations" : search || kinds.length === 0 || person !== "all" || campus !== "all" || room !== "all" ? "noMatchingEvents" : "empty")}</p> : null}
          <CalendarCanvas anchor={anchor} view={view} items={visible} locale={locale} timeZone={timeZone} now={now} loading={loading}
            onOpen={openItem} onSelectDay={day => { setAnchor(day); setView("day"); }}
            onCreate={canCreate || availability ? start => begin(mode === "availability" && availability ? "availability" : canCreate ? "meeting" : "availability", start) : undefined} />
        </div>
      </div>
    </DashboardPage>
    {editor?.kind === "availability" && availability ? <AssessmentSlotDialog open onOpenChange={open => { if (!open) setEditor(null); }} data={availability} timeZone={timeZone} slot={editor.slot}
      initialDate={calendarDayKey(new Date(editor.start), timeZone)} initialStartTime={zonedDateTimeInputValue(new Date(editor.start), timeZone).slice(11)}
      teacherId={person === "all" ? undefined : selectedPersonId}
      campusId={campus === "all" ? undefined : campus}
      onSaved={slot => { setAvailability(current => current ? { ...current, slots: [...current.slots.filter(value => value.id !== slot.id), slot] } : current); setKinds(current => current.includes("availability") ? current : [...current, "availability"]); revealSaved(slot.startsAt); }} /> : null}
    {editor && editor.kind !== "availability" && workspace ? <CalendarEventDialog open onOpenChange={open => { if (!open) setEditor(null); }} event={editor.event} kind={editor.kind}
      startsAt={editor.start} timeZone={timeZone} workspace={workspace} campuses={campuses}
      initialAttendeeIds={person === "all" || selectedPersonId === currentUserId ? [] : [selectedPersonId]}
      initialCampusId={campus === "all" ? undefined : campus}
      onSaved={event => { setWorkspace(current => current ? { ...current, events: [...current.events.filter(value => value.id !== event.id), event] } : current); setKinds(current => current.includes(event.kind) ? current : [...current, event.kind]); revealSaved(event.startsAt); }} /> : null}
  </>;
}
