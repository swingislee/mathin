"use client";

import { Ellipsis, LoaderCircle, RotateCcw, Smartphone, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { type ActionErrorMessages, useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import {
  assignStudentAction,
  changeStudentStatusAction,
  provisionStudentPhoneAccountAction,
  restoreStudentAction,
  softDeleteStudentAction,
} from "./actions/students";
import { fromSelectValue, toSelectValue } from "./controls";
import type { StudentStatus } from "./students";

// students.ts 依赖服务端 Supabase；客户端只保留同序常量，避免把 next/headers 带入浏览器包。
const STUDENT_STATUSES: readonly StudentStatus[] = ["lead", "trialing", "enrolled", "paused", "alumni", "invalid"];
const STATUS_TRANSITIONS: Record<StudentStatus, readonly StudentStatus[]> = {
  lead: ["trialing", "invalid"],
  trialing: ["lead", "enrolled", "invalid"],
  enrolled: ["paused", "alumni"],
  paused: ["enrolled", "alumni"],
  alumni: ["enrolled"],
  invalid: ["lead"],
};

export interface StudentAssigneeOption {
  userId: string;
  displayName: string;
}

/**
 * 学生详情的溢出菜单（doc 23 §11）。
 *
 * 原来这些是命令面板里一排同级控件：状态下拉、负责人下拉、开通账号按钮、删除按钮，
 * 全部第一优先级并排。结果是"改状态"和"删除档案"看起来一样重要，而这一页真正的
 * 高频动作——记一条跟进——反而没有位置。
 *
 * 现在主操作只有"记跟进"，其余全部降到这个菜单里，并按危险程度分区：
 * 常规（状态 / 负责人）→ 账号 → 危险（删除 / 恢复）。
 */
export function StudentActionsMenu({
  studentId,
  status,
  assignedTo,
  deleted,
  phone,
  hasAccount,
  canEdit,
  canAssign,
  canDelete,
  assignees,
  ariaLabel,
}: {
  studentId: string;
  status: StudentStatus;
  assignedTo: string | null;
  deleted: boolean;
  phone: string;
  hasAccount: boolean;
  canEdit: boolean;
  canAssign: boolean;
  canDelete: boolean;
  assignees: StudentAssigneeOption[];
  ariaLabel: string;
}) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmProvision, setConfirmProvision] = useState(false);

  const defaultErrorMessage: ActionErrorMessages = { default: t("actionFailed") };

  const changeStatusRun = useAction(changeStudentStatusAction, {
    successMessage: t("statusChanged"),
    errorMessage: defaultErrorMessage,
    onSuccess: () => router.refresh(),
  });
  const assignRun = useAction(assignStudentAction, {
    successMessage: t("assignSuccess"),
    errorMessage: defaultErrorMessage,
    onSuccess: () => router.refresh(),
  });
  const removeRun = useAction(softDeleteStudentAction, {
    successMessage: t("deleteSuccess"),
    errorMessage: { ACTIVE_ENROLLMENT: t("deleteActiveEnrollment"), default: t("actionFailed") },
    onSuccess: () => { router.push("/dashboard/students"); router.refresh(); },
  });
  const restoreRun = useAction(restoreStudentAction, {
    successMessage: t("restoreSuccess"),
    errorMessage: defaultErrorMessage,
    onSuccess: () => router.refresh(),
  });
  const provisionRun = useAction(provisionStudentPhoneAccountAction, {
    successMessage: t("provisionPhoneSuccess"),
    errorMessage: {
      ACCOUNT_ALREADY_LINKED: t("provisionPhoneAlreadyLinked"),
      INVALID_PHONE: t("provisionPhoneInvalid"),
      default: t("provisionPhoneFailed"),
    },
    onSuccess: () => router.refresh(),
  });

  const pending = changeStatusRun.pending || assignRun.pending || removeRun.pending || restoreRun.pending || provisionRun.pending;
  const canProvision = !deleted && canEdit && !hasAccount;
  const showLifecycle = !deleted && (canEdit || canAssign);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="px-2" aria-label={ariaLabel}>
            {pending ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : <Ellipsis size={16} />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <div className="grid gap-3">
            {showLifecycle && canEdit && (
              <Label className="grid gap-1.5">
                <span className="text-xs text-muted">{t("changeStatus")}</span>
                <Select defaultValue={status} disabled={pending} onValueChange={(value) => changeStatusRun.run(studentId, value as StudentStatus)}>
                  <SelectTrigger aria-label={t("changeStatus")} className="h-9 w-full py-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STUDENT_STATUSES.filter((value) => value === status || STATUS_TRANSITIONS[status].includes(value)).map((value) => (
                      <SelectItem key={value} value={value}>{t(value)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
            )}

            {showLifecycle && canAssign && (
              <Label className="grid gap-1.5">
                <span className="text-xs text-muted">{t("assignOwner")}</span>
                <Select
                  defaultValue={toSelectValue(assignedTo ?? "")}
                  disabled={pending}
                  onValueChange={(value) => { const next = fromSelectValue(value); if (next) assignRun.run(studentId, next); }}
                >
                  <SelectTrigger aria-label={t("assignOwner")} className="h-9 w-full py-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{t("assignOwner")}</SelectItem>
                    {assignees.map((person) => <SelectItem key={person.userId} value={person.userId}>{person.displayName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Label>
            )}

            {canProvision && (
              <>
                <Separator />
                <Button type="button" size="sm" variant="ghost" className="justify-start" disabled={pending} onClick={() => setConfirmProvision(true)}>
                  <Smartphone size={15} />{t("provisionPhoneAccount")}
                </Button>
              </>
            )}

            {canDelete && (
              <>
                <Separator />
                {deleted ? (
                  <Button type="button" size="sm" variant="ghost" className="justify-start" disabled={pending} onClick={() => restoreRun.run(studentId)}>
                    <RotateCcw size={15} />{t("restore")}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="ghost" className="justify-start text-rose" disabled={pending} onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={15} />{t("deleteStudent")}
                  </Button>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("deleteStudent")}
        description={t("deleteConfirm")}
        confirmLabel={t("deleteStudent")}
        cancelLabel={t("cancel")}
        onConfirm={() => { setConfirmDelete(false); removeRun.run(studentId); }}
        pending={pending}
      />
      <ConfirmDialog
        open={confirmProvision}
        onOpenChange={setConfirmProvision}
        title={t("provisionPhoneTitle")}
        description={t("provisionPhoneConfirm", { phone: phone || t("none") })}
        confirmLabel={t("provisionPhoneAccount")}
        cancelLabel={t("cancel")}
        onConfirm={() => { setConfirmProvision(false); provisionRun.run(studentId); }}
        pending={pending}
      />
    </>
  );
}
