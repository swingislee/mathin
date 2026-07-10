"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { inputClass } from "./controls";
import {
  createStaffRoleAction,
  deleteStaffRoleAction,
  renameStaffRoleAction,
  setRolePermissionsAction,
} from "./actions";
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
  const [pending, startTransition] = useTransition();

  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null);
  // 勾选集只在「选中角色时」从 props 初始化（事件驱动，不用 effect 同步）；保存成功后与服务端一致
  const [checked, setChecked] = useState<Set<PermissionKey>>(() => new Set(roles[0]?.permKeys ?? []));
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selected = roles.find((role) => role.id === selectedId) ?? null;
  const errText = (code: string) => (KNOWN_ERR.has(code) ? t(`err_${code}`) : t("actionFailed"));

  const selectRole = (role: StaffRoleInfo) => {
    setSelectedId(role.id);
    setChecked(new Set(role.permKeys));
    setError(null);
    setSaved(false);
  };

  const toggle = (key: PermissionKey) => {
    setSaved(false);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = () => {
    if (!selected) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setRolePermissionsAction(selected.id, [...checked]);
      if (!result.ok) {
        setError(errText(result.code));
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const result = await createStaffRoleAction(name);
      if (!result.ok) {
        setError(errText(result.code));
        return;
      }
      setNewName("");
      if (result.roleId) {
        setSelectedId(result.roleId);
        setChecked(new Set());
      }
      router.refresh();
    });
  };

  const confirmRename = (roleId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const result = await renameStaffRoleAction(roleId, name);
      if (!result.ok) {
        setError(errText(result.code));
        return;
      }
      setRenamingId(null);
      router.refresh();
    });
  };

  const remove = (roleId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await deleteStaffRoleAction(roleId);
      if (!result.ok) {
        setError(errText(result.code));
        return;
      }
      if (selectedId === roleId) {
        const fallback = roles.find((role) => role.id !== roleId);
        setSelectedId(fallback?.id ?? null);
        setChecked(new Set(fallback?.permKeys ?? []));
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-72">
        <section className="rounded-xl border border-line bg-card p-4">
          <ul className="space-y-1">
            {roles.map((role) => (
              <li key={role.id} className="flex items-center gap-2">
                {renamingId === role.id ? (
                  <>
                    <input
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
            <input
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
                {saved && <span role="status" className="text-xs text-muted">{t("savedToast")}</span>}
                {error && <span className="text-xs text-rose">{error}</span>}
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
                          <label
                            className={cn("flex items-center gap-2.5 text-sm", configureLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer")}
                            title={configureLocked ? t("configureAdminOnly") : undefined}
                          >
                            <input
                              type="checkbox"
                              checked={checked.has(key)}
                              disabled={configureLocked}
                              onChange={() => toggle(key)}
                              className="size-4 accent-crater"
                            />
                            <span>{t(`perm_${key.replaceAll(".", "_")}`)}</span>
                          </label>
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
