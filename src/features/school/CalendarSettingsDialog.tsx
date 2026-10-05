"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { newId } from "@/lib/uuid";
import { TeachingCalendarManager } from "./TeachingCalendarManager";
import { saveCalendarSchoolWindowsAction } from "./calendar-actions";
import type { CalendarWorkspace } from "./calendar-contract";
import { calendarWindowDrafts, calendarWindowsFromDrafts, type CalendarSchoolWindowDraft } from "./calendar-settings-adapter";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: CalendarWorkspace;
  campuses: { id: string; name: string }[];
  today: string;
  onSaved: () => void;
}

function CalendarSettingsBody({ onOpenChange, workspace, campuses, today, onSaved }: Omit<Props, "open">) {
  const t = useTranslations("school.calendar");
  const a = useTranslations("school.academicCalendar");
  const [drafts, setDrafts] = useState(() => calendarWindowDrafts(workspace.schoolWindows));
  const [saved, setSaved] = useState(() => ({ windows: workspace.schoolWindows, updatedAt: workspace.settingsUpdatedAt }));
  const [conflict, setConflict] = useState(false);
  const parsed = calendarWindowsFromDrafts(drafts);
  const savedWindows = [...saved.windows].sort((left, right) => left.weekday - right.weekday || left.startMinute - right.startMinute || left.endMinute - right.endMinute);
  const changed = !parsed.ok || JSON.stringify(parsed.windows) !== JSON.stringify(savedWindows);
  const save = useAction(saveCalendarSchoolWindowsAction, {
    successMessage: t("schoolWindowsSaved"),
    errorMessage: {
      VALIDATION: t("invalidSchoolWindow"),
      FORBIDDEN: t("settingsForbidden"),
      CONFLICT: t("settingsConflict"),
      default: t("errorFailed"),
    },
    onSuccess: data => {
      setSaved({ windows: data.schoolWindows, updatedAt: data.updatedAt });
      onSaved();
    },
    onError: code => { if (code === "CONFLICT") setConflict(true); },
  });

  function update(id: string, value: Partial<CalendarSchoolWindowDraft>) {
    setDrafts(current => current.map(draft => draft.id === id ? { ...draft, ...value } : draft));
  }

  return <>
    <DialogHeader>
      <DialogTitle>{t("settingsTitle")}</DialogTitle>
      <DialogDescription>{t("settingsDescription")}</DialogDescription>
    </DialogHeader>
    {!workspace.canManageSettings ? <p className="text-sm text-muted">{t("settingsReadOnly")}</p> : null}
    <section className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">{t("schoolWindowsTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("schoolWindowsHint")}</p>
        </div>
        {workspace.canManageSettings ? <Button type="button" size="sm" variant="secondary" disabled={save.pending || conflict || drafts.length >= 70}
          onClick={() => setDrafts(current => [...current, { id: newId(), weekday: current.at(-1)?.weekday ?? 1, startTime: "09:00", endTime: "10:00" }])}>
          <Plus className="size-4" />{t("addSchoolWindow")}
        </Button> : null}
      </div>
      {drafts.length === 0 ? <p className="py-5 text-sm text-muted">{t("noSchoolWindows")}</p> : <div className="mt-4 divide-y divide-line">
        {drafts.map(draft => <div key={draft.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 py-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_auto]">
          <Label htmlFor={`weekday-${draft.id}`} className="col-span-2 grid gap-1 text-xs font-normal text-muted sm:col-span-1">
            {t("schoolWindowWeekday")}
            <Select value={String(draft.weekday)} disabled={!workspace.canManageSettings || save.pending || conflict} onValueChange={value => update(draft.id, { weekday: Number(value) })}>
              <SelectTrigger id={`weekday-${draft.id}`}><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4, 5, 6, 0].map(weekday => <SelectItem key={weekday} value={String(weekday)}>{a(`weekday_${weekday}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Label>
          <Label htmlFor={`starts-${draft.id}`} className="col-start-1 row-start-2 grid gap-1 text-xs font-normal text-muted sm:col-start-2 sm:row-start-1">
            {t("startsAt")}
            <Input id={`starts-${draft.id}`} value={draft.startTime} placeholder="HH:MM" maxLength={5} autoComplete="off"
              disabled={!workspace.canManageSettings || save.pending || conflict} onChange={event => update(draft.id, { startTime: event.target.value })} />
          </Label>
          <Label htmlFor={`ends-${draft.id}`} className="col-start-2 row-start-2 grid gap-1 text-xs font-normal text-muted sm:col-start-3 sm:row-start-1">
            {t("endsAt")}
            <Input id={`ends-${draft.id}`} value={draft.endTime} placeholder="HH:MM" maxLength={5} autoComplete="off"
              disabled={!workspace.canManageSettings || save.pending || conflict} onChange={event => update(draft.id, { endTime: event.target.value })} />
          </Label>
          {workspace.canManageSettings ? <Button type="button" size="sm" variant="ghost" className="col-start-3 row-start-2 size-10 p-0 text-muted sm:col-start-4 sm:row-start-1"
            aria-label={t("removeSchoolWindow", { weekday: a(`weekday_${draft.weekday}`), time: `${draft.startTime}–${draft.endTime}` })}
            disabled={save.pending || conflict} onClick={() => setDrafts(current => current.filter(value => value.id !== draft.id))}><Trash2 className="size-4" /></Button> : null}
        </div>)}
      </div>}
      {!parsed.ok ? <p role="alert" className="mt-2 text-sm text-rose">{t(parsed.error)}</p> : null}
      {conflict ? <p role="alert" className="mt-2 text-sm text-rose">{t("settingsConflict")}</p> : null}
      {workspace.canManageSettings ? <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" disabled={save.pending || !parsed.ok || !changed || conflict}
          onClick={() => { if (parsed.ok) save.run({ schoolWindows: parsed.windows, expectedUpdatedAt: saved.updatedAt }); }}>
          {save.pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : null}{t("saveSchoolWindows")}
        </Button>
      </div> : null}
    </section>
    <div className="border-t border-line pt-5">
      <TeachingCalendarManager entries={workspace.teachingCalendar} campuses={campuses} today={today}
        canManage={workspace.canManageSettings} embedded onSaved={onSaved} />
    </div>
    <DialogFooter>
      <Button type="button" variant="secondary" disabled={save.pending} onClick={() => onOpenChange(false)}>{t("close")}</Button>
    </DialogFooter>
  </>;
}

export function CalendarSettingsDialog({ open, ...props }: Props) {
  return <Dialog open={open} onOpenChange={props.onOpenChange}>
    <DialogContent className="max-w-4xl">
      {open ? <CalendarSettingsBody {...props} /> : null}
    </DialogContent>
  </Dialog>;
}
