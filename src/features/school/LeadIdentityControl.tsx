"use client";

import { Link2, LoaderCircle, UserRoundCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import {
  confirmLeadIdentityAction,
  getLeadIdentityOptionsAction,
} from "./actions/leads";
import {
  leadIdentityHasPossibleDuplicate,
  type LeadIdentityInput,
  type LeadIdentityOptions,
} from "./lead-identity-contract";
import type { LeadPoolRow } from "./lead-contract";

type IdentityChoice = "" | "create" | `existing:${string}`;

function existingId(choice: IdentityChoice): string | null {
  return choice.startsWith("existing:") ? choice.slice("existing:".length) : null;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `lead-identity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function LeadIdentityControl({ lead, onConfirmed }: {
  lead: Pick<LeadPoolRow, "id" | "provisionalStudentName" | "gradeHint" | "phone" | "status" | "ownerId">;
  onConfirmed?: () => void;
}) {
  const t = useTranslations("school.leads");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<LeadIdentityOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [studentChoice, setStudentChoice] = useState<IdentityChoice>("");
  const [familyChoice, setFamilyChoice] = useState<IdentityChoice>("");
  const [contactChoice, setContactChoice] = useState<IdentityChoice>("");
  const [studentName, setStudentName] = useState(lead.provisionalStudentName);
  const [studentGrade, setStudentGrade] = useState(lead.gradeHint ? String(lead.gradeHint) : "");
  const [familyName, setFamilyName] = useState(`${lead.provisionalStudentName}${t("identityFamilySuffix")}`);
  const [contactName, setContactName] = useState(`${lead.provisionalStudentName}${t("identityContactSuffix")}`);
  const [contactPhone, setContactPhone] = useState(lead.phone);
  const [contactWechat, setContactWechat] = useState("");
  const [relation, setRelation] = useState(t("identityDefaultRelation"));
  const [preferredChannel, setPreferredChannel] = useState<"phone" | "wechat" | "other">("phone");
  const [isPrimaryFamily, setIsPrimaryFamily] = useState(true);
  const [isPrimaryContact, setIsPrimaryContact] = useState(true);
  const [isDecisionMaker, setIsDecisionMaker] = useState(true);
  const [allowPossibleDuplicate, setAllowPossibleDuplicate] = useState(false);
  const [allowAdditionalRelationship, setAllowAdditionalRelationship] = useState(false);
  const [serverDuplicateConflict, setServerDuplicateConflict] = useState(false);
  const [serverRelationshipConflict, setServerRelationshipConflict] = useState(false);

  const openControl = () => {
    setOptions(null);
    setLoadError(null);
    setServerDuplicateConflict(false);
    setServerRelationshipConflict(false);
    setAllowPossibleDuplicate(false);
    setAllowAdditionalRelationship(false);
    setIdempotencyKey(newIdempotencyKey());
    setOpen(true);
  };

  useEffect(() => {
    if (!open || options || loadError) return;
    let active = true;
    startLoading(async () => {
      const result = await getLeadIdentityOptionsAction(lead.id);
      if (!active) return;
      if (!result.ok) {
        setLoadError(result.code);
        return;
      }
      const next = result.data;
      setOptions(next);
      setStudentName(next.lead.studentName);
      setStudentGrade(next.lead.grade ? String(next.lead.grade) : "");
      setFamilyName(`${next.lead.studentName}${t("identityFamilySuffix")}`);
      setContactName(`${next.lead.studentName}${t("identityContactSuffix")}`);
      setContactPhone(next.lead.phone);
      setContactWechat(next.lead.wechatNickname);
      setStudentChoice(next.students.length > 0 ? "" : next.canCreateStudent ? "create" : "");
      setFamilyChoice(next.families.length > 0 ? "" : "create");
      setContactChoice(next.contacts.length > 0 ? "" : "create");
    });
    return () => { active = false; };
  }, [lead.id, loadError, open, options, t]);

  const input = useMemo<LeadIdentityInput | null>(() => {
    if (!options || !studentChoice || !familyChoice || !contactChoice || !relation.trim()) return null;
    const studentId = existingId(studentChoice);
    const familyId = existingId(familyChoice);
    const contactId = existingId(contactChoice);
    if (studentChoice === "create" && (!studentName.trim() || !options.canCreateStudent)) return null;
    if (familyChoice === "create" && !familyName.trim()) return null;
    if (contactChoice === "create" && (!contactName.trim() || !contactPhone.trim())) return null;
    if (studentChoice !== "create" && !studentId) return null;
    if (familyChoice !== "create" && !familyId) return null;
    if (contactChoice !== "create" && !contactId) return null;
    return {
      student: studentChoice === "create"
        ? { mode: "create", name: studentName, grade: studentGrade ? Number(studentGrade) : null }
        : { mode: "existing", id: studentId as string },
      family: familyChoice === "create"
        ? { mode: "create", displayName: familyName }
        : { mode: "existing", id: familyId as string },
      contact: contactChoice === "create"
        ? { mode: "create", displayName: contactName, phone: contactPhone, wechat: contactWechat }
        : { mode: "existing", id: contactId as string },
      relationship: {
        relation,
        isPrimaryFamily,
        isPrimaryContact,
        isDecisionMaker,
        preferredChannel,
      },
      allowPossibleDuplicate,
      allowAdditionalRelationship,
    };
  }, [
    allowAdditionalRelationship,
    allowPossibleDuplicate,
    contactChoice,
    contactName,
    contactPhone,
    contactWechat,
    familyChoice,
    familyName,
    isDecisionMaker,
    isPrimaryContact,
    isPrimaryFamily,
    options,
    preferredChannel,
    relation,
    studentChoice,
    studentGrade,
    studentName,
  ]);

  const possibleDuplicate = Boolean(
    input && options && (serverDuplicateConflict || leadIdentityHasPossibleDuplicate(options, input)),
  );
  const canSubmit = Boolean(
    input
    && idempotencyKey
    && (!possibleDuplicate || allowPossibleDuplicate)
    && (!serverRelationshipConflict || allowAdditionalRelationship),
  );

  const { run: confirm, pending } = useAction(confirmLeadIdentityAction, {
    successMessage: t("identityConfirmedSuccess"),
    errorMessage: {
      VALIDATION: t("identityErrorInvalid"),
      INVALID_IDENTITY: t("identityErrorInvalid"),
      FORBIDDEN: t("identityErrorForbidden"),
      FORBIDDEN_SCOPE: t("identityErrorForbidden"),
      LEAD_UNASSIGNED: t("identityNeedsOwner"),
      LEAD_CLOSED: t("identityErrorClosed"),
      NOT_FOUND: t("identityErrorStale"),
      STUDENT_NOT_FOUND: t("identityErrorStale"),
      FAMILY_NOT_FOUND: t("identityErrorStale"),
      CONTACT_NOT_FOUND: t("identityErrorStale"),
      POSSIBLE_STUDENT_DUPLICATE: t("identityDuplicateWarning"),
      POSSIBLE_FAMILY_DUPLICATE: t("identityDuplicateWarning"),
      POSSIBLE_CONTACT_DUPLICATE: t("identityDuplicateWarning"),
      RELATIONSHIP_CONFLICT: t("identityRelationshipWarning"),
      PRIMARY_RELATION_REQUIRED: t("identityPrimaryRequired"),
      COURSE_OPPORTUNITY_IDENTITY_CONFLICT: t("identityOpportunityConflict"),
      LEAD_IDENTITY_HISTORY_CONFLICT: t("identityHistoryConflict"),
      IDEMPOTENCY_CONFLICT: t("identityErrorConflict"),
      default: t("identityErrorUnknown"),
    },
    onSuccess: () => {
      setOpen(false);
      onConfirmed?.();
      router.refresh();
    },
    onError: (code) => {
      if (["POSSIBLE_STUDENT_DUPLICATE", "POSSIBLE_FAMILY_DUPLICATE", "POSSIBLE_CONTACT_DUPLICATE"].includes(code)) {
        setServerDuplicateConflict(true);
      }
      if (code === "RELATIONSHIP_CONFLICT") setServerRelationshipConflict(true);
      if (["LEAD_CLOSED", "NOT_FOUND", "IDEMPOTENCY_CONFLICT"].includes(code)) router.refresh();
    },
  });

  if (lead.status === "converted" || lead.status === "invalid") return <span className="text-muted">—</span>;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        disabled={!lead.ownerId}
        title={!lead.ownerId ? t("identityNeedsOwner") : undefined}
        onClick={openControl}
      >
        <UserRoundCheck size={13} />
        {t("confirmIdentity")}
      </Button>

      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("identityTitle", { name: lead.provisionalStudentName })}</DialogTitle>
            <DialogDescription>{t("identityDescription")}</DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted">
              <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" />
              {t("identityLoading")}
            </div>
          ) : loadError ? (
            <p role="alert" className="rounded-lg border border-rose/30 bg-rose/5 p-3 text-sm text-rose">
              {t(loadError === "LEAD_UNASSIGNED" ? "identityNeedsOwner" : "identityLoadFailed")}
            </p>
          ) : options ? (
            <div className="grid gap-4">
              <section className="grid gap-3 rounded-xl border border-line p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{t("identityStudent")}</p>
                  <p className="text-xs text-muted">{t("identityStudentHint")}</p>
                </div>
                <Label className="grid gap-1 text-xs font-normal text-muted">
                  {t("identityResolution")}
                  <Select value={studentChoice} onValueChange={(value) => setStudentChoice(value as IdentityChoice)}>
                    <SelectTrigger><SelectValue placeholder={t("identityChooseResolution")} /></SelectTrigger>
                    <SelectContent>
                      {options.canCreateStudent ? <SelectItem value="create">{t("identityCreateStudent")}</SelectItem> : null}
                      {options.students.map((candidate) => (
                        <SelectItem key={candidate.id} value={`existing:${candidate.id}`}>
                          {t("identityStudentCandidate", {
                            name: candidate.name,
                            detail: candidate.parentPhone || candidate.phone || t("identityNoPhone"),
                          })}{candidate.suggested ? ` · ${t("identitySuggested")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
                {!options.canCreateStudent && options.students.length === 0 ? (
                  <p role="alert" className="text-xs text-rose">{t("identityNoStudentResolution")}</p>
                ) : null}
                {studentChoice === "create" ? (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <Label className="grid gap-1 text-xs font-normal text-muted">
                      {t("identityStudentName")}
                      <Input value={studentName} onChange={(event) => setStudentName(event.target.value)} maxLength={100} />
                    </Label>
                    <Label className="grid gap-1 text-xs font-normal text-muted">
                      {t("grade")}
                      <Select value={studentGrade || "unknown"} onValueChange={(value) => setStudentGrade(value === "unknown" ? "" : value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unknown">{t("unknownGrade")}</SelectItem>
                          {Array.from({ length: 12 }, (_, index) => index + 1).map((grade) => (
                            <SelectItem key={grade} value={String(grade)}>{t("gradeValue", { grade })}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Label>
                  </div>
                ) : null}
              </section>

              <section className="grid gap-3 rounded-xl border border-line p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{t("identityFamily")}</p>
                  <p className="text-xs text-muted">{t("identityFamilyHint")}</p>
                </div>
                <Label className="grid gap-1 text-xs font-normal text-muted">
                  {t("identityResolution")}
                  <Select value={familyChoice} onValueChange={(value) => setFamilyChoice(value as IdentityChoice)}>
                    <SelectTrigger><SelectValue placeholder={t("identityChooseResolution")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="create">{t("identityCreateFamily")}</SelectItem>
                      {options.families.map((candidate) => (
                        <SelectItem key={candidate.id} value={`existing:${candidate.id}`}>
                          {candidate.displayName}
                          {candidate.studentNames.length > 0 ? ` · ${candidate.studentNames.join(" / ")}` : ""}
                          {candidate.contactNames.length > 0 ? ` · ${candidate.contactNames.join(" / ")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
                {familyChoice === "create" ? (
                  <Label className="grid gap-1 text-xs font-normal text-muted">
                    {t("identityFamilyName")}
                    <Input value={familyName} onChange={(event) => setFamilyName(event.target.value)} maxLength={120} />
                  </Label>
                ) : null}
              </section>

              <section className="grid gap-3 rounded-xl border border-line p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{t("identityContact")}</p>
                  <p className="text-xs text-muted">{t("identityContactHint")}</p>
                </div>
                <Label className="grid gap-1 text-xs font-normal text-muted">
                  {t("identityResolution")}
                  <Select value={contactChoice} onValueChange={(value) => setContactChoice(value as IdentityChoice)}>
                    <SelectTrigger><SelectValue placeholder={t("identityChooseResolution")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="create">{t("identityCreateContact")}</SelectItem>
                      {options.contacts.map((candidate) => (
                        <SelectItem key={candidate.id} value={`existing:${candidate.id}`}>
                          {t("identityContactCandidate", { name: candidate.displayName, phone: candidate.phone })}
                          {candidate.familyNames.length > 0 ? ` · ${candidate.familyNames.join(" / ")}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
                {contactChoice === "create" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Label className="grid gap-1 text-xs font-normal text-muted">
                      {t("identityContactName")}
                      <Input value={contactName} onChange={(event) => setContactName(event.target.value)} maxLength={100} />
                    </Label>
                    <Label className="grid gap-1 text-xs font-normal text-muted">
                      {t("identityContactPhone")}
                      <Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} maxLength={40} />
                    </Label>
                    <Label className="grid gap-1 text-xs font-normal text-muted sm:col-span-2">
                      {t("identityContactWechat")}
                      <Input value={contactWechat} onChange={(event) => setContactWechat(event.target.value)} maxLength={100} />
                    </Label>
                  </div>
                ) : null}
              </section>

              <section className="grid gap-3 rounded-xl border border-line p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{t("identityRelationship")}</p>
                  <p className="text-xs text-muted">{t("identityRelationshipHint")}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Label className="grid gap-1 text-xs font-normal text-muted">
                    {t("identityRelation")}
                    <Input value={relation} onChange={(event) => setRelation(event.target.value)} maxLength={40} />
                  </Label>
                  <Label className="grid gap-1 text-xs font-normal text-muted">
                    {t("identityPreferredChannel")}
                    <Select value={preferredChannel} onValueChange={(value) => setPreferredChannel(value as typeof preferredChannel)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="phone">{t("identityChannelPhone")}</SelectItem>
                        <SelectItem value="wechat">{t("identityChannelWechat")}</SelectItem>
                        <SelectItem value="other">{t("identityChannelOther")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Label>
                </div>
                <div className="grid gap-2 text-xs text-ink sm:grid-cols-3">
                  <Label className="flex items-center gap-2 font-normal">
                    <Checkbox checked={isPrimaryFamily} onCheckedChange={(checked) => setIsPrimaryFamily(checked === true)} />
                    {t("identityPrimaryFamily")}
                  </Label>
                  <Label className="flex items-center gap-2 font-normal">
                    <Checkbox checked={isPrimaryContact} onCheckedChange={(checked) => setIsPrimaryContact(checked === true)} />
                    {t("identityPrimaryContact")}
                  </Label>
                  <Label className="flex items-center gap-2 font-normal">
                    <Checkbox checked={isDecisionMaker} onCheckedChange={(checked) => setIsDecisionMaker(checked === true)} />
                    {t("identityDecisionMaker")}
                  </Label>
                </div>
              </section>

              {possibleDuplicate ? (
                <Label className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-normal text-ink">
                  <Checkbox
                    className="mt-0.5"
                    checked={allowPossibleDuplicate}
                    onCheckedChange={(checked) => setAllowPossibleDuplicate(checked === true)}
                  />
                  <span><strong>{t("identityDuplicateTitle")}</strong><br />{t("identityDuplicateWarning")}</span>
                </Label>
              ) : null}

              {(studentChoice.startsWith("existing:") || contactChoice.startsWith("existing:") || serverRelationshipConflict) ? (
                <Label className="flex items-start gap-2 rounded-xl border border-line bg-moon/10 p-3 text-xs font-normal text-ink">
                  <Checkbox
                    className="mt-0.5"
                    checked={allowAdditionalRelationship}
                    onCheckedChange={(checked) => setAllowAdditionalRelationship(checked === true)}
                  />
                  <span><strong>{t("identityAdditionalTitle")}</strong><br />{t("identityRelationshipWarning")}</span>
                </Label>
              ) : null}

              <div className="flex items-start gap-2 rounded-xl bg-moon/15 p-3 text-xs leading-5 text-muted">
                <Link2 size={14} className="mt-0.5 shrink-0" />
                <span>{t("identityAuditHint")}</span>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!canSubmit || pending || loading}
              onClick={() => { if (input) confirm(lead.id, idempotencyKey, input); }}
            >
              {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <UserRoundCheck size={15} />}
              {t("confirmIdentity")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
