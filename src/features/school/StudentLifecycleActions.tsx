"use client";

import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "@/i18n/navigation";
import {
  assignStudentAction,
  changeStudentStatusAction,
  restoreStudentAction,
  softDeleteStudentAction,
} from "./actions";
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmOpen,setConfirmOpen]=useState(false);

  const changeStatus = (next: StudentStatus) => {
    setError(null);
    startTransition(async () => {
      try {
        await changeStudentStatusAction(studentId, next);
        router.refresh();
      } catch {
        setError(t("actionFailed"));
      }
    });
  };

  const assign = (staffUserId: string) => {
    if (!staffUserId) return;
    setError(null);
    startTransition(async () => {
      try {
        await assignStudentAction(studentId, staffUserId);
        router.refresh();
      } catch {
        setError(t("actionFailed"));
      }
    });
  };

  const remove = () => {
    setConfirmOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await softDeleteStudentAction(studentId);
      if (result.ok) {
        router.push("/dashboard/students");
        router.refresh();
      } else {
        setError(result.code === "ACTIVE_ENROLLMENT" ? t("deleteActiveEnrollment") : t("actionFailed"));
      }
    });
  };

  const restore = () => {
    setError(null);
    startTransition(async () => {
      if (await restoreStudentAction(studentId)) router.refresh();
      else setError(t("actionFailed"));
    });
  };

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
      {error && <p role="alert" className="basis-full text-right text-xs text-rose">{error}</p>}
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t("deleteStudent")} description={t("deleteConfirm")} confirmLabel={t("deleteStudent")} cancelLabel={t("cancel")} onConfirm={remove} pending={pending}/>
    </div>
  );
}

export function StudentRestoreButton({ studentId }: { studentId: string }) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          setFailed(false);
          if (await restoreStudentAction(studentId)) router.refresh();
          else setFailed(true);
        })}
        className="text-xs text-crater underline underline-offset-2 disabled:opacity-40"
      >
        {pending ? t("restoring") : t("restore")}
      </button>
      {failed && <span className="text-[11px] text-rose">{t("actionFailed")}</span>}
    </span>
  );
}
