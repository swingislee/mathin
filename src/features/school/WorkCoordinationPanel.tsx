"use client";

import { ClipboardCheck, History, ListPlus, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormEvent, useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { newId } from "@/lib/uuid";
import {
  createDurableWorkItemAction,
  requestApprovalAction,
  type CreateDurableWorkItemInput,
} from "./actions/work-items";
import type { WorkCoordinationCandidate } from "./work-items";

type Domain = CreateDurableWorkItemInput["domain"];
type Priority = CreateDurableWorkItemInput["priority"];
type SourceKind = CreateDurableWorkItemInput["sourceKind"];

const DOMAINS: Domain[] = ["operations", "teaching", "student_service", "curriculum", "finance"];
const PRIORITIES: Priority[] = ["normal", "high", "critical", "low"];
const SOURCE_KINDS: SourceKind[] = ["manual", "cross_domain", "delegation", "sla"];

function token(prefix: string) {
  return `${prefix}:${newId()}`;
}

export function WorkCoordinationPanel({
  currentUserId,
  candidates,
  canManageWorkItems,
}: {
  currentUserId: string;
  candidates: WorkCoordinationCandidate[];
  canManageWorkItems: boolean;
}) {
  const t = useTranslations("school.work");
  const router = useRouter();
  const approvalCandidates = useMemo(() => candidates.filter((candidate) => candidate.id !== currentUserId), [candidates, currentUserId]);
  const [workOpen, setWorkOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [workToken, setWorkToken] = useState(() => token("work"));
  const [approvalToken, setApprovalToken] = useState(() => token("approval"));
  const [workTitle, setWorkTitle] = useState("");
  const [workReason, setWorkReason] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [workDueAt, setWorkDueAt] = useState("");
  const [workDomain, setWorkDomain] = useState<Domain>("operations");
  const [workPriority, setWorkPriority] = useState<Priority>("normal");
  const [sourceKind, setSourceKind] = useState<SourceKind>("manual");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [approvalTitle, setApprovalTitle] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [approvalDueAt, setApprovalDueAt] = useState("");
  const [approvalDomain, setApprovalDomain] = useState<Domain>("operations");
  const [approvalPriority, setApprovalPriority] = useState<Priority>("normal");
  const [approverId, setApproverId] = useState(approvalCandidates[0]?.id ?? "");

  const refresh = () => router.refresh();
  const createWork = useAction(createDurableWorkItemAction, {
    successMessage: t("coordinationWorkCreated"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setWorkOpen(false);
      setWorkTitle("");
      setWorkReason("");
      setWorkDescription("");
      setWorkDueAt("");
      setWorkToken(token("work"));
      refresh();
    },
  });
  const requestApproval = useAction(requestApprovalAction, {
    successMessage: t("coordinationApprovalRequested"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setApprovalOpen(false);
      setApprovalTitle("");
      setApprovalReason("");
      setApprovalDueAt("");
      setApprovalToken(token("approval"));
      refresh();
    },
  });

  const submitWork = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createWork.run({
      sourceKind,
      sourceId: workToken,
      idempotencyKey: workToken,
      domain: workDomain,
      title: workTitle,
      description: workDescription,
      assigneeId: canManageWorkItems ? assigneeId : currentUserId,
      dueAt: workDueAt || null,
      priority: workPriority,
      createdReason: workReason,
      actionHref: "/dashboard",
    });
  };

  const submitApproval = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!approverId) return;
    requestApproval.run({
      approvalKind: "general",
      subjectKind: "manual",
      subjectId: approvalToken,
      idempotencyKey: approvalToken,
      domain: approvalDomain,
      title: approvalTitle,
      requestReason: approvalReason,
      approverId,
      dueAt: approvalDueAt || null,
      priority: approvalPriority,
      actionHref: "/dashboard",
    });
  };

  const domainSelect = (value: Domain, onChange: (next: Domain) => void) => (
    <Select value={value} onValueChange={(next) => onChange(next as Domain)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{DOMAINS.map((item) => <SelectItem key={item} value={item}>{t(`domain_${item}`)}</SelectItem>)}</SelectContent>
    </Select>
  );
  const prioritySelect = (value: Priority, onChange: (next: Priority) => void) => (
    <Select value={value} onValueChange={(next) => onChange(next as Priority)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{PRIORITIES.map((item) => <SelectItem key={item} value={item}>{t(`priority_${item}`)}</SelectItem>)}</SelectContent>
    </Select>
  );

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <h2 className="font-display text-lg text-ink">{t("coordinationTitle")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("coordinationIntro")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/coordination" className={buttonVariants({ variant: "ghost" })}>
          <History size={16} />{t("coordinationHistory")}
        </Link>
        <Dialog open={workOpen} onOpenChange={setWorkOpen}>
          <DialogTrigger asChild><Button type="button" variant="secondary"><ListPlus size={16} />{t("coordinationCreateWork")}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("coordinationCreateWork")}</DialogTitle>
              <DialogDescription>{t("coordinationWorkHint")}</DialogDescription>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={submitWork}>
              <Label className="grid gap-1.5">{t("coordinationTitleLabel")}<Input required maxLength={160} value={workTitle} onChange={(event) => setWorkTitle(event.target.value)} /></Label>
              <Label className="grid gap-1.5">{t("coordinationReasonLabel")}<Textarea required maxLength={500} value={workReason} onChange={(event) => setWorkReason(event.target.value)} /></Label>
              <Label className="grid gap-1.5">{t("coordinationDescriptionLabel")}<Textarea maxLength={2000} value={workDescription} onChange={(event) => setWorkDescription(event.target.value)} /></Label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Label className="grid gap-1.5">{t("coordinationSourceLabel")}
                  <Select value={sourceKind} onValueChange={(next) => setSourceKind(next as SourceKind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SOURCE_KINDS.map((item) => <SelectItem key={item} value={item}>{t(`source_${item}`)}</SelectItem>)}</SelectContent>
                  </Select>
                </Label>
                <Label className="grid gap-1.5">{t("coordinationDomainLabel")}{domainSelect(workDomain, setWorkDomain)}</Label>
                <Label className="grid gap-1.5">{t("coordinationPriorityLabel")}{prioritySelect(workPriority, setWorkPriority)}</Label>
                <Label className="grid gap-1.5">{t("coordinationDueLabel")}<DateTimePicker mode="datetime" value={workDueAt} onValueChange={setWorkDueAt} /></Label>
                {canManageWorkItems ? (
                  <Label className="grid gap-1.5 sm:col-span-2">{t("coordinationAssigneeLabel")}
                    <Select value={assigneeId} onValueChange={setAssigneeId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.displayName}</SelectItem>)}</SelectContent>
                    </Select>
                  </Label>
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setWorkOpen(false)}>{t("coordinationCancel")}</Button>
                <Button type="submit" disabled={createWork.pending}>{createWork.pending && <LoaderCircle size={15} className="animate-spin" />}{t("coordinationCreate")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
          <DialogTrigger asChild><Button type="button" disabled={approvalCandidates.length === 0}><ClipboardCheck size={16} />{t("coordinationRequestApproval")}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("coordinationRequestApproval")}</DialogTitle>
              <DialogDescription>{t("coordinationApprovalHint")}</DialogDescription>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={submitApproval}>
              <Label className="grid gap-1.5">{t("coordinationTitleLabel")}<Input required maxLength={160} value={approvalTitle} onChange={(event) => setApprovalTitle(event.target.value)} /></Label>
              <Label className="grid gap-1.5">{t("coordinationReasonLabel")}<Textarea required maxLength={1000} value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} /></Label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Label className="grid gap-1.5">{t("coordinationDomainLabel")}{domainSelect(approvalDomain, setApprovalDomain)}</Label>
                <Label className="grid gap-1.5">{t("coordinationPriorityLabel")}{prioritySelect(approvalPriority, setApprovalPriority)}</Label>
                <Label className="grid gap-1.5">{t("coordinationDueLabel")}<DateTimePicker mode="datetime" value={approvalDueAt} onValueChange={setApprovalDueAt} /></Label>
                <Label className="grid gap-1.5">{t("coordinationApproverLabel")}
                  <Select value={approverId} onValueChange={setApproverId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{approvalCandidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.displayName}</SelectItem>)}</SelectContent>
                  </Select>
                </Label>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setApprovalOpen(false)}>{t("coordinationCancel")}</Button>
                <Button type="submit" disabled={requestApproval.pending || !approverId}>{requestApproval.pending && <LoaderCircle size={15} className="animate-spin" />}{t("coordinationSubmit")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  );
}
