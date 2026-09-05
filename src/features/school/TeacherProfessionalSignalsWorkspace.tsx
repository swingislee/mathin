"use client";

import { useDashboardSearchQuery } from "./dashboard-page/DashboardPreferenceScope";

import { FilterSearchInput } from "./FilterBar";
import { DashboardTableColumnHeader, useDashboardTableView } from "./dashboard-page";
import { FollowupChoice, followupToneClasses } from "./dashboard-page/FollowupChoice";

import { ClipboardCheck, LoaderCircle, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  createTeacherProfessionalSignalAction,
  resolveTeacherProfessionalSignalAction,
} from "./actions/renewals";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardPage,
  DashboardSection,
  DashboardTableShell,
} from "./dashboard-page";
import type {
  RenewalStaffOption,
  TeacherProfessionalSignalRow,
  TeacherProfessionalSignalStatus,
  TeacherProfessionalSignalType,
} from "./renewal-contract";
import { TEACHER_PROFESSIONAL_SIGNAL_TYPES } from "./renewal-contract";
import type { ProfessionalSignalsData } from "./renewals";
import { FollowupTabs } from "./FollowupTabs";

const NONE = "__none__";

function localDateTime(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function TeacherProfessionalSignalsWorkspace({
  data,
  owners,
  canCreate,
  canResolve,
}: {
  data: ProfessionalSignalsData;
  owners: RenewalStaffOption[];
  canCreate: boolean;
  canResolve: boolean;
}) {
  const t = useTranslations("school.renewals");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useDashboardSearchQuery("renewal-signals");
  const needle = query.trim().toLocaleLowerCase(locale);
  const visible = useMemo(() => data.signals.filter((signal) => {
    if (!needle) return true;
    return [
      signal.studentName,
      signal.sourceClassroomName,
      signal.sourceSessionTitle,
      signal.sourceTeacherName,
      signal.recommendation,
      signal.suggestedCourseTitle,
    ].some((value) => value.toLocaleLowerCase(locale).includes(needle));
  }), [data.signals, locale, needle]);
  const table = useDashboardTableView({ rows: visible, locale, persistenceKey: "followup-renewal-signals", columns: {
    student: { filterValues: (row: TeacherProfessionalSignalRow) => ({ value: row.studentId, label: row.studentName }), sortValue: (row: TeacherProfessionalSignalRow) => row.studentName },
    type: { filterValues: (row: TeacherProfessionalSignalRow) => ({ value: row.signalType, label: t("signalType_" + row.signalType) }), sortValue: (row: TeacherProfessionalSignalRow) => row.signalType },
    teacher: { filterValues: (row: TeacherProfessionalSignalRow) => ({ value: row.sourceTeacherId, label: row.sourceTeacherName }), sortValue: (row: TeacherProfessionalSignalRow) => row.sourceTeacherName },
    status: { filterValues: (row: TeacherProfessionalSignalRow) => ({ value: row.status, label: t("signalStatus_" + row.status) }), sortValue: (row: TeacherProfessionalSignalRow) => row.status },
  } });
  const count = (value: TeacherProfessionalSignalStatus) => data.signals.filter((signal) => signal.status === value).length;

  return <DashboardPage
    title={t("teacherSignals")}
    description={t("teacherSignalsIntro")}
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandState><FollowupTabs /><span className="text-xs text-muted">{t("signalStatus_pending")} {count("pending")} · {t("signalStatus_accepted")} {count("accepted")} · {t("signalStatus_dismissed")} {count("dismissed")} · {t("signalStatus_all")} {data.signals.length}</span></DashboardCommandState>
      <DashboardCommandFilters>
        <FilterSearchInput className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("signalSearchPlaceholder")} />
      </DashboardCommandFilters>
      {canCreate ? <DashboardCommandActions><CreateSignalDialog data={data} onSaved={() => router.refresh()} /></DashboardCommandActions> : null}
    </DashboardCommandPanel>}
  >


    <DashboardSection>
      <DashboardTableShell>
        <Table className="min-w-[76rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-12rem)] overflow-auto">
          <TableHeader className="sticky top-0 z-20 bg-card"><TableRow>
            <TableHead><DashboardTableColumnHeader label={t("student")} {...table.columnProps("student")} /></TableHead>
            <TableHead><DashboardTableColumnHeader label={t("signalType")} {...table.columnProps("type")} /></TableHead>
            <TableHead>{t("sourceContext")}</TableHead>
            <TableHead>{t("recommendation")}</TableHead>
            <TableHead>{t("suggestedTarget")}</TableHead>
            <TableHead><DashboardTableColumnHeader label={t("signalSourceTeacher")} {...table.columnProps("teacher")} /></TableHead>
            <TableHead><DashboardTableColumnHeader label={t("signalStatus")} {...table.columnProps("status")} /></TableHead>
            <TableHead className="text-right">{t("actions")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {table.visibleRows.map((signal) => <TableRow key={signal.id} className="h-10 [&>td]:px-2 [&>td]:py-1 [&>td]:truncate">
              <TableCell><p className="font-medium text-ink">{signal.studentName}</p>{signal.grade !== null ? <p className="text-xs text-muted">{t("grade", { grade: signal.grade })}</p> : null}</TableCell>
              <TableCell><Badge variant="outline" className={followupToneClasses[signal.signalType === "churn_risk" ? "unhealthy" : "healthy"]}>{t(`signalType_${signal.signalType}`)}</Badge></TableCell>
              <TableCell><p>{signal.sourceClassroomName}</p><p className="text-xs text-muted">{signal.sourceSessionTitle || t("classLevelSignal")}</p></TableCell>
              <TableCell className="max-w-80 whitespace-normal"><p>{signal.recommendation}</p><p className="mt-1 text-xs text-muted">{localDateTime(signal.occurredAt, locale)}</p></TableCell>
              <TableCell><p>{signal.suggestedCourseTitle || "—"}</p><p className="text-xs text-muted">{signal.targetTermName || "—"}</p></TableCell>
              <TableCell>{signal.sourceTeacherName}</TableCell>
              <TableCell><Badge variant="outline" className={followupToneClasses[signal.status === "accepted" ? "healthy" : signal.status === "dismissed" ? "unhealthy" : "attention"]}>{t(`signalStatus_${signal.status}`)}</Badge></TableCell>
              <TableCell className="text-right">
                {signal.status === "pending" && canResolve ? <ResolveSignalDialog signal={signal} data={data} owners={owners} onSaved={() => router.refresh()} /> : null}
                {signal.opportunityId ? <Link className={cn(buttonVariants({ size: "sm", variant: "ghost" }))} href={signal.signalType === "upsell_recommendation" ? "/dashboard/opportunities" : `/dashboard/followups/renewals/${signal.opportunityId}`}>{t("openOpportunity")}</Link> : null}
                {signal.status !== "pending" && !signal.opportunityId ? <span className="text-xs text-muted">{signal.handledByName || "—"}</span> : null}
              </TableCell>
            </TableRow>)}
            {table.visibleRows.length === 0 ? <TableRow><TableCell colSpan={8} className="h-40 text-center text-muted">{t("emptySignals")}</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </DashboardSection>
  </DashboardPage>;
}

function CreateSignalDialog({ data, onSaved }: { data: ProfessionalSignalsData; onSaved: () => void }) {
  const t = useTranslations("school.renewals");
  const [open, setOpen] = useState(false);
  const [membershipId, setMembershipId] = useState("");
  const [sessionId, setSessionId] = useState(NONE);
  const [signalType, setSignalType] = useState<TeacherProfessionalSignalType>("renewal_recommendation");
  const [recommendation, setRecommendation] = useState("");
  const [courseId, setCourseId] = useState(NONE);
  const [termId, setTermId] = useState(NONE);
  const membership = data.memberships.find((row) => row.membershipId === membershipId) ?? null;
  const historicalMembership = membership?.status === "transferred_out" || membership?.status === "withdrawn";
  const sessions = membership ? data.sessions.filter((session) => {
    if (session.classroomId !== membership.classroomId) return false;
    const anchor = session.startedAt ?? session.scheduledAt;
    if (!anchor) return membership.status === "active" && membership.leftAt === null;
    return Date.parse(membership.joinedAt) <= Date.parse(anchor)
      && (membership.leftAt === null || Date.parse(membership.leftAt) > Date.parse(anchor));
  }) : [];
  const errors = {
    default: t("actionFailed"),
    INVALID_MEMBERSHIP: t("invalidMembership"),
    SIGNAL_ALREADY_HANDLED: t("signalAlreadyHandled"),
    FORBIDDEN_SCOPE: t("signalScopeForbidden"),
  };
  const action = useAction(createTeacherProfessionalSignalAction, {
    successMessage: t("signalCreated"),
    errorMessage: errors,
    onSuccess: () => {
      setOpen(false);
      setMembershipId("");
      setSessionId(NONE);
      setRecommendation("");
      setCourseId(NONE);
      setTermId(NONE);
      onSaved();
    },
  });

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm"><Sparkles className="size-4" />{t("newSignal")}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader><DialogTitle>{t("newSignal")}</DialogTitle><DialogDescription>{t("newSignalHint")}</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Label className="sm:col-span-2">{t("studentAndClass")}<Select value={membershipId} onValueChange={(value) => { setMembershipId(value); setSessionId(NONE); }}><SelectTrigger className="mt-1"><SelectValue placeholder={t("chooseStudentMembership")} /></SelectTrigger><SelectContent>{data.memberships.map((row) => <SelectItem key={row.membershipId} value={row.membershipId}>{row.studentName} · {row.classroomName}</SelectItem>)}</SelectContent></Select></Label>
        <Label>{t("sourceSession")}<Select value={sessionId} disabled={!membership} onValueChange={setSessionId}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE} disabled={historicalMembership}>{t("classLevelSignal")}</SelectItem>{sessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.title}</SelectItem>)}</SelectContent></Select>{historicalMembership ? <span className="mt-1 block text-xs font-normal text-muted">{t("historicalSignalRequiresSession")}</span> : null}</Label>
        <Label>{t("signalType")}<Select value={signalType} onValueChange={(value) => setSignalType(value as TeacherProfessionalSignalType)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{TEACHER_PROFESSIONAL_SIGNAL_TYPES.map((value) => <SelectItem key={value} value={value}>{t(`signalType_${value}`)}</SelectItem>)}</SelectContent></Select></Label>
        <Label>{t("suggestedCourse")}<Select value={courseId} onValueChange={setCourseId}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>{t("notSpecified")}</SelectItem>{data.courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.title}</SelectItem>)}</SelectContent></Select></Label>
        <Label>{t("targetTerm")}<Select value={termId} onValueChange={setTermId}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NONE}>{t("notSpecified")}</SelectItem>{data.terms.map((term) => <SelectItem key={term.id} value={term.id}>{term.name}</SelectItem>)}</SelectContent></Select></Label>
        <Label className="sm:col-span-2">{t("recommendation")}<Textarea className="mt-1" rows={5} maxLength={2000} value={recommendation} onChange={(event) => setRecommendation(event.target.value)} placeholder={t("recommendationPlaceholder")} /></Label>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={action.pending || !membership || !recommendation.trim() || (historicalMembership && sessionId === NONE)} onClick={() => membership && action.run({
        studentId: membership.studentId,
        sourceMembershipId: membership.membershipId,
        sourceSessionId: sessionId === NONE ? null : sessionId,
        signalType,
        recommendation,
        suggestedCourseId: courseId === NONE ? null : courseId,
        targetTermId: termId === NONE ? null : termId,
      })}>{action.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("create")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ResolveSignalDialog({
  signal,
  data,
  owners,
  onSaved,
}: {
  signal: TeacherProfessionalSignalRow;
  data: ProfessionalSignalsData;
  owners: RenewalStaffOption[];
  onSaved: () => void;
}) {
  const t = useTranslations("school.renewals");
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState(signal.suggestedCourseId ?? data.courses[0]?.id ?? "");
  const [termId, setTermId] = useState(signal.targetTermId ?? data.terms[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? "");
  const [nextAction, setNextAction] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [note, setNote] = useState("");
  const action = useAction(resolveTeacherProfessionalSignalAction, {
    successMessage: t("signalResolved"),
    errorMessage: {
      default: t("actionFailed"),
      SIGNAL_ALREADY_HANDLED: t("signalAlreadyHandled"),
      SIGNAL_CONTEXT_REQUIRED: t("signalContextRequired"),
      FORBIDDEN_OWNER_ASSIGNMENT: t("ownerAssignmentForbidden"),
      OWNER_NOT_AVAILABLE: t("ownerUnavailable"),
      COURSE_NOT_AVAILABLE: t("courseUnavailable"),
      TERM_NOT_FOUND: t("termUnavailable"),
    },
    onSuccess: () => { setOpen(false); onSaved(); },
  });
  const acceptReady = Boolean(courseId && termId && ownerId && nextAction.trim() && nextActionAt);

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="secondary"><ClipboardCheck className="size-4" />{t("handleSignal")}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader><DialogTitle>{t("handleSignalTitle", { name: signal.studentName })}</DialogTitle><DialogDescription>{signal.recommendation}</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Label>{t("targetCourse")}<FollowupChoice label={t("targetCourse")} value={courseId} onValueChange={setCourseId} options={data.courses.map((course) => ({ value: course.id, label: course.title }))} className="mt-1 w-full" /></Label>
        <Label>{t("targetTerm")}<FollowupChoice label={t("targetTerm")} value={termId} onValueChange={setTermId} options={data.terms.map((term) => ({ value: term.id, label: term.name }))} className="mt-1 w-full" /></Label>
        <Label>{t("owner")}<FollowupChoice label={t("owner")} value={ownerId} onValueChange={setOwnerId} options={owners.map((owner) => ({ value: owner.id, label: owner.name }))} className="mt-1 w-full" /></Label>
        <Label>{t("nextActionAt")}<DateTimePicker className="mt-1" mode="datetime" value={nextActionAt} onValueChange={setNextActionAt} /></Label>
        <Label className="sm:col-span-2">{t("nextAction")}<Input className="mt-1" maxLength={500} value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></Label>
        <Label className="sm:col-span-2">{t("resolutionNote")}<Textarea className="mt-1" rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></Label>
      </div>
      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" disabled={action.pending} onClick={() => action.run({ signalId: signal.id, resolution: "dismiss", courseId: null, termId: null, ownerId: null, nextAction: "", nextActionAt: null, note })}>{t("dismissSignal")}</Button>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={action.pending || !acceptReady} onClick={() => action.run({ signalId: signal.id, resolution: "accept", courseId, termId, ownerId, nextAction, nextActionAt, note })}>{action.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("acceptSignal")}</Button></div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
