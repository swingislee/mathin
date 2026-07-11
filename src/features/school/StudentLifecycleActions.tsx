"use client";

import { LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import {
  assignStudentAction,
  changeStudentStatusAction,
  restoreStudentAction,
  softDeleteStudentAction,
} from "./actions";
import { selectClass } from "./controls";
import type { StudentStatus } from "./students";

// students.ts 依赖服务端 Supabase；客户端只保留同序常量，避免把 next/headers 带入浏览器包。
const STUDENT_STATUSES: readonly StudentStatus[] = ["lead", "trialing", "enrolled", "paused", "alumni", "invalid"];

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
    if (!window.confirm(t("deleteConfirm"))) return;
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
        <label>
          <span className="sr-only">{t("changeStatus")}</span>
          <select
            aria-label={t("changeStatus")}
            defaultValue={status}
            disabled={pending}
            onChange={(event) => changeStatus(event.target.value as StudentStatus)}
            className={`${selectClass} h-9 w-auto py-1.5`}
          >
            {STUDENT_STATUSES.map((value) => <option key={value} value={value}>{t(value)}</option>)}
          </select>
        </label>
      )}
      {!deleted && canAssign && (
        <label>
          <span className="sr-only">{t("assignOwner")}</span>
          <select
            aria-label={t("assignOwner")}
            defaultValue={assignedTo ?? ""}
            disabled={pending}
            onChange={(event) => assign(event.target.value)}
            className={`${selectClass} h-9 w-auto max-w-44 py-1.5`}
          >
            <option value="">{t("assignOwner")}</option>
            {assignees.map((person) => <option key={person.userId} value={person.userId}>{person.displayName}</option>)}
          </select>
        </label>
      )}
      {!deleted && canDelete && (
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={remove} className="gap-1.5 text-rose">
          <Trash2 size={15} />{t("deleteStudent")}
        </Button>
      )}
      {deleted && canDelete && (
        <Button type="button" size="sm" disabled={pending} onClick={restore} className="gap-1.5">
          <RotateCcw size={15} />{t("restore")}
        </Button>
      )}
      {error && <p role="alert" className="basis-full text-right text-xs text-rose">{error}</p>}
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
