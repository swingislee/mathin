"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LoaderCircle, Search, ShieldAlert, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import type { AccountSupportSnapshot, AccountSupportTarget } from "./account-security";
import {
  issueStaffInvitationAction,
  lookupAccountSupportTargetAction,
  manageAccountRequestAction,
  prepareUserRightsExportAction,
  revokeStaffInvitationAction,
  revokeUserSessionsAction,
  sendRecoveryAction,
  setAccountLockAction,
} from "./actions";

type OpenRequest = AccountSupportSnapshot["openRequests"][number];

export function AccountSupportPanel({ snapshot }: { snapshot: AccountSupportSnapshot }) {
  const t = useTranslations("account.support");
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [target, setTarget] = useState<AccountSupportTarget | null>(null);
  const [looked, setLooked] = useState(false);
  const [reason, setReason] = useState("");
  const [inviteIdentifierType, setInviteIdentifierType] = useState<"email" | "phone">("email");
  const [inviteIdentifier, setInviteIdentifier] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [requestStatus, setRequestStatus] = useState("identity_verified");
  const [verification, setVerification] = useState("verified");
  const [decisionReason, setDecisionReason] = useState("");
  const [resultSummary, setResultSummary] = useState("");
  const [evidenceHash, setEvidenceHash] = useState("");

  const errors = {
    LAST_ACTIVE_ADMIN: t("lastAdmin"),
    ACCOUNT_EXISTS: t("accountExists"),
    INVITATION_ALREADY_PENDING: t("invitePending"),
    IDENTITY_NOT_VERIFIED: t("identityRequired"),
    EVIDENCE_REQUIRED: t("evidenceRequired"),
    EXPORT_ARTIFACT_REQUIRED: t("exportArtifactRequired"),
    REQUEST_NOT_APPROVED: t("exportApprovalRequired"),
    default: t("actionFailed"),
  };
  const lookupRun = useAction(lookupAccountSupportTargetAction, {
    successMessage: t("targetLoaded"),
    errorMessage: errors,
    onSuccess: (value) => { setTarget(value); setLooked(true); },
  });
  const lockRun = useAction(setAccountLockAction, { successMessage: t("accountStatusSaved"), errorMessage: errors, onSuccess: () => { router.refresh(); void lookupRun.run(email); } });
  const revokeRun = useAction(revokeUserSessionsAction, { successMessage: t("sessionsRevoked"), errorMessage: errors, onSuccess: () => router.refresh() });
  const recoveryRun = useAction(sendRecoveryAction, { successMessage: t("recoverySent"), errorMessage: errors, onSuccess: () => router.refresh() });
  const inviteRun = useAction(issueStaffInvitationAction, { successMessage: t("inviteCreated"), errorMessage: errors, onSuccess: (value) => { setInviteCode(value.inviteCode); setInviteIdentifier(""); router.refresh(); } });
  const revokeInviteRun = useAction(revokeStaffInvitationAction, { successMessage: t("inviteRevoked"), errorMessage: errors, onSuccess: () => router.refresh() });
  const requestRun = useAction(manageAccountRequestAction, { successMessage: t("requestSaved"), errorMessage: errors, onSuccess: () => { setRequest(null); router.refresh(); } });
  const prepareExportRun = useAction(prepareUserRightsExportAction, { successMessage: t("exportPrepared"), errorMessage: errors, onSuccess: () => { setRequest(null); router.refresh(); } });
  const pending = lookupRun.pending || lockRun.pending || revokeRun.pending || recoveryRun.pending;

  const openRequest = (row: OpenRequest) => {
    setRequest(row);
    setRequestStatus(row.status === "submitted" ? "identity_verified" : row.status);
    setVerification(row.identityVerification === "pending" ? "verified" : row.identityVerification);
    setDecisionReason(""); setResultSummary(""); setEvidenceHash("");
  };

  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-line bg-card p-5"><p className="text-sm text-muted">{t("activeAdmins")}</p><p className="mt-2 font-display text-3xl">{snapshot.activeAdmins}</p></div>
      <div className="rounded-2xl border border-line bg-card p-5"><p className="text-sm text-muted">{t("adminsWithoutMfa")}</p><p className={`mt-2 font-display text-3xl ${snapshot.adminsWithoutMfa > 0 ? "text-rose" : "text-ink"}`}>{snapshot.adminsWithoutMfa}</p></div>
    </section>

    <section className="rounded-2xl border border-line bg-card p-5">
      <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-5 text-crater"/><div><h2 className="font-medium">{t("targetTitle")}</h2><p className="mt-1 text-sm text-muted">{t("targetIntro")}</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("email")} className="min-w-64 flex-1"/><Button disabled={lookupRun.pending || !email.trim()} onClick={() => { setLooked(false); setTarget(null); lookupRun.run(email); }}><Search className="size-4"/>{t("lookup")}</Button></div>
      {looked && !target && <p className="mt-4 text-sm text-muted">{t("targetMissing")}</p>}
      {target && <div className="mt-4 rounded-xl border border-line bg-background/45 p-4">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{target.displayName}</span><span className="text-sm text-muted">{target.email}</span><span className="rounded-full bg-line/50 px-2 py-0.5 text-xs">{t(`identity_${target.identity}`)}</span><span className="rounded-full bg-line/50 px-2 py-0.5 text-xs">{t(`account_${target.accountStatus}`)}</span><span className="rounded-full bg-line/50 px-2 py-0.5 text-xs">{target.mfaVerified ? t("mfaVerified") : t("mfaMissing")}</span></div>
        <Label htmlFor="support-reason" className="mt-4 block">{t("reason")}</Label><Input id="support-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder={t("reasonHint")} className="mt-2"/>
        <div className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" disabled={pending || !reason.trim()} onClick={() => revokeRun.run(target.userId, reason)}>{t("revokeSessions")}</Button><Button variant="secondary" disabled={pending || !reason.trim()} onClick={() => recoveryRun.run(target.userId, reason, locale)}>{t("sendRecovery")}</Button><Button variant="primary" disabled={pending || !reason.trim()} onClick={() => lockRun.run(target.userId, target.accountStatus === "active", reason)}>{target.accountStatus === "active" ? t("ban") : t("restore")}</Button></div>
      </div>}
    </section>

    <section className="rounded-2xl border border-line bg-card p-5">
      <div className="flex items-start gap-3"><UserPlus className="mt-0.5 size-5 text-crater"/><div><h2 className="font-medium">{t("inviteTitle")}</h2><p className="mt-1 text-sm text-muted">{t("inviteIntro")}</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Select value={inviteIdentifierType} onValueChange={(value) => { setInviteIdentifierType(value as "email" | "phone"); setInviteIdentifier(""); setInviteCode(null); }}>
          <SelectTrigger className="w-32"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="email">{t("email")}</SelectItem><SelectItem value="phone">{t("phone")}</SelectItem></SelectContent>
        </Select>
        <Input type={inviteIdentifierType === "email" ? "email" : "tel"} inputMode={inviteIdentifierType === "email" ? "email" : "tel"} value={inviteIdentifier} onChange={(event) => setInviteIdentifier(event.target.value)} placeholder={inviteIdentifierType === "email" ? t("email") : t("phonePlaceholder")} className="min-w-64 flex-1"/>
        <Button disabled={inviteRun.pending || !inviteIdentifier.trim()} onClick={() => inviteRun.run(inviteIdentifierType, inviteIdentifier, 7)}>{inviteRun.pending && <LoaderCircle className="size-4 animate-spin"/>}{t("createInvite")}</Button>
      </div>
      {inviteCode && <div role="status" className="mt-4 rounded-xl border border-crater/30 bg-moon/25 p-4"><p className="text-sm text-muted">{t("inviteCodeHint")}</p><p className="mt-2 break-all font-mono text-xl tracking-[0.12em]">{inviteCode}</p></div>}
      {snapshot.pendingInvitations.length > 0 && <ul className="mt-4 divide-y divide-line border-t border-line">{snapshot.pendingInvitations.map((invite) => <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="rounded-full bg-line/50 px-2 py-0.5 text-xs">{t(invite.identifierType)}</span><span className="font-medium">{invite.identifier}</span><span className="text-muted">{t("expires", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(invite.expiresAt)) })}</span><Button className="ml-auto" size="sm" variant="ghost" disabled={revokeInviteRun.pending} onClick={() => revokeInviteRun.run(invite.id, t("operatorRevoked"))}>{t("revokeInvite")}</Button></li>)}</ul>}
    </section>

    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="p-5"><h2 className="font-medium">{t("requestsTitle")}</h2><p className="mt-1 text-sm text-muted">{t("requestsIntro")}</p></div>
      <Table><TableHeader><TableRow><TableHead>{t("requestUser")}</TableHead><TableHead>{t("requestKind")}</TableHead><TableHead>{t("requestState")}</TableHead><TableHead>{t("requestDue")}</TableHead><TableHead/></TableRow></TableHeader><TableBody>{snapshot.openRequests.length === 0 ? <TableRow><TableCell colSpan={5} className="text-muted">{t("requestsEmpty")}</TableCell></TableRow> : snapshot.openRequests.map((row) => <TableRow key={row.id}><TableCell className="font-mono text-xs">{row.userId.slice(0,8)}</TableCell><TableCell>{t(`request_${row.kind}`)}</TableCell><TableCell>{t(`status_${row.status}`)}</TableCell><TableCell>{new Intl.DateTimeFormat(locale,{dateStyle:"medium"}).format(new Date(row.dueAt))}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => openRequest(row)}>{t("manage")}</Button></TableCell></TableRow>)}</TableBody></Table>
    </section>

    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="p-5"><h2 className="font-medium">{t("exportsTitle")}</h2><p className="mt-1 text-sm text-muted">{t("exportsIntro")}</p></div>
      <Table><TableHeader><TableRow><TableHead>{t("requestUser")}</TableHead><TableHead>{t("exportSubjectRole")}</TableHead><TableHead>{t("exportScope")}</TableHead><TableHead>{t("exportState")}</TableHead><TableHead>{t("exportExpiry")}</TableHead><TableHead>{t("exportDownloads")}</TableHead></TableRow></TableHeader><TableBody>{snapshot.recentExports.length === 0 ? <TableRow><TableCell colSpan={6} className="text-muted">{t("exportsEmpty")}</TableCell></TableRow> : snapshot.recentExports.map((row) => <TableRow key={row.id}><TableCell className="font-mono text-xs">{row.userId.slice(0,8)}</TableCell><TableCell>{t(`identity_${row.subjectRole}`)}</TableCell><TableCell>{t(`scope_${row.dataScope}`)}</TableCell><TableCell>{t(`exportStatus_${row.status}`)}</TableCell><TableCell>{new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(row.expiresAt))}</TableCell><TableCell>{row.downloadCount}</TableCell></TableRow>)}</TableBody></Table>
      {snapshot.recentOperationalExports.length > 0 && <div className="border-t border-line p-5"><h3 className="text-sm font-medium">{t("operationalExportsTitle")}</h3><ul className="mt-3 space-y-2">{snapshot.recentOperationalExports.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-2 text-xs text-muted"><span>{t("solutionRecordWebp")}</span><span className="font-mono">{row.resourceId.slice(0,8)}</span><span>{Math.max(1,Math.ceil(row.sizeBytes/1024))} KB</span><span className="ml-auto">{new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short"}).format(new Date(row.downloadedAt))}</span></li>)}</ul></div>}
    </section>

    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="p-5"><h2 className="font-medium">{t("auditTitle")}</h2><p className="mt-1 text-sm text-muted">{t("auditIntro")}</p></div>
      <Table><TableHeader><TableRow><TableHead>{t("auditTime")}</TableHead><TableHead>{t("auditAction")}</TableHead><TableHead>{t("auditTarget")}</TableHead><TableHead>{t("auditResult")}</TableHead></TableRow></TableHeader><TableBody>{snapshot.recentAudits.length === 0 ? <TableRow><TableCell colSpan={4} className="text-muted">{t("auditEmpty")}</TableCell></TableRow> : snapshot.recentAudits.map((row) => <TableRow key={row.id}><TableCell>{new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short"}).format(new Date(row.createdAt))}</TableCell><TableCell>{t(`action_${row.actionType}`)}</TableCell><TableCell className="font-mono text-xs">{row.targetUserId.slice(0,8)}</TableCell><TableCell>{t(`result_${row.result}`)}</TableCell></TableRow>)}</TableBody></Table>
    </section>

    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && setRequest(null)}><DialogContent><DialogHeader><DialogTitle>{t("manageRequest")}</DialogTitle></DialogHeader><div className="grid gap-3"><Label>{t("requestState")}</Label><Select value={requestStatus} onValueChange={setRequestStatus}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{(request?.kind === "export" ? ["identity_verified","approved","processing","rejected","cancelled"] : ["identity_verified","approved","processing","completed","rejected","cancelled"]).map((value)=><SelectItem key={value} value={value}>{t(`status_${value}`)}</SelectItem>)}</SelectContent></Select><Label>{t("identityVerification")}</Label><Select value={verification} onValueChange={setVerification}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["pending","verified","rejected"].map((value)=><SelectItem key={value} value={value}>{t(`verification_${value}`)}</SelectItem>)}</SelectContent></Select><Input value={decisionReason} onChange={(event)=>setDecisionReason(event.target.value)} placeholder={t("decisionReason")}/><Input value={resultSummary} onChange={(event)=>setResultSummary(event.target.value)} placeholder={t("resultSummary")}/>{request?.kind !== "export" && <Input value={evidenceHash} onChange={(event)=>setEvidenceHash(event.target.value.toLowerCase())} maxLength={64} placeholder={t("evidenceHash")}/>}
{request?.kind === "export" && <p className="text-xs text-muted">{t("exportArtifactHint")}</p>}</div><DialogFooter><Button variant="ghost" onClick={()=>setRequest(null)}>{t("cancel")}</Button>{request?.kind === "export" && ["approved","processing"].includes(request.status) && <Button variant="secondary" disabled={prepareExportRun.pending} onClick={()=>prepareExportRun.run(request.id)}>{prepareExportRun.pending && <LoaderCircle className="size-4 animate-spin"/>}{t("prepareExport")}</Button>}<Button disabled={requestRun.pending} onClick={()=>request&&requestRun.run({requestId:request.id,status:requestStatus,identityVerification:verification,decisionReason,resultSummary,evidenceHash})}>{t("save")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
