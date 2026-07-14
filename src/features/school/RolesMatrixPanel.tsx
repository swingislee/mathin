"use client";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { type ActionErrorMessages, useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";
import { inputClass } from "./controls";
import { createStaffRoleAction, deleteStaffRoleAction, renameStaffRoleAction, setRolePermissionsAction } from "./actions/staff";
import { PERMISSION_KEYS, type PermissionKey } from "./permissions";
import type { StaffRoleInfo } from "./staff";

/** 权限键按域分组（键前缀即域），组序沿 PERMISSION_KEYS 声明序。 */
const PERM_GROUPS: Array<{ domain: string; keys: PermissionKey[] }> = (() => {
  const groups: Array<{ domain: string; keys: PermissionKey[] }> = [];
  for (const key of PERMISSION_KEYS) {
    const domain = key.split(".")[0];
    const group = groups.find((entry) => entry.domain === domain);
    if (group) group.keys.push(key);
    else groups.push({ domain, keys: [key] });
  }
  return groups;
})();

const KNOWN_ERR = new Set(["FORBIDDEN", "ROLE_NOT_FOUND", "INVALID_NAME", "SYSTEM_ROLE", "ROLE_HAS_MEMBERS", "INVALID_PERMISSION_KEYS"]);

export function RolesMatrixPanel({ roles, isAdmin }: { roles: StaffRoleInfo[]; isAdmin: boolean }) {
  const t = useTranslations("school.roles");
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null);
  // 勾选集只在「选中角色时」从 props 初始化（事件驱动，不用 effect 同步）；保存成功后与服务端一致
  const [checked, setChecked] = useState<Set<PermissionKey>>(() => new Set(roles[0]?.permKeys ?? []));
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const selected = roles.find((role) => role.id === selectedId) ?? null;
  const errorMessage: ActionErrorMessages = {
    ...Object.fromEntries([...KNOWN_ERR].map((code) => [code, t(`err_${code}`)])),
    default: t("actionFailed"),
  };

  const selectRole = (role: StaffRoleInfo) => {
    setSelectedId(role.id);
    setChecked(new Set(role.permKeys));
  };

  const toggle = (key: PermissionKey) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveRun = useAction(setRolePermissionsAction, {
    successMessage: t("savedToast"),
    errorMessage,
    onSuccess: () => router.refresh(),
  });
  const save = () => { if (selected) saveRun.run(selected.id, [...checked]); };

  const createRun = useAction(createStaffRoleAction, {
    successMessage: t("createSuccess"),
    errorMessage,
    onSuccess: (data) => {
      setNewName("");
      setSelectedId(data.roleId);
      setChecked(new Set());
      router.refresh();
    },
  });
  const create = () => { const name = newName.trim(); if (name) createRun.run(name); };

  const renameRun = useAction(renameStaffRoleAction, {
    successMessage: t("renameSuccess"),
    errorMessage,
    onSuccess: () => { setRenamingId(null); router.refresh(); },
  });
  const confirmRename = (roleId: string) => {
    const name = renameValue.trim();
    if (name) renameRun.run(roleId, name);
  };

  // 包一层把 roleId 塞进 ActionResult 的 data，供 onSuccess 判断是否要重置当前选中角色。
  const removeRoleAction = async (roleId: string): Promise<ActionResult<string>> => {
    const result = await deleteStaffRoleAction(roleId);
    return result.ok ? { ok: true, data: roleId } : result;
  };
  const removeRun = useAction(removeRoleAction, {
    successMessage: t("deleteSuccess"),
    errorMessage,
    onSuccess: (roleId) => {
      if (selectedId === roleId) {
        const fallback = roles.find((role) => role.id !== roleId);
        setSelectedId(fallback?.id ?? null);
        setChecked(new Set(fallback?.permKeys ?? []));
      }
      router.refresh();
    },
  });
  const remove = (roleId: string) => removeRun.run(roleId);

  const pending = saveRun.pending || createRun.pending || renameRun.pending || removeRun.pending;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-72">
        <section className="rounded-xl border border-line bg-card p-4">
          <ul className="space-y-1">
            {roles.map((role) => (
              <li key={role.id} className="flex items-center gap-2">
                {renamingId === role.id ? (
                  <>
                    <Input
                      value={renameValue}
                      autoFocus
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && confirmRename(role.id)}
                      className={`min-w-0 flex-1 ${inputClass} py-1.5`}
                    />
                    <button type="button" disabled={pending} onClick={() => confirmRename(role.id)} className="shrink-0 text-xs text-crater underline underline-offset-2 disabled:opacity-40">
                      {t("confirm")}
                    </button>
                    <button type="button" onClick={() => setRenamingId(null)} className="shrink-0 text-xs text-muted underline underline-offset-2">
                      {t("cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => selectRole(role)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                        role.id === selectedId ? "bg-line/50 font-medium" : "hover:bg-line/30",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{role.name}</span>
                      <span className="shrink-0 font-mono text-xs text-muted">{role.memberCount}</span>
                      {role.isSystem && (
                        <span aria-label={t("systemRole")} title={t("systemRole")} className="shrink-0 text-xs text-muted">🔒</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRenamingId(role.id); setRenameValue(role.name); }}
                      className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-ink"
                    >
                      {t("rename")}
                    </button>
                    {!role.isSystem && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => remove(role.id)}
                        className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-rose disabled:opacity-40"
                      >
                        {t("delete")}
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2 border-t border-line pt-4">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && create()}
              placeholder={t("newRolePlaceholder")}
              className={`min-w-0 flex-1 ${inputClass} py-1.5`}
            />
            <button type="button" disabled={pending || !newName.trim()} onClick={create} className={cn(buttonVariants({ size: "sm" }))}>
              {t("newRole")}
            </button>
          </div>
        </section>
      </aside>

      <section className="min-w-0 flex-1 rounded-xl border border-line bg-card p-5">
        {!selected ? (
          <p className="text-sm text-muted">{t("emptyRoles")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium">{t("matrixTitle", { name: selected.name })}</h2>
              <div className="flex items-center gap-3">
                <button type="button" disabled={pending} onClick={save} className={cn(buttonVariants({ size: "sm" }))}>
                  {t("save")}
                </button>
              </div>
            </div>
            <div className="mt-5 space-y-5">
              {PERM_GROUPS.map((group) => (
                <div key={group.domain}>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{t(`domain_${group.domain}`)}</h3>
                  <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {group.keys.map((key) => {
                      const configureLocked = key === "permission.configure" && !isAdmin;
                      return (
                        <li key={key}>
                          <Label
                            className={cn("flex items-center gap-2.5 text-sm font-normal", configureLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer")}
                            title={configureLocked ? t("configureAdminOnly") : undefined}
                          >
                            <Checkbox
                              checked={checked.has(key)}
                              disabled={configureLocked}
                              onCheckedChange={() => toggle(key)}
                            />
                            <span>{t(`perm_${key.replaceAll(".", "_")}`)}</span>
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
