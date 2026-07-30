"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KeyRound, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AccountRequestKind, AccountSecuritySnapshot, ConsentKind } from "./account-security";
import { recordAccountConsentAction, requestUserRightAction } from "./actions";

type Factor = { id: string; friendly_name?: string; factor_type: "totp"; status: "verified" | "unverified"; created_at: string };

export function AccountSecurityPanel({ snapshot, isAdmin }: { snapshot: AccountSecuritySnapshot; isAdmin: boolean }) {
  const locale = useLocale();
  const t = useTranslations("account.security");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [aal, setAal] = useState<"aal1" | "aal2" | null>(null);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [requestKind, setRequestKind] = useState<AccountRequestKind>("access");
  const [requestScope, setRequestScope] = useState("account");
  const [requestReason, setRequestReason] = useState("");

  const refreshMfa = async () => {
    const supabase = createClient();
    const [{ data: factorData }, { data: aalData }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    setFactors(((factorData?.all ?? []).filter((factor) => factor.factor_type === "totp")) as Factor[]);
    setAal(aalData?.currentLevel === "aal2" ? "aal2" : aalData?.currentLevel === "aal1" ? "aal1" : null);
  };

  useEffect(() => {
    // Supabase MFA is external Auth state; refreshMfa updates only after its awaited reads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshMfa();
  }, []);

  const consentRun = useAction(recordAccountConsentAction, {
    successMessage: t("consentSaved"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const requestRun = useAction(requestUserRightAction, {
    successMessage: t("requestSaved"),
    errorMessage: { REQUEST_ALREADY_OPEN: t("requestAlreadyOpen"), default: t("actionFailed") },
    onSuccess: () => { setRequestReason(""); router.refresh(); },
  });

  const updatePassword = async () => {
    if (password.length < 8 || password !== passwordConfirm) {
      toast.error(t("passwordInvalid"));
      return;
    }
    setAuthBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setAuthBusy(false);
    if (error) toast.error(t("actionFailed"));
    else { setPassword(""); setPasswordConfirm(""); toast.success(t("passwordSaved")); }
  };

  const revokeOtherSessions = async () => {
    setAuthBusy(true);
    const { error } = await createClient().auth.signOut({ scope: "others" });
    setAuthBusy(false);
    if (error) toast.error(t("actionFailed")); else toast.success(t("sessionsRevoked"));
  };

  const enrollMfa = async () => {
    setAuthBusy(true);
    const supabase = createClient();
    for (const factor of factors.filter((item) => item.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: factor.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Mathin" });
    setAuthBusy(false);
    if (error || !data) { toast.error(t("actionFailed")); return; }
    // GoTrue's inline SVG currently ends with a newline. Next.js 16 rejects an
    // Image src ending in a control character, so normalize only that boundary.
    setEnrollment({ id: data.id, qr: data.totp.qr_code.trimEnd(), secret: data.totp.secret });
    setTotpCode("");
    await refreshMfa();
  };

  const verifyMfa = async (factorId: string) => {
    if (!/^\d{6}$/.test(totpCode)) { toast.error(t("totpInvalid")); return; }
    setAuthBusy(true);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: totpCode });
    setAuthBusy(false);
    if (error) { toast.error(t("totpInvalid")); return; }
    setEnrollment(null);
    setTotpCode("");
    await refreshMfa();
    toast.success(t("mfaVerified"));
    router.refresh();
  };

  const removeMfa = async (factorId: string) => {
    if (isAdmin && verified.length <= 1) {
      toast.error(t("mfaAdminKeepOne"));
      return;
    }
    setAuthBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId });
    setAuthBusy(false);
    if (error) toast.error(t("actionFailed"));
    else { await refreshMfa(); toast.success(t("mfaRemoved")); }
  };

  const verified = factors.filter((factor) => factor.status === "verified");

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 size-5 text-crater" />
          <div><h2 className="font-medium text-ink">{t("passwordTitle")}</h2><p className="mt-1 text-sm text-muted">{t("passwordIntro")}</p></div>
        </div>
        <div className="mt-5 grid gap-3">
          <Label htmlFor="new-password">{t("newPassword")}</Label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
          <Label htmlFor="confirm-password">{t("confirmPassword")}</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} />
          <Button className="mt-2 w-fit" disabled={authBusy || !password} onClick={updatePassword}>{authBusy && <LoaderCircle className="size-4 animate-spin" />}{t("savePassword")}</Button>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="flex items-start gap-3">
          <LogOut className="mt-0.5 size-5 text-crater" />
          <div><h2 className="font-medium text-ink">{t("sessionsTitle")}</h2><p className="mt-1 text-sm text-muted">{t("sessionsIntro")}</p></div>
        </div>
        <Button className="mt-5" variant="secondary" disabled={authBusy} onClick={revokeOtherSessions}>{t("revokeOtherSessions")}</Button>
      </section>

      <section id="mfa" className="scroll-mt-24 rounded-2xl border border-line bg-card p-5 xl:col-span-2">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-crater" />
          <div className="min-w-0"><h2 className="font-medium text-ink">{t("mfaTitle")}</h2><p className="mt-1 text-sm text-muted">{isAdmin ? t("mfaAdminRequired") : t("mfaIntro")}</p></div>
          <span className="ml-auto rounded-full bg-line/50 px-2.5 py-1 text-xs text-muted">{aal === "aal2" ? t("aal2") : t("aal1")}</span>
        </div>
        {verified.length === 0 ? <Button className="mt-5" disabled={authBusy} onClick={enrollMfa}>{t("enrollMfa")}</Button> : (
          <ul className="mt-5 space-y-2">
            {verified.map((factor) => <li key={factor.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm"><span className="font-medium">{factor.friendly_name || "TOTP"}</span><span className="text-muted">{t("verified")}</span>{aal !== "aal2" && <Button className="ml-auto" size="sm" onClick={() => verifyMfa(factor.id)} disabled={authBusy || !totpCode}>{t("verifySession")}</Button>}<Button className={aal === "aal2" ? "ml-auto" : ""} size="sm" variant="ghost" onClick={() => removeMfa(factor.id)} disabled={authBusy || (isAdmin && verified.length <= 1)}>{t("removeMfa")}</Button></li>)}
          </ul>
        )}
        {(enrollment || (verified.length > 0 && aal !== "aal2")) && <div className="mt-5 grid gap-4 rounded-xl border border-line bg-background/50 p-4 md:grid-cols-[auto_1fr]">
          {enrollment && <Image src={enrollment.qr} alt={t("qrAlt")} width={180} height={180} unoptimized className="rounded-lg bg-white p-2" />}
          <div className="min-w-0 space-y-3">
            {enrollment && <><p className="text-sm text-muted">{t("scanQr")}</p><p className="break-all rounded-lg bg-line/40 p-2 font-mono text-xs">{enrollment.secret}</p></>}
            <Label htmlFor="totp-code">{t("totpCode")}</Label>
            <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))} className="max-w-48 font-mono tracking-[0.3em]" />
            {enrollment && <Button disabled={authBusy || totpCode.length !== 6} onClick={() => verifyMfa(enrollment.id)}>{t("verifyMfa")}</Button>}
          </div>
        </div>}
      </section>

      <section id="consent" className="scroll-mt-24 rounded-2xl border border-line bg-card p-5">
        <h2 className="font-medium text-ink">{t("consentTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("consentIntro")}</p>
        <ul className="mt-4 space-y-3">
          {snapshot.policies.map((policy) => <li key={policy.kind} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2"><Link href={policy.documentPath} className="font-medium underline underline-offset-2">{t(`policy_${policy.kind}`)}</Link><span className="text-xs text-muted">{t("version", { version: policy.version })}</span><span className="ml-auto text-xs text-muted">{t(`decision_${policy.decision ?? "missing"}`)}</span></div>
            <div className="mt-3 flex gap-2"><Button size="sm" disabled={consentRun.pending || policy.decision === "granted"} onClick={() => consentRun.run({ policyKind: policy.kind as ConsentKind, decision: "granted" })}>{t("grant")}</Button><Button size="sm" variant="secondary" disabled={consentRun.pending || policy.decision === "withdrawn"} onClick={() => consentRun.run({ policyKind: policy.kind as ConsentKind, decision: "withdrawn" })}>{t("withdraw")}</Button></div>
          </li>)}
        </ul>
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-medium text-ink">{t("rightsTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("rightsIntro")}</p>
        <div className="mt-4 grid gap-3">
          <Select value={requestKind} onValueChange={(value) => setRequestKind(value as AccountRequestKind)}><SelectTrigger aria-label={t("requestKind")}><SelectValue /></SelectTrigger><SelectContent>{(["access","correct","export","restrict","delete"] as const).map((kind) => <SelectItem key={kind} value={kind}>{t(`request_${kind}`)}</SelectItem>)}</SelectContent></Select>
          <Input value={requestScope} maxLength={200} onChange={(event) => setRequestScope(event.target.value)} placeholder={t("dataScope")} />
          <Input value={requestReason} maxLength={1000} onChange={(event) => setRequestReason(event.target.value)} placeholder={t("requestReason")} />
          <Button className="w-fit" disabled={requestRun.pending || !requestScope.trim()} onClick={() => requestRun.run({ kind: requestKind, reason: requestReason, dataScope: requestScope })}>{t("submitRequest")}</Button>
        </div>
        {snapshot.requests.length > 0 && <ul className="mt-5 space-y-2 border-t border-line pt-4">{snapshot.requests.map((request) => <li key={request.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{t(`request_${request.kind}`)}</span><span className="text-muted">{t(`status_${request.status}`)}</span><span className="ml-auto text-xs text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(request.createdAt))}</span></li>)}</ul>}
      </section>
    </div>
  );
}
