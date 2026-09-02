"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { type ActionErrorMessages, useAction } from "@/components/action-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { fromSelectValue, inputClass, toSelectValue } from "./controls";
import { deactivateStaffAction, findProfileByEmailAction, getStaffHandoverPreviewAction, grantStaffRoleAction, promoteToStaffAction, reissueStaffInitialPasswordAction, revokeStaffRoleAction } from "./actions/staff";
import { type FoundProfile, type StaffImportBatchSummary } from "./actions/types";
import type { ActionResult } from "@/lib/action-result";
import type { StaffMember, StaffRoleInfo } from "./staff";
import { DashboardTableShell } from "./dashboard-page";
import { StaffBulkInvitePanel } from "./StaffBulkInvitePanel";

/** 服务端错误码 → school.staff.err_* 文案；未知码回落 actionFailed。 */
const KNOWN_ERR = new Set([
  "FORBIDDEN",
  "CANNOT_GRANT_SELF",
  "CANNOT_REVOKE_SELF",
  "CANNOT_CHANGE_SELF",
  "TARGET_NOT_STAFF",
  "NOT_FOUND",
  "INVALID_REPLACEMENT",
  "LAST_ACTIVE_ADMIN",
]);

export function StaffMembersPanel({
  members,
  roles,
  recentImportBatches,
  selfId,
  isAdmin,
  canInviteStaff,
  canManageStaff,
}: {
  members: StaffMember[];
  roles: StaffRoleInfo[];
  recentImportBatches: StaffImportBatchSummary[];
  selfId: string;
  isAdmin: boolean;
  canInviteStaff: boolean;
  canManageStaff: boolean;
}) {
  const t = useTranslations("school.staff");
  const router = useRouter();

  // 授岗弹窗：目标成员 + 勾选集（打开时从成员当前岗位初始化，保存时按差异 grant/revoke）
  const [target, setTarget] = useState<StaffMember | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [deactivateTarget, setDeactivateTarget] = useState<StaffMember | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [handoverPreview,setHandoverPreview]=useState<{studentCount:number;futureOverrideCount:number;classroomCount:number}|null>(null);
  const [reissueTarget, setReissueTarget] = useState<StaffMember | null>(null);
  const [reissuedPassword, setReissuedPassword] = useState<string | null>(null);
  const [reissueAuditPending, setReissueAuditPending] = useState(false);

  // 添加员工：邮箱查找 → 命中显示姓名+身份；student/parent 且 admin 才有「提升为员工」
  const [email, setEmail] = useState("");
  const [looking, setLooking] = useState(false);
  const [looked, setLooked] = useState(false);
  const [found, setFound] = useState<FoundProfile | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const errorMessage: ActionErrorMessages = {
    ...Object.fromEntries([...KNOWN_ERR].map((code) => [code, t(`err_${code}`)])),
    default: t("actionFailed"),
  };

  const openDialog = (member: StaffMember) => {
    setTarget(member);
    setChecked(new Set(member.roleIds));
  };

  const toggle = (roleId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const saveRolesAction = async (userId: string, before: Set<string>, after: Set<string>): Promise<ActionResult> => {
    const grants = [...after].filter((id) => !before.has(id));
    const revokes = [...before].filter((id) => !after.has(id));
    for (const roleId of grants) {
      const result = await grantStaffRoleAction(userId, roleId);
      if (!result.ok) return result;
    }
    for (const roleId of revokes) {
      const result = await revokeStaffRoleAction(userId, roleId);
      if (!result.ok) return result;
    }
    return { ok: true };
  };
  const saveRolesRun = useAction(saveRolesAction, {
    successMessage: t("rolesSaved"),
    errorMessage,
    onSuccess: () => { setTarget(null); router.refresh(); },
  });
  const saveRoles = () => { if (target) saveRolesRun.run(target.userId, new Set(target.roleIds), checked); };

  const lookup = () => {
    setLookupError(null);
    setFound(null);
    setLooked(false);
    if (!email.trim()) return;
    setLooking(true);
    findProfileByEmailAction(email).then((result) => {
      if (result.ok) {
        setFound(result.data);
        setLooked(true);
      } else {
        setLookupError(t("actionFailed"));
      }
      setLooking(false);
    });
  };

  const promoteRun = useAction(promoteToStaffAction, {
    successMessage: t("promoteSuccess"),
    errorMessage,
    onSuccess: () => { if (found) setFound({ ...found, identity: "staff" }); router.refresh(); },
  });
  const promote = () => { if (found) promoteRun.run(found.userId); };

  const deactivateRun = useAction(deactivateStaffAction, {
    successMessage: t("deactivateSuccess"),
    errorMessage,
    onSuccess: () => { setDeactivateTarget(null); setReassignTo(""); router.refresh(); },
  });
  const deactivate = () => { if (deactivateTarget) deactivateRun.run(deactivateTarget.userId, reassignTo || null); };

  const reissueRun = useAction(reissueStaffInitialPasswordAction, {
    successMessage: t("initialPasswordReissued"),
    errorMessage: {
      FORBIDDEN: t("err_FORBIDDEN"),
      INITIAL_PASSWORD_NOT_REQUIRED: t("err_INITIAL_PASSWORD_NOT_REQUIRED"),
      INITIAL_PASSWORD_RECORD_MISSING: t("err_INITIAL_PASSWORD_RECORD_MISSING"),
      PASSWORD_REISSUE_IN_PROGRESS: t("err_PASSWORD_REISSUE_IN_PROGRESS"),
      PASSWORD_REISSUE_FINALIZE_FAILED: t("err_PASSWORD_REISSUE_FINALIZE_FAILED"),
      PASSWORD_REISSUE_ROLLBACK_FAILED: t("err_PASSWORD_REISSUE_ROLLBACK_FAILED"),
      AUTH_PROVIDER_FAILED: t("err_AUTH_PROVIDER_FAILED"),
      default: t("actionFailed"),
    },
    onSuccess: (value) => {
      setReissuedPassword(value.initialPassword);
      setReissueAuditPending(value.auditPending);
      router.refresh();
    },
  });

  const openReissue = (member: StaffMember) => {
    setReissueTarget(member);
    setReissuedPassword(null);
    setReissueAuditPending(false);
  };
  const closeReissue = () => {
    setReissueTarget(null);
    setReissuedPassword(null);
    setReissueAuditPending(false);
  };
  const copyReissuedPassword = async () => {
    if (!reissuedPassword) return;
    try {
      await navigator.clipboard.writeText(reissuedPassword);
      toast.success(t("initialPasswordCopied"));
    } catch {
      toast.error(t("initialPasswordCopyFailed"));
    }
  };

  const pending = saveRolesRun.pending || promoteRun.pending || deactivateRun.pending || reissueRun.pending;
  const canManageRoles = (member: StaffMember) => canManageStaff && (member.userId !== selfId || isAdmin);

  // 查到的已是员工：直接从成员列表里找到对应行进授岗弹窗
  const foundMember = found ? members.find((member) => member.userId === found.userId) ?? null : null;

  return (
    <div className="space-y-6">
      <DashboardTableShell>
        <Table className="w-full border-collapse text-left text-sm">
          <TableHeader className="border-b border-line text-xs text-muted">
            <TableRow>
              <TableHead className="px-4 py-3 font-medium">{t("colName")}</TableHead>
              <TableHead className="px-4 py-3 font-medium">{t("colEmail")}</TableHead>
              <TableHead className="px-4 py-3 font-medium">{t("colIdentity")}</TableHead>
              <TableHead className="px-4 py-3 font-medium">{t("colRoles")}</TableHead>
              <TableHead className="px-4 py-3 font-medium"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell className="px-4 py-3 font-medium">
                  {member.displayName}
                  {!member.isActive && <Badge variant="secondary" className="ml-2">{t("inactive")}</Badge>}
                  {member.passwordChangeRequired && <Badge variant="outline" className="ml-2">{t("initialPasswordPending")}</Badge>}
                </TableCell>
                <TableCell className="px-4 py-3 text-muted">{member.email}</TableCell>
                <TableCell className="px-4 py-3">
                  {member.identity === "admin" ? (
                    <span className="rounded-full bg-moon/30 px-2 py-0.5 text-xs text-ink">{t("identityAdmin")}</span>
                  ) : (
                    <span className="rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{t("identityStaff")}</span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3">
                  {member.roleNames.length === 0 ? (
                    <span className="text-xs text-muted">{t("noRoles")}</span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {member.roleNames.map((name) => (
                        <span key={name} className="rounded-full bg-cheek/30 px-2 py-0.5 text-xs text-ink">{name}</span>
                      ))}
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-3">
                    {member.userId === selfId && <span className="text-xs text-muted">{t("selfRow")}</span>}
                    {canManageRoles(member) && (
                      <button type="button" onClick={() => openDialog(member)} className="text-xs text-muted underline underline-offset-2 hover:text-ink">{t("manageRoles")}</button>
                    )}
                    {canInviteStaff && member.passwordChangeRequired && member.isActive && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-0 py-0 text-xs underline underline-offset-2"
                        onClick={() => openReissue(member)}
                      >
                        {t("reissueInitialPassword")}
                      </Button>
                    )}
                    {canManageStaff && member.userId !== selfId && member.isActive && <button type="button" onClick={() => { setDeactivateTarget(member); setReassignTo(""); setHandoverPreview(null); void getStaffHandoverPreviewAction(member.userId).then(setHandoverPreview).catch(()=>{}); }} className="text-xs text-rose underline underline-offset-2">{t("deactivate")}</button>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DashboardTableShell>

      {canInviteStaff ? <StaffBulkInvitePanel roles={roles} recentBatches={recentImportBatches} isAdmin={isAdmin} /> : null}

      {canManageStaff ? <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="text-base font-medium text-ink">{t("addStaff")}</h2>
        <p className="mt-1 text-xs text-muted">{t("addStaffHint")}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && lookup()}
            placeholder={t("emailPlaceholder")}
            className={`min-w-0 flex-1 ${inputClass}`}
          />
          <button
            type="button"
            disabled={looking || pending || !email.trim()}
            onClick={lookup}
            className={cn(buttonVariants({ size: "sm" }), "h-10")}
          >
            {t("lookup")}
          </button>
        </div>
        {lookupError && <p className="mt-3 text-xs text-rose">{lookupError}</p>}
        {looked && !found && <p className="mt-3 text-sm text-muted">{t("noAccount")}</p>}
        {found && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm">
            <span className="font-medium">{found.displayName}</span>
            <span className="rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{t(`identity_${found.identity}`)}</span>
            {(found.identity === "student" || found.identity === "parent") &&
              (isAdmin ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={promote}
                  className={cn(buttonVariants({ size: "sm" }), "ml-auto")}
                >
                  {t("promote")}
                </button>
              ) : (
                <span className="ml-auto text-xs text-muted">{t("promoteAdminOnly")}</span>
              ))}
            {foundMember && canManageRoles(foundMember) && (
              <button
                type="button"
                onClick={() => openDialog(foundMember)}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "ml-auto")}
              >
                {t("manageRoles")}
              </button>
            )}
          </div>
        )}
      </section> : null}

      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("manageRolesFor", { name: target?.displayName ?? "" })}</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2">
            {roles.map((role) => (
              <li key={role.id}>
                <Label className="flex cursor-pointer items-center gap-2.5 text-sm font-normal">
                  <Checkbox
                    checked={checked.has(role.id)}
                    onCheckedChange={() => toggle(role.id)}
                  />
                  <span>{role.name}</span>
                  {role.permKeys.includes("permission.configure") && (
                    <span className="rounded-full bg-moon/30 px-2 py-0.5 text-xs text-ink">{t("configureBearing")}</span>
                  )}
                </Label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <button type="button" onClick={() => setTarget(null)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              {t("cancel")}
            </button>
            <button type="button" disabled={pending} onClick={saveRoles} className={cn(buttonVariants({ size: "sm" }))}>
              {t("save")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(reissueTarget)}
        onOpenChange={(open) => {
          if (!open && !reissueRun.pending) closeReissue();
        }}
      >
        <DialogContent
          showCloseButton={!reissueRun.pending}
          onEscapeKeyDown={(event) => { if (reissueRun.pending) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (reissueRun.pending) event.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle>{t("reissueInitialPasswordTitle", { name: reissueTarget?.displayName ?? "" })}</DialogTitle>
            <DialogDescription>{t("reissueInitialPasswordDescription")}</DialogDescription>
          </DialogHeader>
          {reissuedPassword ? (
            <div role="status" className="space-y-4">
              <div className="grid gap-1.5 border-y border-line py-4 text-sm">
                <span className="text-xs text-muted">{t("reissueInitialPasswordLogin")}</span>
                <span>{reissueTarget?.email}</span>
                <span className="mt-2 text-xs text-muted">{t("reissueInitialPasswordValue")}</span>
                <span className="select-all font-mono text-lg tracking-wider text-ink">{reissuedPassword}</span>
              </div>
              <p className="text-xs leading-5 text-rose">{t("reissueInitialPasswordOneTime")}</p>
              {reissueAuditPending ? (
                <p role="alert" className="text-xs leading-5 text-muted">{t("reissueInitialPasswordAuditPending")}</p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => void copyReissuedPassword()}>
                  <Copy className="size-4" aria-hidden />
                  {t("copyInitialPassword")}
                </Button>
                <Button type="button" onClick={closeReissue}>{t("done")}</Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={reissueRun.pending} onClick={closeReissue}>
                {t("cancel")}
              </Button>
              <Button
                type="button"
                disabled={reissueRun.pending || !reissueTarget}
                onClick={() => { if (reissueTarget) reissueRun.run(reissueTarget.userId); }}
              >
                {reissueRun.pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                {t("confirmReissueInitialPassword")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deactivateTarget)} onOpenChange={(open) => { if (!open) setDeactivateTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("deactivateTitle", { name: deactivateTarget?.displayName ?? "" })}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted">{t("deactivateHint")}</p>
          {handoverPreview&&<ul className="grid gap-2 rounded-xl bg-line/40 p-3 text-sm"><li>{t("handoverStudents",{count:handoverPreview.studentCount})}</li><li>{t("handoverSessions",{count:handoverPreview.futureOverrideCount})}</li><li>{t("handoverClassrooms",{count:handoverPreview.classroomCount})}</li></ul>}
          <Select value={toSelectValue(reassignTo)} onValueChange={(value) => setReassignTo(fromSelectValue(value))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={toSelectValue("")}>{t("noReplacement")}</SelectItem>
              {members.filter((member) => member.isActive && member.userId !== deactivateTarget?.userId).map((member) => (
                <SelectItem key={member.userId} value={member.userId}>{member.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <button type="button" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))} onClick={() => setDeactivateTarget(null)}>{t("cancel")}</button>
            <button type="button" disabled={pending} className={cn(buttonVariants({ size: "sm" }))} onClick={deactivate}>{t("confirmDeactivate")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
