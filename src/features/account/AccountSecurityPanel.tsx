"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BriefcaseBusiness,
  CheckCircle2,
  Download,
  FileLock2,
  KeyRound,
  Languages,
  LoaderCircle,
  LogOut,
  Mail,
  MessageCircle,
  MessagesSquare,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAction } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type {
  AccountCenterSnapshot,
  AccountIdentifierVerification,
  AccountRequestKind,
  ConsentKind,
} from "./account-security";
import {
  changeInitialPasswordAction,
  downloadUserRightsExportAction,
  recordAccountConsentAction,
  requestUserRightAction,
  updateAccountProfileAction,
} from "./actions";

type Factor = {
  id: string;
  friendly_name?: string;
  factor_type: "totp";
  status: "verified" | "unverified";
  created_at: string;
};
type AccountSection = "profile" | "identities" | "security" | "privacy";
type AvatarDraft =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "upload"; blob: Blob; previewUrl: string };

const AVATAR_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const KNOWN_STAFF_ROLES = new Set(["principal", "director", "research", "teacher", "sales", "part_time"]);

async function normalizeAvatar(file: File) {
  if (!AVATAR_MIME_TYPES.has(file.type) || file.size > AVATAR_SOURCE_MAX_BYTES) throw new Error("AVATAR_INVALID");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("AVATAR_INVALID");
  }
  context.drawImage(
    bitmap,
    Math.floor((bitmap.width - side) / 2),
    Math.floor((bitmap.height - side) / 2),
    side,
    side,
    0,
    0,
    512,
    512,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
  if (!blob || blob.size > AVATAR_SOURCE_MAX_BYTES) throw new Error("AVATAR_INVALID");
  return blob;
}

function SettingSection({ id, title, intro, children }: { id?: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line py-6 first:border-t-0 first:pt-0">
      <div className="mb-5">
        <h3 className="text-lg font-medium text-ink">{title}</h3>
        {intro ? <p className="mt-1 text-sm text-muted">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-3 md:grid-cols-[11rem_minmax(0,30rem)] md:gap-6">
      <div className="pt-2 text-sm font-medium text-ink">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function AccountSecurityPanel({
  snapshot,
  initialSection = "profile",
  forcePasswordChange = false,
}: {
  snapshot: AccountCenterSnapshot;
  initialSection?: AccountSection;
  forcePasswordChange?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("account.security");
  const router = useRouter();
  const [section, setSection] = useState<AccountSection>(initialSection);
  const [displayName, setDisplayName] = useState(snapshot.profile.displayName);
  const [preferredLocale, setPreferredLocale] = useState<"zh" | "en">(snapshot.profile.preferredLocale);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState(snapshot.profile.avatarUrl);
  const [avatarDraft, setAvatarDraft] = useState<AvatarDraft>({ kind: "keep" });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const uploadedAvatarPath = useRef<string | null>(null);
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
  const isAdmin = snapshot.profile.role === "admin";

  useEffect(() => () => {
    if (avatarDraft.kind === "upload") URL.revokeObjectURL(avatarDraft.previewUrl);
  }, [avatarDraft]);

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
    // Supabase MFA is external Auth state; refresh only after its awaited reads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshMfa();
  }, []);

  const profileRun = useAction(updateAccountProfileAction, {
    successMessage: t("profileSaved"),
    errorMessage: {
      AVATAR_PATH_INVALID: t("avatarInvalid"),
      PROFILE_UPDATE_FAILED: t("profileSaveFailed"),
      default: t("profileSaveFailed"),
    },
    onSuccess: (value) => {
      uploadedAvatarPath.current = null;
      setDisplayName(value.displayName);
      setPreferredLocale(value.preferredLocale);
      setCurrentAvatarUrl(value.avatarUrl);
      setAvatarDraft({ kind: "keep" });
      if (value.preferredLocale !== locale) router.replace("/dashboard/account-security", { locale: value.preferredLocale });
      else router.refresh();
    },
    onError: () => {
      const path = uploadedAvatarPath.current;
      uploadedAvatarPath.current = null;
      if (path) void createClient().storage.from("profile-avatars").remove([path]);
    },
  });
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
  const downloadRun = useAction(downloadUserRightsExportAction, {
    successMessage: t("exportDownloaded"),
    errorMessage: { EXPORT_EXPIRED: t("exportExpired"), EXPORT_PURGED: t("exportExpired"), default: t("actionFailed") },
    onSuccess: (value) => {
      const url = URL.createObjectURL(new Blob([value.contentText], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = value.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      router.refresh();
    },
  });
  const initialPasswordRun = useAction(changeInitialPasswordAction, {
    successMessage: t("passwordSaved"),
    errorMessage: {
      VALIDATION: t("passwordInvalid"),
      SAME_AS_INITIAL: t("sameAsInitialPassword"),
      INITIAL_PASSWORD_RECORD_MISSING: t("actionFailed"),
      AUTH_PROVIDER_FAILED: t("actionFailed"),
      default: t("actionFailed"),
    },
    onSuccess: () => {
      setPassword("");
      setPasswordConfirm("");
      router.replace("/dashboard");
      router.refresh();
    },
  });

  const chooseAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const blob = await normalizeAvatar(file);
      setAvatarDraft({ kind: "upload", blob, previewUrl: URL.createObjectURL(blob) });
    } catch {
      toast.error(t("avatarInvalid"));
    } finally {
      setAvatarBusy(false);
    }
  };

  const saveProfile = async () => {
    const cleanName = displayName.trim();
    if (!cleanName) {
      toast.error(t("displayNameRequired"));
      return;
    }
    setAvatarBusy(true);
    let avatarPath: string | null | undefined;
    try {
      if (avatarDraft.kind === "upload") {
        avatarPath = `${snapshot.profile.userId}/${crypto.randomUUID()}.webp`;
        const { error } = await createClient().storage.from("profile-avatars").upload(avatarPath, avatarDraft.blob, {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: false,
        });
        if (error) throw error;
        uploadedAvatarPath.current = avatarPath;
      } else if (avatarDraft.kind === "remove") avatarPath = null;
      profileRun.run({
        displayName: cleanName,
        preferredLocale,
        ...(avatarDraft.kind === "keep" ? {} : { avatarPath }),
      });
    } catch {
      toast.error(t("avatarUploadFailed"));
    } finally {
      setAvatarBusy(false);
    }
  };

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

  const leaveForcedPasswordChange = async () => {
    setAuthBusy(true);
    await createClient().auth.signOut({ scope: "local" });
    router.replace("/login");
    router.refresh();
  };

  const enrollMfa = async () => {
    setAuthBusy(true);
    const supabase = createClient();
    for (const factor of factors.filter((item) => item.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: factor.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Mathin" });
    setAuthBusy(false);
    if (error || !data) { toast.error(t("actionFailed")); return; }
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

  const verified = factors.filter((factor) => factor.status === "verified");
  const removeMfa = async (factorId: string) => {
    if (isAdmin && verified.length <= 1) { toast.error(t("mfaAdminKeepOne")); return; }
    setAuthBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId });
    setAuthBusy(false);
    if (error) toast.error(t("actionFailed"));
    else { await refreshMfa(); toast.success(t("mfaRemoved")); }
  };

  const verificationLabel = (value: AccountIdentifierVerification) => t(`verification_${value}`);
  const roleLabel = t(`role_${snapshot.profile.role}`);
  const avatarPreview = avatarDraft.kind === "upload" ? avatarDraft.previewUrl : avatarDraft.kind === "remove" ? null : currentAvatarUrl;
  const avatarInitial = displayName.trim().slice(0, 1).toUpperCase() || "M";
  const profileBusy = avatarBusy || profileRun.pending;

  return (
    <>
      <Dialog open={forcePasswordChange} onOpenChange={() => undefined}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("initialPasswordTitle")}</DialogTitle>
            <DialogDescription>{t("initialPasswordBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Label htmlFor="initial-new-password">{t("newPassword")}</Label>
            <Input
              id="initial-new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Label htmlFor="initial-confirm-password">{t("confirmPassword")}</Label>
            <Input
              id="initial-confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={authBusy || initialPasswordRun.pending}
              onClick={() => void leaveForcedPasswordChange()}
            >
              <LogOut className="size-4" aria-hidden />
              {t("signOut")}
            </Button>
            <Button
              type="button"
              disabled={initialPasswordRun.pending || password.length < 8 || password !== passwordConfirm}
              onClick={() => initialPasswordRun.run({ password, passwordConfirm })}
            >
              {initialPasswordRun.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("savePassword")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Tabs value={section} onValueChange={(value) => setSection(value as AccountSection)} orientation="vertical" className="grid min-w-0 border-y border-line lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="border-b border-line p-3 lg:border-r lg:border-b-0 lg:py-6">
        <div className="lg:sticky lg:top-20">
          <p className="hidden px-4 pb-3 text-xs font-medium uppercase tracking-[0.12em] text-muted lg:block">{t("settingsNav")}</p>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-none bg-transparent p-0 lg:block">
            {([
              ["profile", UserRound, t("navProfile")],
              ["identities", KeyRound, t("navIdentities")],
              ["security", ShieldCheck, t("navSecurity")],
              ["privacy", FileLock2, t("navPrivacy")],
            ] as const).map(([value, Icon, label]) => (
              <TabsTrigger key={value} value={value} className="w-full justify-start rounded-none border-b-2 border-transparent bg-transparent px-3 py-3 text-left shadow-none data-[state=active]:border-rose data-[state=active]:bg-rose/5 data-[state=active]:shadow-none lg:border-b-0 lg:border-l-2">
                <Icon className="size-4 shrink-0" aria-hidden />{label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </aside>

      <div className="min-w-0 px-4 py-7 sm:px-7 lg:px-10">
        <TabsContent value="profile" className="m-0">
          <div className="mb-7"><h2 className="text-2xl font-medium text-ink">{t("profileTitle")}</h2><p className="mt-1 text-sm text-muted">{t("profileIntro")}</p></div>
          <SettingSection title={t("publicProfileTitle")} intro={t("publicProfileIntro")}>
            <SettingRow label={t("avatarLabel")}>
              <div className="flex flex-wrap items-center gap-4">
                <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rose text-2xl text-white">
                  {avatarPreview ? <Image src={avatarPreview} alt={t("avatarAlt")} fill sizes="80px" unoptimized className="object-cover" /> : avatarInitial}
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="account-avatar" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}>
                      {avatarBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("changeAvatar")}
                    </Label>
                    <Input id="account-avatar" className="sr-only !size-px" type="file" accept="image/png,image/jpeg,image/webp" disabled={profileBusy} onChange={(event) => { void chooseAvatar(event.target.files?.[0]); event.target.value = ""; }} />
                    {avatarPreview || avatarDraft.kind === "upload" ? <Button type="button" size="sm" variant="ghost" disabled={profileBusy} onClick={() => setAvatarDraft({ kind: "remove" })}>{t("removeAvatar")}</Button> : null}
                  </div>
                  <p className="text-xs text-muted">{t("avatarHint")}</p>
                </div>
              </div>
            </SettingRow>
            <SettingRow label={t("displayNameLabel")}>
              <Input value={displayName} maxLength={40} disabled={profileBusy} onChange={(event) => setDisplayName(event.target.value)} />
              <p className="mt-2 text-xs text-muted">{t("displayNameHint")}</p>
            </SettingRow>
            <SettingRow label={t("languageLabel")}>
              <Select value={preferredLocale} onValueChange={(value) => setPreferredLocale(value as "zh" | "en")} disabled={profileBusy}>
                <SelectTrigger className="max-w-64" aria-label={t("languageLabel")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="zh">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
              </Select>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Languages className="size-3.5" aria-hidden />{t("languageHint")}</p>
            </SettingRow>
            <div className="mt-4 flex justify-end border-t border-line pt-5">
              <Button type="button" disabled={profileBusy || !displayName.trim()} onClick={() => void saveProfile()}>{profileBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("saveProfile")}</Button>
            </div>
          </SettingSection>

          <SettingSection title={t("businessProfileTitle")} intro={t("businessProfileIntro")}>
            <div className="divide-y divide-line border-y border-line">
              <div className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><span className="text-sm text-muted">{t("accountRole")}</span><span className="flex items-center gap-2 text-sm font-medium"><BriefcaseBusiness className="size-4 text-crater" aria-hidden />{roleLabel}</span></div>
              {snapshot.profile.staffRoles.length > 0 ? <div className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><span className="text-sm text-muted">{t("staffRoles")}</span><span className="text-sm">{snapshot.profile.staffRoles.map((role) => KNOWN_STAFF_ROLES.has(role.key) ? t(`staffRole_${role.key}`) : role.name).join(" · ")}</span></div> : null}
              <div className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><span className="text-sm text-muted">{t("accountId")}</span><span className="font-mono text-sm">{snapshot.profile.accountId}••••</span></div>
              <div className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"><span className="text-sm text-muted">{t("accountStatus")}</span><span className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4" aria-hidden />{t(`accountStatus_${snapshot.accountStatus}`)}</span></div>
            </div>
          </SettingSection>
        </TabsContent>

        <TabsContent value="identities" className="m-0">
          <div className="mb-7"><h2 className="text-2xl font-medium text-ink">{t("identitiesTitle")}</h2><p className="mt-1 text-sm text-muted">{t("identitiesIntro")}</p></div>
          <div className="mb-6 border-l-2 border-amber-500 bg-amber-50/60 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">{t("identityP0Notice")}</div>
          <SettingSection title={t("loginIdentifiersTitle")} intro={t("loginIdentifiersIntro")}>
            <div className="divide-y divide-line border-y border-line">
              {snapshot.identifiers.map((identifier) => {
                const Icon = identifier.kind === "email" ? Mail : Smartphone;
                return <div key={identifier.kind} className="grid gap-3 py-4 md:grid-cols-[minmax(11rem,1.1fr)_minmax(9rem,1fr)_minmax(10rem,1fr)_auto] md:items-center">
                  <div className="flex items-center gap-3"><Icon className="size-5 text-crater" aria-hidden /><div className="min-w-0"><p className="text-sm font-medium">{t(`identifier_${identifier.kind}`)}</p><p className="truncate text-xs text-muted">{identifier.maskedValue ?? t("unbound")}</p></div></div>
                  <span className={cn("flex items-center gap-1.5 text-sm", identifier.verification === "provider_verified" ? "text-emerald-700 dark:text-emerald-300" : identifier.verification === "unbound" ? "text-muted" : "text-amber-700 dark:text-amber-300")}>{identifier.verification === "provider_verified" ? <CheckCircle2 className="size-4" aria-hidden /> : identifier.verification !== "unbound" ? <TriangleAlert className="size-4" aria-hidden /> : null}{verificationLabel(identifier.verification)}</span>
                  <span className="text-sm text-muted">{identifier.loginAvailable ? t("canPasswordLogin") : t("cannotLogin")} · {identifier.recoveryAvailable ? t("canRecover") : t("cannotRecover")}</span>
                  <Button type="button" variant="secondary" size="sm" disabled>{identifier.maskedValue ? t("changeIdentity") : t("bindIdentity")}</Button>
                </div>;
              })}
              {([["wechat", MessageCircle], ["qq", MessagesSquare]] as const).map(([provider, Icon]) => <div key={provider} className="grid gap-3 py-4 md:grid-cols-[minmax(11rem,1.1fr)_minmax(9rem,1fr)_minmax(10rem,1fr)_auto] md:items-center">
                <div className="flex items-center gap-3"><Icon className="size-5 text-crater" aria-hidden /><div><p className="text-sm font-medium">{t(`identifier_${provider}`)}</p><p className="text-xs text-muted">{t("futureProvider")}</p></div></div>
                <span className="text-sm text-muted">{t("unbound")}</span><span className="text-sm text-muted">{t("manualLinkOnly")}</span><Button type="button" variant="secondary" size="sm" disabled>{t("notAvailable")}</Button>
              </div>)}
            </div>
          </SettingSection>
        </TabsContent>

        <TabsContent value="security" className="m-0">
          <div className="mb-7"><h2 className="text-2xl font-medium text-ink">{t("securityTitle")}</h2><p className="mt-1 text-sm text-muted">{t("securityIntro")}</p></div>
          <SettingSection title={t("passwordTitle")} intro={t("passwordIntro")}>
            <div className="max-w-lg space-y-3">
              <Label htmlFor="new-password">{t("newPassword")}</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
              <Label htmlFor="confirm-password">{t("confirmPassword")}</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} />
              <Button type="button" className="mt-2" disabled={authBusy || !password} onClick={() => void updatePassword()}>{authBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("savePassword")}</Button>
            </div>
          </SettingSection>
          <SettingSection title={t("sessionsTitle")} intro={t("sessionsIntro")}>
            <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line py-4"><div className="flex items-center gap-3"><MonitorSmartphone className="size-5 text-crater" aria-hidden /><div><p className="text-sm font-medium">{t("currentDevice")}</p><p className="text-xs text-muted">{t("currentSession")}</p></div></div><Button type="button" variant="secondary" disabled={authBusy} onClick={() => void revokeOtherSessions()}><LogOut className="size-4" aria-hidden />{t("revokeOtherSessions")}</Button></div>
          </SettingSection>
          <SettingSection id="mfa" title={t("mfaTitle")} intro={isAdmin ? t("mfaAdminRequired") : t("mfaIntro")}>
            <div className="flex flex-wrap items-center gap-3 border-y border-line py-4"><ShieldCheck className="size-5 text-crater" aria-hidden /><span className="text-sm font-medium">{verified.length > 0 ? t("mfaEnabled") : t("mfaDisabled")}</span><span className="text-xs text-muted">{aal === "aal2" ? t("aal2") : t("aal1")}</span>{verified.length === 0 ? <Button type="button" className="ml-auto" disabled={authBusy} onClick={() => void enrollMfa()}>{t("enrollMfa")}</Button> : null}</div>
            {verified.length > 0 ? <ul className="divide-y divide-line border-b border-line">{verified.map((factor) => <li key={factor.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><span className="font-medium">{factor.friendly_name || "TOTP"}</span><span className="text-emerald-700 dark:text-emerald-300">{t("verified")}</span>{aal !== "aal2" ? <Button type="button" className="ml-auto" size="sm" onClick={() => void verifyMfa(factor.id)} disabled={authBusy || !totpCode}>{t("verifySession")}</Button> : null}<Button type="button" className={aal === "aal2" ? "ml-auto" : ""} size="sm" variant="ghost" onClick={() => void removeMfa(factor.id)} disabled={authBusy || (isAdmin && verified.length <= 1)}>{t("removeMfa")}</Button></li>)}</ul> : null}
            {enrollment || (verified.length > 0 && aal !== "aal2") ? <div className="mt-5 grid gap-4 border-l-2 border-crater bg-moon/20 p-4 md:grid-cols-[auto_1fr]">{enrollment ? <Image src={enrollment.qr} alt={t("qrAlt")} width={180} height={180} unoptimized className="bg-white p-2" /> : null}<div className="min-w-0 space-y-3">{enrollment ? <><p className="text-sm text-muted">{t("scanQr")}</p><p className="break-all bg-line/40 p-2 font-mono text-xs">{enrollment.secret}</p></> : null}<Label htmlFor="totp-code">{t("totpCode")}</Label><Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ""))} className="max-w-48 font-mono tracking-[0.3em]" />{enrollment ? <Button type="button" disabled={authBusy || totpCode.length !== 6} onClick={() => void verifyMfa(enrollment.id)}>{t("verifyMfa")}</Button> : null}</div></div> : null}
          </SettingSection>
          <SettingSection title={t("recoveryTitle")} intro={t("recoveryIntro")}>
            <div className="divide-y divide-line border-y border-line">{snapshot.identifiers.map((identifier) => <div key={identifier.kind} className="flex flex-wrap items-center gap-3 py-4 text-sm">{identifier.kind === "email" ? <Mail className="size-4 text-crater" aria-hidden /> : <Smartphone className="size-4 text-crater" aria-hidden />}<span className="font-medium">{t(`identifier_${identifier.kind}`)}</span><span className="text-muted">{identifier.maskedValue ?? t("unbound")}</span><span className={cn("ml-auto", identifier.recoveryAvailable ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>{identifier.recoveryAvailable ? t("canRecover") : t("cannotRecover")}</span></div>)}</div>
          </SettingSection>
        </TabsContent>

        <TabsContent value="privacy" className="m-0">
          <div className="mb-7"><h2 className="text-2xl font-medium text-ink">{t("privacyTitle")}</h2><p className="mt-1 text-sm text-muted">{t("privacyIntro")}</p></div>
          <SettingSection id="consent" title={t("consentTitle")} intro={t("consentIntro")}>
            <ul className="divide-y divide-line border-y border-line">{snapshot.policies.map((policy) => <li key={policy.kind} className="py-4"><div className="flex flex-wrap items-center gap-2"><Link href={policy.documentPath} className="font-medium underline underline-offset-2">{t(`policy_${policy.kind}`)}</Link><span className="text-xs text-muted">{t("version", { version: policy.version })}</span><span className="ml-auto text-xs text-muted">{t(`decision_${policy.decision ?? "missing"}`)}</span></div><div className="mt-3 flex gap-2"><Button type="button" size="sm" disabled={consentRun.pending || policy.decision === "granted"} onClick={() => consentRun.run({ policyKind: policy.kind as ConsentKind, decision: "granted" })}>{t("grant")}</Button><Button type="button" size="sm" variant="secondary" disabled={consentRun.pending || policy.decision === "withdrawn"} onClick={() => consentRun.run({ policyKind: policy.kind as ConsentKind, decision: "withdrawn" })}>{t("withdraw")}</Button></div></li>)}</ul>
          </SettingSection>
          <SettingSection title={t("rightsTitle")} intro={t("rightsIntro")}>
            <div className="max-w-xl space-y-3"><Select value={requestKind} onValueChange={(value) => setRequestKind(value as AccountRequestKind)}><SelectTrigger aria-label={t("requestKind")}><SelectValue /></SelectTrigger><SelectContent>{(["access", "correct", "export", "restrict", "delete"] as const).map((kind) => <SelectItem key={kind} value={kind}>{t(`request_${kind}`)}</SelectItem>)}</SelectContent></Select><Select value={requestScope} onValueChange={setRequestScope}><SelectTrigger aria-label={t("dataScope")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="account">{t("scope_account")}</SelectItem><SelectItem value="account_and_learning">{t("scope_account_and_learning")}</SelectItem></SelectContent></Select><Input value={requestReason} maxLength={1000} onChange={(event) => setRequestReason(event.target.value)} placeholder={t("requestReason")} /><Button type="button" disabled={requestRun.pending || !requestScope.trim()} onClick={() => requestRun.run({ kind: requestKind, reason: requestReason, dataScope: requestScope })}>{t("submitRequest")}</Button></div>
            {snapshot.requests.length > 0 ? <ul className="mt-5 divide-y divide-line border-y border-line">{snapshot.requests.map((request) => <li key={request.id} className="flex flex-wrap items-center gap-2 py-3 text-sm"><span className="font-medium">{t(`request_${request.kind}`)}</span><span className="text-muted">{t(`status_${request.status}`)}</span><span className="ml-auto text-xs text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(request.createdAt))}</span></li>)}</ul> : null}
            {snapshot.exports.length > 0 ? <div className="mt-6 border-t border-line pt-5"><h4 className="text-sm font-medium text-ink">{t("exportsTitle")}</h4><ul className="mt-2 divide-y divide-line border-y border-line">{snapshot.exports.map((artifact) => <li key={artifact.id} className="py-4"><div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{t("exportJson")}</span><span className="text-xs text-muted">{t(`exportStatus_${artifact.status}`)} · {t("exportSize", { size: Math.max(1, Math.ceil(artifact.sizeBytes / 1024)) })}</span><Button type="button" className="ml-auto" size="sm" variant="secondary" disabled={artifact.status !== "ready" || downloadRun.pending} onClick={() => downloadRun.run(artifact.id)}>{downloadRun.pending ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}{t("downloadExport")}</Button></div><p className="mt-2 break-all font-mono text-[11px] text-muted">{t("exportHash", { hash: artifact.artifactHash })}</p><p className="mt-1 text-xs text-muted">{t("exportExpires", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(artifact.expiresAt)) })} · {t("exportDownloads", { count: artifact.downloadCount })}</p></li>)}</ul></div> : null}
          </SettingSection>
        </TabsContent>
      </div>
      </Tabs>
    </>
  );
}
