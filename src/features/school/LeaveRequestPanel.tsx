"use client";

import { CalendarClock, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { submitSessionLeaveRequestAction } from "./customer-actions";
import type { MyLeaveRequest } from "./customer";

export interface LeaveSessionOption {
  id: string;
  label: string;
}

export function LeaveRequestPanel({
  studentId,
  sessions,
  requests,
}: {
  studentId: string;
  sessions: LeaveSessionOption[];
  requests: MyLeaveRequest[];
}) {
  const t = useTranslations("school.customer");
  const router = useRouter();
  const pendingSessionIds = useMemo(() => new Set(requests.filter((request) => request.status === "pending").map((request) => request.sessionId)), [requests]);
  const availableSessions = sessions.filter((session) => !pendingSessionIds.has(session.id));
  const [sessionId, setSessionId] = useState(availableSessions[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => startTransition(async () => {
    const result = await submitSessionLeaveRequestAction({ sessionId, studentId, reason });
    if (!result.ok) {
      setMessage(result.code === "SESSION_NOT_LEAVABLE" ? t("leaveTooLate") : t("leaveFailed"));
      return;
    }
    setReason("");
    setMessage(t("leaveSubmitted"));
    router.refresh();
  });

  return (
    <section id="leave" className="scroll-mt-24 rounded-2xl border border-line bg-card p-5">
      <h2 className="flex items-center gap-2 text-base font-medium"><CalendarClock size={18} />{t("leaveTitle")}</h2>
      <p className="mt-1 text-xs text-muted">{t("leaveIntro")}</p>
      {availableSessions.length > 0 ? (
        <div className="mt-4 space-y-3">
          <Select value={sessionId} onValueChange={setSessionId}>
            <SelectTrigger aria-label={t("leaveSession")}><SelectValue placeholder={t("leaveSession")} /></SelectTrigger>
            <SelectContent>{availableSessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.label}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} rows={3} placeholder={t("leaveReason")} />
          <Button disabled={pending || !sessionId || !reason.trim()} onClick={submit} className="gap-2">
            {pending && <LoaderCircle size={15} className="animate-spin" />}{t("leaveSubmit")}
          </Button>
        </div>
      ) : <p className="mt-4 text-sm text-muted">{t("leaveNoSessions")}</p>}
      {requests.length > 0 && (
        <ul className="mt-5 divide-y divide-line border-t border-line">
          {requests.slice(0, 8).map((request) => (
            <li key={request.id} className="py-3 text-sm">
              <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate font-medium">{request.sessionTitle}</span><span className="shrink-0 text-xs text-muted">{t(`leaveStatus_${request.status}`)}</span></div>
              <p className="mt-1 line-clamp-2 text-xs text-muted">{request.reason}</p>
              {request.makeupStatus && (
                <p className="mt-1 text-xs text-muted">
                  <span className="font-medium text-ink">{t(`leaveMakeup_${request.makeupStatus}`)}</span>
                  {request.makeupScheduledAt && request.makeupStatus !== "to_schedule" && (
                    <>
                      {" · "}
                      {new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(request.makeupScheduledAt))}
                      {request.makeupClassroomName ? ` · ${request.makeupClassroomName}` : ""}
                      {request.makeupSessionTitle ? ` · ${request.makeupSessionTitle}` : ""}
                    </>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {message && <p className="mt-3 text-xs text-muted" aria-live="polite">{message}</p>}
    </section>
  );
}