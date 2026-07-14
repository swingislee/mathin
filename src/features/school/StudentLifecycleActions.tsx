"use client";

import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ActionErrorMessages, useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { assignStudentAction, changeStudentStatusAction, restoreStudentAction, softDeleteStudentAction } from "./actions/students";
import { fromSelectValue, toSelectValue } from "./controls";
import type { StudentStatus } from "./students";

// students.ts 依赖服务端 Supabase；客户端只保留同序常量，避免把 next/headers 带入浏览器包。
const STUDENT_STATUSES: readonly StudentStatus[] = ["lead", "trialing", "enrolled", "paused", "alumni", "invalid"];
const STATUS_TRANSITIONS:Record<StudentStatus,readonly StudentStatus[]>={lead:["trialing","invalid"],trialing:["lead","enrolled","invalid"],enrolled:["paused","alumni"],paused:["enrolled","alumni"],alumni:["enrolled"],invalid:["lead"]};

export interface StudentAssigneeOption {
  userId: string;
  displayName: string;
}

export function StudentLifecycleActions({
  studentId,
  status,
  assignedTo,
  deleted,
  canEdit,
  canAssign,
  canDelete,
  assignees,
}: {
  studentId: string;
  status: StudentStatus;
  assignedTo: string | null;
  deleted: boolean;
  canEdit: boolean;
  canAssign: boolean;
  canDelete: boolean;
  assignees: StudentAssigneeOption[];
}) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const [confirmOpen,setConfirmOpen]=useState(false);

  const defaultErrorMessage: ActionErrorMessages = { default: t("actionFailed") };

  const changeStatusRun = useAction(changeStudentStatusAction, {
    successMessage: t("statusChanged"),
    errorMessage: defaultErrorMessage,
    onSuccess: () => router.refresh(),
  });
  const changeStatus = (next: StudentStatus) => changeStatusRun.run(studentId, next);

  const assignRun = useAction(assignStudentAction, {
    successMessage: t("assignSuccess"),
    errorMessage: defaultErrorMessage,
    onSuccess: () => router.refresh(),
  });
  const assign = (staffUserId: string) => { if (staffUserId) assignRun.run(studentId, staffUserId); };

  const removeRun = useAction(softDeleteStudentAction, {
    successMessage: t("deleteSuccess"),
    errorMessage: { ACTIVE_ENROLLMENT: t("deleteActiveEnrollment"), default: t("actionFailed") },
    onSuccess: () => { router.push("/dashboard/students"); router.refresh(); },
  });
  const remove = () => { setConfirmOpen(false); removeRun.run(studentId); };

  const restoreRun = useAction(restoreStudentAction, {
    successMessage: t("restoreSuccess"),
    errorMessage: defaultErrorMessage,
    onSuccess: () => router.refresh(),
  });
  const restore = () => restoreRun.run(studentId);

  const pending = changeStatusRun.pending || assignRun.pending || removeRun.pending || restoreRun.pending;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {pending && <LoaderCircle size={16} className="animate-spin text-muted motion-reduce:animate-none" />}
      {!deleted && canEdit && (
        <Label>
          <span className="sr-only">{t("changeStatus")}</span>
          <Select
            defaultValue={status}
            disabled={pending}
            onValueChange={(value) => changeStatus(value as StudentStatus)}
          >
            <SelectTrigger aria-label={t("changeStatus")} className="h-9 w-auto py-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STUDENT_STATUSES.filter((value)=>value===status||STATUS_TRANSITIONS[status].includes(value)).map((value) => <SelectItem key={value} value={value}>{t(value)}</SelectItem>)}
            </SelectContent>
          </Select>
        </Label>
      )}
      {!deleted && canAssign && (
        <Label>
          <span className="sr-only">{t("assignOwner")}</span>
          <Select
            defaultValue={toSelectValue(assignedTo ?? "")}
            disabled={pending}
            onValueChange={(value) => assign(fromSelectValue(value))}
          >
            <SelectTrigger aria-label={t("assignOwner")} className="h-9 w-auto max-w-44 py-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={toSelectValue("")}>{t("assignOwner")}</SelectItem>
              {assignees.map((person) => <SelectItem key={person.userId} value={person.userId}>{person.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
        </Label>
      )}
      {!deleted && canDelete && (
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={()=>setConfirmOpen(true)} className="gap-1.5 text-rose">
          <Trash2 size={15} />{t("deleteStudent")}
        </Button>
      )}
      {deleted && canDelete && (
        <Button type="button" size="sm" disabled={pending} onClick={restore} className="gap-1.5">
          <RotateCcw size={15} />{t("restore")}
        </Button>
      )}
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t("deleteStudent")} description={t("deleteConfirm")} confirmLabel={t("deleteStudent")} cancelLabel={t("cancel")} onConfirm={remove} pending={pending}/>
    </div>
  );
}

export function StudentRestoreButton({ studentId }: { studentId: string }) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const { run, pending } = useAction(restoreStudentAction, {
    successMessage: t("restoreSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(studentId)}
      className="text-xs text-crater underline underline-offset-2 disabled:opacity-40"
    >
      {pending ? t("restoring") : t("restore")}
    </button>
  );
}
