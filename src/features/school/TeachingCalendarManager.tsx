"use client";

import { CalendarPlus, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import {
  archiveTeachingCalendarEntryAction,
  createTeachingCalendarEntryAction,
  previewTeachingCalendarImpactAction,
  updateTeachingCalendarEntryAction,
  type TeachingCalendarImpactV2,
  type TeachingCalendarEntryInput,
} from "./actions/academic-calendar";
import type { CampusV2 } from "./organization-locations";
import type { TeachingCalendarEntryV2, TeachingCalendarKind } from "./teaching-calendar";

const ORGANIZATION_SCOPE = "__organization__";

function weekdayOf(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

function emptyInput(today: string): TeachingCalendarEntryInput {
  return {
    campusId: null,
    name: "",
    kind: "closed",
    startsOn: today,
    endsOn: today,
    scheduleMode: null,
    mappedWeekday: null,
  };
}

function entryInput(entry: TeachingCalendarEntryV2): TeachingCalendarEntryInput {
  return {
    campusId: entry.campusId,
    name: entry.name,
    kind: entry.kind,
    startsOn: entry.startsOn,
    endsOn: entry.endsOn,
    scheduleMode: entry.scheduleMode,
    mappedWeekday: entry.mappedWeekday,
  };
}

function CalendarEntryDialog({
  open,
  onOpenChange,
  entry,
  campuses,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: TeachingCalendarEntryV2 | null;
  campuses: Array<Pick<CampusV2, "id" | "name">>;
  today: string;
}) {
  const t = useTranslations("school.academicCalendar");
  const router = useRouter();
  const [form, setForm] = useState<TeachingCalendarEntryInput>(() => entry ? entryInput(entry) : emptyInput(today));
  const [impact, setImpact] = useState<{ key: string; value: TeachingCalendarImpactV2 } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactFailed, setImpactFailed] = useState(false);
  const set = <K extends keyof TeachingCalendarEntryInput>(key: K, value: TeachingCalendarEntryInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const errors = {
    CALENDAR_SCOPE_OVERLAP: t("overlapError"),
    INVALID_CAMPUS: t("invalidCampus"),
    INVALID_HOLIDAY: t("invalidEntry"),
    INVALID_SCHEDULE_MODE: t("invalidEntry"),
    INVALID_MAPPED_WEEKDAY: t("invalidEntry"),
    TEACHING_DAY_MUST_BE_SINGLE_DATE: t("singleDayError"),
    default: t("actionFailed"),
  };
  const closeAndRefresh = () => { onOpenChange(false); router.refresh(); };
  const createRun = useAction(createTeachingCalendarEntryAction, {
    successMessage: t("created"), errorMessage: errors, onSuccess: closeAndRefresh,
  });
  const updateRun = useAction(updateTeachingCalendarEntryAction, {
    successMessage: t("saved"), errorMessage: errors, onSuccess: closeAndRefresh,
  });
  const pending = createRun.pending || updateRun.pending;
  const valid = form.name.trim().length > 0
    && form.name.trim().length <= 100
    && Boolean(form.startsOn)
    && Boolean(form.endsOn)
    && form.endsOn >= form.startsOn
    && (form.kind === "closed"
      ? form.scheduleMode === null
      : form.startsOn === form.endsOn && form.scheduleMode !== null
        && (form.scheduleMode === "manual" || form.mappedWeekday !== null));
  const impactRequestKey = form.startsOn && form.endsOn && form.endsOn >= form.startsOn
    ? `${form.campusId ?? ORGANIZATION_SCOPE}:${form.startsOn}:${form.endsOn}`
    : "";
  const impactValue = impactRequestKey && impact?.key === impactRequestKey && !impactFailed ? impact.value : null;
  const impactReady = impactValue !== null;

  useEffect(() => {
    if (!impactRequestKey) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setImpactLoading(true);
      setImpactFailed(false);
      void previewTeachingCalendarImpactAction(form.campusId, form.startsOn, form.endsOn)
        .then((value) => {
          if (active) setImpact({ key: impactRequestKey, value });
        })
        .catch(() => {
          if (active) setImpactFailed(true);
        })
        .finally(() => {
          if (active) setImpactLoading(false);
        });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [form.campusId, form.endsOn, form.startsOn, impactRequestKey]);

  const changeKind = (kind: TeachingCalendarKind) => {
    setForm((current) => kind === "closed"
      ? { ...current, kind, scheduleMode: null, mappedWeekday: null }
      : {
          ...current,
          kind,
          endsOn: current.startsOn,
          scheduleMode: "mapped",
          mappedWeekday: weekdayOf(current.startsOn),
        });
  };
  const changeStart = (startsOn: string) => {
    setForm((current) => ({
      ...current,
      startsOn,
      endsOn: current.kind === "closed" ? current.endsOn : startsOn,
      mappedWeekday: current.scheduleMode === "mapped" ? weekdayOf(startsOn) : current.mappedWeekday,
    }));
  };
  const submit = () => {
    const input = { ...form, name: form.name.trim() };
    if (entry) updateRun.run(entry.id, input);
    else createRun.run(input);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(entry ? "editTitle" : "createTitle")}</DialogTitle>
          <DialogDescription>{t("dialogIntro")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Label className="grid gap-1 text-xs font-normal text-muted sm:col-span-2">
            {t("name")}
            <Input value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={100} />
          </Label>
          <Label className="grid gap-1 text-xs font-normal text-muted">
            {t("scope")}
            <Select value={form.campusId ?? ORGANIZATION_SCOPE} onValueChange={(value) => set("campusId", value === ORGANIZATION_SCOPE ? null : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ORGANIZATION_SCOPE}>{t("organizationScope")}</SelectItem>
                {campuses.map((campus) => <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Label>
          <Label className="grid gap-1 text-xs font-normal text-muted">
            {t("kind")}
            <Select value={form.kind} onValueChange={(value) => changeKind(value as TeachingCalendarKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="closed">{t("kind_closed")}</SelectItem>
                <SelectItem value="teaching">{t("kind_teaching")}</SelectItem>
                <SelectItem value="makeup">{t("kind_makeup")}</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <Label className="grid gap-1 text-xs font-normal text-muted">
            {t("startsOn")}
            <DateTimePicker value={form.startsOn} onValueChange={changeStart} />
          </Label>
          <Label className="grid gap-1 text-xs font-normal text-muted">
            {t("endsOn")}
            <DateTimePicker value={form.endsOn} onValueChange={(value) => set("endsOn", value)} disabled={form.kind !== "closed"} />
          </Label>
          {form.kind !== "closed" ? (
            <>
              <Label className="grid gap-1 text-xs font-normal text-muted">
                {t("scheduleMode")}
                <Select value={form.scheduleMode ?? "mapped"} onValueChange={(value) => setForm((current) => value === "manual"
                  ? { ...current, scheduleMode: "manual", mappedWeekday: null }
                  : { ...current, scheduleMode: "mapped", mappedWeekday: current.mappedWeekday ?? weekdayOf(current.startsOn) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mapped">{t("mode_mapped")}</SelectItem>
                    <SelectItem value="manual">{t("mode_manual")}</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1 text-xs font-normal text-muted">
                {t("mappedWeekday")}
                <Select
                  disabled={form.scheduleMode !== "mapped"}
                  value={form.mappedWeekday === null ? "" : String(form.mappedWeekday)}
                  onValueChange={(value) => set("mappedWeekday", Number(value))}
                >
                  <SelectTrigger><SelectValue placeholder={t("chooseWeekday")} /></SelectTrigger>
                  <SelectContent>{[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                    <SelectItem key={weekday} value={String(weekday)}>{t(`weekday_${weekday}`)}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </Label>
            </>
          ) : null}
        </div>
        <p className="rounded-xl bg-moon/25 px-3 py-2 text-xs leading-5 text-muted">
          {t(form.kind === "closed" ? "closedHint" : form.scheduleMode === "mapped" ? "mappedHint" : "manualHint")}
        </p>
        <div className="rounded-xl border border-line px-3 py-2 text-xs leading-5 text-muted">
          {impactLoading || !impactValue ? (
            <p className="flex items-center gap-2">{impactLoading ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}{impactFailed ? t("impactFailed") : t("impactLoading")}</p>
          ) : (
            <>
              <p>{t("impactSummary", {
                sessions: impactValue.futureSessionCount,
                classes: impactValue.futureClassroomCount,
                history: impactValue.historicalSessionCount,
              })}</p>
              {form.campusId === null && impactValue.locationPendingCount > 0 ? <p className="mt-1">{t("impactPendingSummary", { count: impactValue.locationPendingCount })}</p> : null}
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="button" disabled={pending || !valid || !impactReady} onClick={submit}>
            {pending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
            {t(entry ? "save" : "create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeachingCalendarManager({
  entries,
  campuses,
  today,
}: {
  entries: TeachingCalendarEntryV2[];
  campuses: Array<Pick<CampusV2, "id" | "name">>;
  today: string;
}) {
  const t = useTranslations("school.academicCalendar");
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeachingCalendarEntryV2 | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<TeachingCalendarEntryV2 | null>(null);
  const archiveRun = useAction(archiveTeachingCalendarEntryAction, {
    successMessage: t("archived"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setArchiveTarget(null); router.refresh(); },
  });
  const rows = useMemo(() => [...entries].sort((left, right) => left.startsOn.localeCompare(right.startsOn)), [entries]);
  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (entry: TeachingCalendarEntryV2) => { setEditing(entry); setDialogOpen(true); };

  return (
    <section className="border-y border-line py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-ink">{t("calendarTitle")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t("calendarIntro")}</p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}><CalendarPlus className="size-4" />{t("createEntry")}</Button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 border-y border-dashed border-line py-8 text-center text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto border-y border-line">
          <Table className="min-w-[52rem]">
            <TableHeader><TableRow>
              <TableHead>{t("date")}</TableHead><TableHead>{t("name")}</TableHead><TableHead>{t("scope")}</TableHead><TableHead>{t("kind")}</TableHead><TableHead>{t("rule")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{rows.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs">{entry.startsOn}{entry.endsOn !== entry.startsOn ? ` – ${entry.endsOn}` : ""}</TableCell>
                <TableCell className="font-medium">{entry.name}</TableCell>
                <TableCell>{entry.campusName ?? t("organizationScope")}</TableCell>
                <TableCell><Badge variant={entry.kind === "closed" ? "outline" : "secondary"}>{t(`kind_${entry.kind}`)}</Badge></TableCell>
                <TableCell className="text-xs text-muted">{entry.kind === "closed" ? t("noSessions") : entry.scheduleMode === "manual" ? t("mode_manual") : t("mappedRule", { weekday: t(`weekday_${entry.mappedWeekday}`) })}</TableCell>
                <TableCell><div className="flex justify-end gap-1">
                  <Button type="button" size="sm" variant="ghost" aria-label={t("editEntry", { name: entry.name })} onClick={() => openEdit(entry)}><Pencil className="size-4" /></Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={t("archiveEntry", { name: entry.name })} onClick={() => setArchiveTarget(entry)}><Trash2 className="size-4" /></Button>
                </div></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </div>
      )}
      {dialogOpen ? (
        <CalendarEntryDialog
          key={editing?.id ?? `new:${today}`}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          entry={editing}
          campuses={campuses}
          today={today}
        />
      ) : null}
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(next) => { if (!next) setArchiveTarget(null); }}
        title={t("archiveTitle")}
        description={archiveTarget ? t("archiveDescription", { name: archiveTarget.name }) : ""}
        confirmLabel={t("archive")}
        cancelLabel={t("cancel")}
        pending={archiveRun.pending}
        onConfirm={() => archiveTarget && archiveRun.run(archiveTarget.id)}
      />
    </section>
  );
}
