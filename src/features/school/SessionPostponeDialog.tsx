"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { CalendarArrowDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/components/action-form";
import { DashboardTableShell } from "./dashboard-page/DashboardCard";
import { applySessionPostponeAction, previewSessionPostponeAction } from "./actions/session-postpone";
import { DEFAULT_SESSION_POSTPONE_DAYS, MAX_SESSION_POSTPONE_DAYS, type SessionPostponePreview } from "./session-postpone-contract";

export function SessionPostponeDialog({ sessionId, disabled, onSaved }: {
  sessionId: string;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("school.classes.postpone");
  const locale = useLocale();
  const fieldId = useId();
  const request = useRef(0);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(String(DEFAULT_SESSION_POSTPONE_DAYS));
  const [preview, setPreview] = useState<SessionPostponePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClosedDays, setConfirmClosedDays] = useState(false);
  const [closedDayReason, setClosedDayReason] = useState("");
  const errorMessages = {
    SCHEDULE_PREVIEW_STALE: t("stale"),
    CLOSED_DAY_CONFIRMATION_REQUIRED: t("closedDaysRequired"),
    SESSION_ALREADY_STARTED: t("notEditable"), SESSION_NOT_EDITABLE: t("notEditable"),
    CLASSROOM_NOT_ACTIVE: t("notEditable"), SESSION_NOT_FOUND: t("notEditable"),
    FORBIDDEN_SCOPE: t("forbidden"), FORBIDDEN: t("forbidden"), UNAUTHENTICATED: t("forbidden"),
    INVALID_SCHEDULE: t("invalidTime"), VALIDATION: t("invalidDays"), default: t("failed"),
  };
  const apply = useAction(applySessionPostponeAction, {
    successMessage: data => t("saved", { count: data.updatedCount }),
    errorMessage: errorMessages,
    onSuccess: () => { setOpen(false); setPreview(null); onSaved(); },
    onError: code => { setError(code); setPreview(null); setConfirmClosedDays(false); },
  });
  const pending = loading || apply.pending;
  const dayCount = Number(days);
  const validDays = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= MAX_SESSION_POSTPONE_DAYS;
  const hasClosedDays = preview?.sessions.some(row => row.closedDayId !== null) ?? false;

  async function loadPreview(value: number) {
    const currentRequest = ++request.current;
    setLoading(true); setPreview(null); setError(null); setConfirmClosedDays(false); setClosedDayReason("");
    try {
      const result = await previewSessionPostponeAction({ sessionId, days: value });
      if (request.current !== currentRequest) return;
      if (result.ok) setPreview(result.data);
      else setError(result.code);
    } catch {
      if (request.current === currentRequest) setError("UNKNOWN");
    } finally {
      if (request.current === currentRequest) setLoading(false);
    }
  }

  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
    timeZone: preview?.timeZone, month: "numeric", day: "numeric", year: "numeric",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));

  return <>
    <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => {
      setOpen(true); setDays(String(DEFAULT_SESSION_POSTPONE_DAYS));
      void loadPreview(DEFAULT_SESSION_POSTPONE_DAYS);
    }}><CalendarArrowDown size={14} />{t("entry")}</Button>
    <Dialog open={open} onOpenChange={value => {
      if (apply.pending) return;
      setOpen(value);
      if (!value) { request.current++; setLoading(false); setPreview(null); }
    }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></DialogHeader>
        <div className="flex items-end gap-3">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor={fieldId}>{t("days")}</Label>
            <Input id={fieldId} type="number" min={1} max={MAX_SESSION_POSTPONE_DAYS} step={1} value={days} disabled={pending} onChange={event => {
              setDays(event.target.value); setPreview(null); setError(null); setConfirmClosedDays(false);
            }} aria-describedby={`${fieldId}-hint`} />
          </div>
          <Button type="button" variant="secondary" disabled={pending || !validDays} onClick={() => void loadPreview(dayCount)}>{t("preview")}</Button>
        </div>
        <p id={`${fieldId}-hint`} className="text-xs text-muted">{t("daysHint")}</p>
        {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={14} className="animate-spin" />{t("loading")}</p>}
        {error && <p role="alert" className="text-sm text-rose">{errorMessages[error as keyof typeof errorMessages] ?? errorMessages.default}</p>}
        {preview && <div className="grid gap-3">
          <p className="text-sm font-medium">{t("summary", { count: preview.sessions.length, days: preview.days })}</p>
          <DashboardTableShell>
            <Table containerClassName="max-h-72 overflow-auto">
              <TableHeader className="sticky top-0 z-10 bg-paper"><TableRow>
                <TableHead>{t("session")}</TableHead><TableHead>{t("before")}</TableHead><TableHead>{t("after")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>{preview.sessions.map(row => <TableRow key={row.id}>
                <TableCell>{row.title || t("untitled")}</TableCell>
                <TableCell className="text-xs text-muted">{formatTime(row.previousScheduledAt)}</TableCell>
                <TableCell className="text-xs">{formatTime(row.scheduledAt)}{row.closedDayId && <p className="mt-1 text-rose">{t("closedDay", { name: row.closedDayName ?? "" })}</p>}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </DashboardTableShell>
          <p className="text-xs text-muted">{t("preserved")}{preview.skippedCount > 0 ? ` ${t("skipped", { count: preview.skippedCount })}` : ""}</p>
          {hasClosedDays && <div className="grid gap-2">
            <div className="flex items-start gap-2"><Checkbox id={`${fieldId}-closed`} checked={confirmClosedDays} onCheckedChange={value => setConfirmClosedDays(value === true)} disabled={pending} /><Label htmlFor={`${fieldId}-closed`} className="text-sm leading-5">{t("confirmClosedDays")}</Label></div>
            <Label htmlFor={`${fieldId}-reason`}>{t("reason")}</Label>
            <Textarea id={`${fieldId}-reason`} value={closedDayReason} onChange={event => setClosedDayReason(event.target.value)} maxLength={500} rows={2} disabled={pending} />
          </div>}
        </div>}
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={apply.pending} onClick={() => { request.current++; setLoading(false); setPreview(null); setOpen(false); }}>{t("cancel")}</Button>
          <Button type="button" disabled={pending || !preview || !validDays || (hasClosedDays && (!confirmClosedDays || !closedDayReason.trim()))} onClick={() => {
            if (preview) apply.run({ sessionId, days: preview.days, expectedToken: preview.token, confirmClosedDays, closedDayReason });
          }}>{apply.pending && <LoaderCircle size={14} className="animate-spin" />}{t("confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
