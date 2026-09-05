"use client";

import { useDashboardSearchQuery } from "./dashboard-page/DashboardPreferenceScope";

import { FollowupChoice } from "./dashboard-page/FollowupChoice";

import { FilterSearchInput } from "./FilterBar";

import { LoaderCircle, RotateCcw, UserRoundPlus } from "lucide-react";
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
  attachStudentReferralSourceAction,
  convertStudentReferralToOpportunityAction,
  createReactivationOpportunityAction,
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
import type { RenewalStaffOption, StudentReferralRow } from "./renewal-contract";
import type { GrowthWorkspaceData } from "./renewals";
import { FollowupTabs } from "./FollowupTabs";

function localDateTime(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function LongTermGrowthWorkspace({ data, owners, canWrite }: {
  data: GrowthWorkspaceData;
  owners: RenewalStaffOption[];
  canWrite: boolean;
}) {
  const t = useTranslations("school.renewals");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useDashboardSearchQuery("renewal-growth");
  const needle = query.trim().toLocaleLowerCase(locale);
  const reactivationRows = useMemo(() => data.reactivationOpportunities.filter((row) => !needle || [row.studentName, row.courseTitle, row.termName, row.ownerName, row.nextAction].some((value) => value.toLocaleLowerCase(locale).includes(needle))), [data.reactivationOpportunities, locale, needle]);
  const referralRows = useMemo(() => data.referrals.filter((row) => !needle || [row.referrerStudentName, row.referredLeadName, row.leadOwnerName, row.relationship, row.note].some((value) => value.toLocaleLowerCase(locale).includes(needle))), [data.referrals, locale, needle]);
  const activeReactivations = data.reactivationOpportunities.filter((row) => !["enrolled", "not_enrolled"].includes(row.stage)).length;

  return <DashboardPage
    title={t("reactivationAndReferrals")}
    description={t("growthIntro")}
    commandPanel={<DashboardCommandPanel>
      <DashboardCommandState><FollowupTabs /><span className="text-xs text-muted">{t("activeReactivations")} {activeReactivations} · {t("referralsCaptured")} {data.referrals.length} · {t("referralsReady")} {data.referrals.filter((row) => row.referredLeadStatus === "converted" && !row.opportunityId).length} · {t("referralOpportunities")} {data.referrals.filter((row) => row.opportunityId).length}</span></DashboardCommandState>
      <DashboardCommandFilters><FilterSearchInput className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("growthSearchPlaceholder")} /></DashboardCommandFilters>
      {canWrite ? <DashboardCommandActions>
        <CreateReactivationDialog data={data} owners={owners} onSaved={() => router.refresh()} />
        <CreateReferralDialog data={data} leads={data.leads} onSaved={() => router.refresh()} />
      </DashboardCommandActions> : null}
    </DashboardCommandPanel>}
  >


    <DashboardSection>
      <DashboardTableShell><Table className="min-w-[62rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-12rem)] overflow-auto">
        <TableHeader className="sticky top-0 z-20 bg-card"><TableRow><TableHead>{t("student")}</TableHead><TableHead>{t("targetProduct")}</TableHead><TableHead>{t("stage")}</TableHead><TableHead>{t("owner")}</TableHead><TableHead>{t("nextAction")}</TableHead><TableHead>{t("nextActionAt")}</TableHead><TableHead className="text-right">{t("details")}</TableHead></TableRow></TableHeader>
        <TableBody>
          {reactivationRows.map((row) => <TableRow key={row.id} className="h-10 [&>td]:px-2 [&>td]:py-1 [&>td]:truncate">
            <TableCell className="font-medium text-ink">{row.studentName}</TableCell>
            <TableCell><p>{row.courseTitle}</p><p className="text-xs text-muted">{row.termName}</p></TableCell>
            <TableCell><Badge variant="outline">{t(`stage_${row.stage}`)}</Badge></TableCell>
            <TableCell>{row.ownerName}</TableCell>
            <TableCell className="max-w-72 whitespace-normal">{row.nextAction || "—"}</TableCell>
            <TableCell>{localDateTime(row.nextActionAt, locale)}</TableCell>
            <TableCell className="text-right"><Link className={cn(buttonVariants({ size: "sm", variant: "ghost" }))} href={`/dashboard/followups/renewals/${row.id}`}>{t("openDetail")}</Link></TableCell>
          </TableRow>)}
          {reactivationRows.length === 0 ? <TableRow><TableCell colSpan={7} className="h-36 text-center text-muted">{t("emptyReactivations")}</TableCell></TableRow> : null}
        </TableBody>
      </Table></DashboardTableShell>
    </DashboardSection>

    <DashboardSection>
      <DashboardTableShell><Table className="min-w-[76rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-12rem)] overflow-auto">
        <TableHeader className="sticky top-0 z-20 bg-card"><TableRow><TableHead>{t("referrer")}</TableHead><TableHead>{t("referredLead")}</TableHead><TableHead>{t("relationship")}</TableHead><TableHead>{t("leadOwner")}</TableHead><TableHead>{t("leadStatus")}</TableHead><TableHead>{t("note")}</TableHead><TableHead className="text-right">{t("actions")}</TableHead></TableRow></TableHeader>
        <TableBody>
          {referralRows.map((referral) => <TableRow key={referral.id} className="h-10 [&>td]:px-2 [&>td]:py-1 [&>td]:truncate">
            <TableCell><p className="font-medium text-ink">{referral.referrerStudentName}</p><p className="text-xs text-muted">{referral.referrerContactName || referral.referrerFamilyName || "—"}</p></TableCell>
            <TableCell><p>{referral.referredLeadName}</p><p className="text-xs text-muted">{t(`leadStatus_${referral.referredLeadStatus}`)}</p></TableCell>
            <TableCell>{referral.relationship || "—"}</TableCell>
            <TableCell>{referral.leadOwnerName || t("unassigned")}</TableCell>
            <TableCell><Badge variant={referral.referredLeadStatus === "intent_confirmed" ? "secondary" : "outline"}>{t(`leadStatus_${referral.referredLeadStatus}`)}</Badge></TableCell>
            <TableCell className="max-w-72 whitespace-normal">{referral.note || "—"}</TableCell>
            <TableCell className="text-right"><div className="flex justify-end gap-1">
              {canWrite && !referral.opportunityId && referral.referredLeadStatus === "converted" ? <ConvertReferralDialog referral={referral} data={data} owners={owners} onSaved={() => router.refresh()} /> : null}
              {referral.opportunityId ? <Link className={cn(buttonVariants({ size: "sm", variant: "ghost" }))} href={`/dashboard/followups/renewals/${referral.opportunityId}`}>{t("openOpportunity")}</Link> : <Link className={cn(buttonVariants({ size: "sm", variant: "ghost" }))} href="/dashboard/followups/leads">{t("openLead")}</Link>}
            </div></TableCell>
          </TableRow>)}
          {referralRows.length === 0 ? <TableRow><TableCell colSpan={7} className="h-36 text-center text-muted">{t("emptyReferrals")}</TableCell></TableRow> : null}
        </TableBody>
      </Table></DashboardTableShell>
    </DashboardSection>
  </DashboardPage>;
}

function CreateReactivationDialog({ data, owners, onSaved }: { data: GrowthWorkspaceData; owners: RenewalStaffOption[]; onSaved: () => void }) {
  const t = useTranslations("school.renewals");
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? "");
  const [termId, setTermId] = useState(data.terms[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? "");
  const [nextAction, setNextAction] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [note, setNote] = useState("");
  const existing = new Set(data.reactivationOpportunities.filter((row) => !["enrolled", "not_enrolled"].includes(row.stage)).map((row) => row.studentId));
  const candidates = data.reactivationStudents.filter((student) => !existing.has(student.id));
  const action = useAction(createReactivationOpportunityAction, {
    successMessage: t("reactivationCreated"),
    errorMessage: opportunityErrors(t),
    onSuccess: () => { setOpen(false); onSaved(); },
  });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="secondary"><RotateCcw className="size-4" />{t("newReactivation")}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{t("newReactivation")}</DialogTitle><DialogDescription>{t("newReactivationHint")}</DialogDescription></DialogHeader>
      <OpportunityFields t={t} students={candidates} studentId={studentId} onStudentId={setStudentId} data={data} courseId={courseId} onCourseId={setCourseId} termId={termId} onTermId={setTermId} owners={owners} ownerId={ownerId} onOwnerId={setOwnerId} nextAction={nextAction} onNextAction={setNextAction} nextActionAt={nextActionAt} onNextActionAt={setNextActionAt} note={note} onNote={setNote} />
      <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={action.pending || !studentId || !courseId || !termId || !ownerId || !nextAction.trim() || !nextActionAt} onClick={() => action.run({ studentId, courseId, termId, ownerId, nextAction, nextActionAt, note })}>{action.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("create")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CreateReferralDialog({ data, leads, onSaved }: { data: GrowthWorkspaceData; leads: GrowthWorkspaceData["leads"]; onSaved: () => void }) {
  const t = useTranslations("school.renewals");
  const [open, setOpen] = useState(false);
  const [leadMode, setLeadMode] = useState<"existing" | "new">("existing");
  const [referrerId, setReferrerId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadPhone, setNewLeadPhone] = useState("");
  const [newLeadGrade, setNewLeadGrade] = useState("");
  const [relationship, setRelationship] = useState("");
  const [note, setNote] = useState("");
  const referrer = data.referrers.find((row) => row.studentId === referrerId) ?? null;
  const selectableLeads = leads.filter((row) => !data.referrals.some((referral) => referral.referrerStudentId === referrerId && referral.referredLeadId === row.id));
  const lead = selectableLeads.find((row) => row.id === leadId) ?? null;
  const action = useAction(attachStudentReferralSourceAction, {
    successMessage: t("referralCaptured"),
    errorMessage: {
      default: t("actionFailed"), LEAD_ALREADY_REFERRED: t("leadAlreadyReferred"), FORBIDDEN_SCOPE: t("referrerScopeForbidden"),
      LEAD_SCOPE_MISMATCH: t("leadScopeMismatch"),
    },
    onSuccess: () => { setOpen(false); onSaved(); },
  });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm"><UserRoundPlus className="size-4" />{t("captureReferral")}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{t("captureReferral")}</DialogTitle><DialogDescription>{t("captureReferralHint")}</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Label>{t("referrer")}<Select value={referrerId} onValueChange={setReferrerId}><SelectTrigger className="mt-1"><SelectValue placeholder={t("chooseReferrer")} /></SelectTrigger><SelectContent>{data.referrers.map((row) => <SelectItem key={row.studentId} value={row.studentId}>{row.studentName}{row.contactName ? ` · ${row.contactName}` : ""}</SelectItem>)}</SelectContent></Select></Label>
        <Label>{t("leadMode")}<Select value={leadMode} onValueChange={(value) => setLeadMode(value as "existing" | "new")}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="existing">{t("reuseExistingLead")}</SelectItem><SelectItem value="new">{t("createLeadSeed")}</SelectItem></SelectContent></Select></Label>
        {leadMode === "existing" ? <Label className="sm:col-span-2">{t("referredLead")}<Select value={leadId} onValueChange={setLeadId}><SelectTrigger className="mt-1"><SelectValue placeholder={t("chooseLead")} /></SelectTrigger><SelectContent>{selectableLeads.map((row) => <SelectItem key={row.id} value={row.id}>{row.name} · {row.phone}</SelectItem>)}</SelectContent></Select></Label> : <>
          <Label>{t("newLeadName")}<Input className="mt-1" value={newLeadName} onChange={(event) => setNewLeadName(event.target.value)} maxLength={100} /></Label>
          <Label>{t("newLeadPhone")}<Input className="mt-1" value={newLeadPhone} onChange={(event) => setNewLeadPhone(event.target.value)} maxLength={40} inputMode="tel" /></Label>
          <Label>{t("newLeadGrade")}<Select value={newLeadGrade || "unknown"} onValueChange={(value) => setNewLeadGrade(value === "unknown" ? "" : value)}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">{t("gradeUnknown")}</SelectItem>{Array.from({ length: 12 }, (_, index) => index + 1).map((grade) => <SelectItem key={grade} value={String(grade)}>{t("grade", { grade })}</SelectItem>)}</SelectContent></Select></Label>
          <p className="self-end pb-2 text-xs text-muted">{t("newLeadSeedHint")}</p>
        </>}
        <Label className="sm:col-span-2">{t("relationship")}<Input className="mt-1" value={relationship} onChange={(event) => setRelationship(event.target.value)} maxLength={120} placeholder={t("relationshipPlaceholder")} /></Label>
        <Label className="sm:col-span-2">{t("note")}<Textarea className="mt-1" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} /></Label>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={action.pending || !referrer || (leadMode === "existing" ? !lead : !newLeadName.trim() || !newLeadPhone.trim())} onClick={() => referrer && action.run({ referrerStudentId: referrer.studentId, referrerFamilyId: referrer.familyId, referrerContactId: referrer.contactId, referredLeadId: leadMode === "existing" ? lead?.id ?? null : null, referredSourceRecordId: leadMode === "existing" ? lead?.sourceRecordId ?? null : null, newLeadName: leadMode === "new" ? newLeadName : null, newLeadPhone: leadMode === "new" ? newLeadPhone : null, newLeadGradeHint: leadMode === "new" && newLeadGrade ? Number(newLeadGrade) : null, relationship, note })}>{action.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("capture")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ConvertReferralDialog({ referral, data, owners, onSaved }: { referral: StudentReferralRow; data: GrowthWorkspaceData; owners: RenewalStaffOption[]; onSaved: () => void }) {
  const t = useTranslations("school.renewals");
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? "");
  const [termId, setTermId] = useState(data.terms[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState(owners.some((owner) => owner.id === referral.leadOwnerId) ? referral.leadOwnerId ?? "" : owners[0]?.id ?? "");
  const [nextAction, setNextAction] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [note, setNote] = useState(referral.note);
  const action = useAction(convertStudentReferralToOpportunityAction, {
    successMessage: t("referralOpportunityCreated"),
    errorMessage: { ...opportunityErrors(t), LEAD_IDENTITY_REQUIRED: t("leadIdentityRequired") },
    onSuccess: () => { setOpen(false); onSaved(); },
  });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm">{t("createOpportunity")}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{t("createReferralOpportunity", { name: referral.referredLeadName })}</DialogTitle><DialogDescription>{t("createReferralOpportunityHint")}</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Label>{t("targetCourse")}<FollowupChoice label={t("targetCourse")} value={courseId} onValueChange={setCourseId} options={data.courses.map((course) => ({ value: course.id, label: course.title }))} className="mt-1 w-full" /></Label>
        <Label>{t("targetTerm")}<FollowupChoice label={t("targetTerm")} value={termId} onValueChange={setTermId} options={data.terms.map((term) => ({ value: term.id, label: term.name }))} className="mt-1 w-full" /></Label>
        <Label>{t("owner")}<FollowupChoice label={t("owner")} value={ownerId} onValueChange={setOwnerId} options={owners.map((owner) => ({ value: owner.id, label: owner.name }))} className="mt-1 w-full" /></Label>
        <Label>{t("nextActionAt")}<DateTimePicker className="mt-1" mode="datetime" value={nextActionAt} onValueChange={setNextActionAt} /></Label>
        <Label className="sm:col-span-2">{t("nextAction")}<Input className="mt-1" value={nextAction} onChange={(event) => setNextAction(event.target.value)} maxLength={500} /></Label>
        <Label className="sm:col-span-2">{t("note")}<Textarea className="mt-1" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} /></Label>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button><Button disabled={action.pending || !courseId || !termId || !ownerId || !nextAction.trim() || !nextActionAt} onClick={() => action.run({ referralId: referral.id, courseId, termId, ownerId, nextAction, nextActionAt, note })}>{action.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("createOpportunity")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function OpportunityFields({ t, students, studentId, onStudentId, data, courseId, onCourseId, termId, onTermId, owners, ownerId, onOwnerId, nextAction, onNextAction, nextActionAt, onNextActionAt, note, onNote }: {
  t: ReturnType<typeof useTranslations<"school.renewals">>;
  students: GrowthWorkspaceData["reactivationStudents"];
  studentId: string; onStudentId: (value: string) => void;
  data: GrowthWorkspaceData; courseId: string; onCourseId: (value: string) => void;
  termId: string; onTermId: (value: string) => void; owners: RenewalStaffOption[];
  ownerId: string; onOwnerId: (value: string) => void; nextAction: string; onNextAction: (value: string) => void;
  nextActionAt: string; onNextActionAt: (value: string) => void; note: string; onNote: (value: string) => void;
}) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Label className="sm:col-span-2">{t("student")}<Select value={studentId} onValueChange={onStudentId}><SelectTrigger className="mt-1"><SelectValue placeholder={t("chooseLostStudent")} /></SelectTrigger><SelectContent>{students.map((student) => <SelectItem key={student.id} value={student.id}>{student.name}{student.grade !== null ? ` · ${t("grade", { grade: student.grade })}` : ""}</SelectItem>)}</SelectContent></Select></Label>
    <Label>{t("targetCourse")}<FollowupChoice label={t("targetCourse")} value={courseId} onValueChange={onCourseId} options={data.courses.map((course) => ({ value: course.id, label: course.title }))} className="mt-1 w-full" /></Label>
    <Label>{t("targetTerm")}<FollowupChoice label={t("targetTerm")} value={termId} onValueChange={onTermId} options={data.terms.map((term) => ({ value: term.id, label: term.name }))} className="mt-1 w-full" /></Label>
    <Label>{t("owner")}<FollowupChoice label={t("owner")} value={ownerId} onValueChange={onOwnerId} options={owners.map((owner) => ({ value: owner.id, label: owner.name }))} className="mt-1 w-full" /></Label>
    <Label>{t("nextActionAt")}<DateTimePicker className="mt-1" mode="datetime" value={nextActionAt} onValueChange={onNextActionAt} /></Label>
    <Label className="sm:col-span-2">{t("nextAction")}<Input className="mt-1" value={nextAction} onChange={(event) => onNextAction(event.target.value)} maxLength={500} /></Label>
    <Label className="sm:col-span-2">{t("note")}<Textarea className="mt-1" rows={3} value={note} onChange={(event) => onNote(event.target.value)} maxLength={2000} /></Label>
  </div>;
}

function opportunityErrors(t: ReturnType<typeof useTranslations<"school.renewals">>) {
  return {
    default: t("actionFailed"),
    FORBIDDEN_OWNER_ASSIGNMENT: t("ownerAssignmentForbidden"),
    OWNER_NOT_AVAILABLE: t("ownerUnavailable"),
    COURSE_NOT_AVAILABLE: t("courseUnavailable"),
    TERM_NOT_FOUND: t("termUnavailable"),
    OPPORTUNITY_TARGET_CONFLICT: t("opportunityTargetConflict"),
  };
}
