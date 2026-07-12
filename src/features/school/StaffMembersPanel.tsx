"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Input } from "@/components/ui/input";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { inputClass } from "./controls";
import {
  findProfileByEmailAction,
  grantStaffRoleAction,
  promoteToStaffAction,
  revokeStaffRoleAction,
  type FoundProfile,
  type StaffActionResult,
} from "./actions";
import type { StaffMember, StaffRoleInfo } from "./staff";

/** 服务端错误码 → school.staff.err_* 文案；未知码回落 actionFailed。 */
const KNOWN_ERR = new Set([
  "FORBIDDEN",
  "CANNOT_GRANT_SELF",
  "CANNOT_REVOKE_SELF",
  "CANNOT_CHANGE_SELF",
  "TARGET_NOT_STAFF",
  "NOT_FOUND",
]);

export function StaffMembersPanel({
  members,
  roles,
  selfId,
  isAdmin,
}: {
  members: StaffMember[];
  roles: StaffRoleInfo[];
  selfId: string;
  isAdmin: boolean;
}) {
  const t = useTranslations("school.staff");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // 授岗弹窗：目标成员 + 勾选集（打开时从成员当前岗位初始化，保存时按差异 grant/revoke）
  const [target, setTarget] = useState<StaffMember | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dialogError, setDialogError] = useState<string | null>(null);

  // 添加员工：邮箱查找 → 命中显示姓名+身份；student/parent 且 admin 才有「提升为员工」
  const [email, setEmail] = useState("");
  const [looking, setLooking] = useState(false);
  const [looked, setLooked] = useState(false);
  const [found, setFound] = useState<FoundProfile | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const errText = (code: string) => (KNOWN_ERR.has(code) ? t(`err_${code}`) : t("actionFailed"));

  const openDialog = (member: StaffMember) => {
    setTarget(member);
    setChecked(new Set(member.roleIds));
    setDialogError(null);
  };

  const toggle = (roleId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const saveRoles = () => {
    if (!target) return;
    setDialogError(null);
    startTransition(async () => {
      const before = new Set(target.roleIds);
      const grants = [...checked].filter((id) => !before.has(id));
      const revokes = [...before].filter((id) => !checked.has(id));
      let failed: StaffActionResult | null = null;
      for (const roleId of grants) {
        const result = await grantStaffRoleAction(target.userId, roleId);
        if (!result.ok) { failed = result; break; }
      }
      if (!failed) {
        for (const roleId of revokes) {
          const result = await revokeStaffRoleAction(target.userId, roleId);
          if (!result.ok) { failed = result; break; }
        }
      }
      if (failed && !failed.ok) {
        setDialogError(errText(failed.code));
        router.refresh(); // 部分成功也要回真身：重取列表对齐服务端
        return;
      }
      setTarget(null);
      router.refresh();
    });
  };

  const lookup = () => {
    setLookupError(null);
    setFound(null);
    setLooked(false);
    if (!email.trim()) return;
    setLooking(true);
    startTransition(async () => {
      try {
        const profile = await findProfileByEmailAction(email);
        setFound(profile);
        setLooked(true);
      } catch {
        setLookupError(t("actionFailed"));
      } finally {
        setLooking(false);
      }
    });
  };

  const promote = () => {
    if (!found) return;
    setLookupError(null);
    startTransition(async () => {
      const result = await promoteToStaffAction(found.userId);
      if (!result.ok) {
        setLookupError(errText(result.code));
        return;
      }
      setFound({ ...found, identity: "staff" });
      router.refresh();
    });
  };

  // 查到的已是员工：直接从成员列表里找到对应行进授岗弹窗
  const foundMember = found ? members.find((member) => member.userId === found.userId) ?? null : null;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-line bg-card">
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
          <TableBody className="divide-y divide-line">
            {members.map((member) => (
              <TableRow key={member.userId}>
                <TableCell className="px-4 py-3 font-medium">{member.displayName}</TableCell>
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
                  {member.userId === selfId ? (
                    <span className="text-xs text-muted">{t("selfRow")}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openDialog(member)}
                      className="text-xs text-muted underline underline-offset-2 hover:text-ink"
                    >
                      {t("manageRoles")}
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-medium">{t("addStaff")}</h2>
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
            {foundMember && foundMember.userId !== selfId && (
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
      </section>

      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("manageRolesFor", { name: target?.displayName ?? "" })}</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2">
            {roles.map((role) => (
              <li key={role.id}>
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <Input
                    type="checkbox"
                    checked={checked.has(role.id)}
                    onChange={() => toggle(role.id)}
                    className="size-4 accent-crater"
                  />
                  <span>{role.name}</span>
                  {role.permKeys.includes("permission.configure") && (
                    <span className="rounded-full bg-moon/30 px-2 py-0.5 text-xs text-ink">{t("configureBearing")}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          {dialogError && <p className="text-xs text-rose">{dialogError}</p>}
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
    </div>
  );
}
