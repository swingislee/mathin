"use client";

import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import type { StaffOption } from "@/features/school/classes";
import { addCourseCollaboratorAction, assignCourseOwnerAction, removeCourseAssignmentAction } from "./actions";
import type { CourseAssignment, CourseAssignmentResponsibility } from "./types";

const RESPONSIBILITIES: CourseAssignmentResponsibility[] = ["owner", "editor", "reviewer"];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

export function ResponsibilityPanel({
  scopeType,
  scopeId,
  assignments,
  staffOptions,
  canManage,
  title,
}: {
  scopeType: "family" | "variant" | "lecture";
  scopeId: string;
  assignments: CourseAssignment[];
  staffOptions: StaffOption[];
  canManage: boolean;
  title: string;
}) {
  const t = useTranslations("school.courses");
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedResponsibility, setSelectedResponsibility] = useState<CourseAssignmentResponsibility>("editor");
  const [historyOpen, setHistoryOpen] = useState(false);

  const assignOwnerRun = useAction(assignCourseOwnerAction, {
    successMessage: t("responsibilityAssignSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setSelectedUserId(""); router.refresh(); },
  });
  const addCollaboratorRun = useAction(addCourseCollaboratorAction, {
    successMessage: t("responsibilityAssignSuccess"),
    errorMessage: { default: t("actionFailed"), ASSIGNMENT_ALREADY_EXISTS: t("assignmentAlreadyExists") },
    onSuccess: () => { setSelectedUserId(""); router.refresh(); },
  });
  const removeRun = useAction(removeCourseAssignmentAction, {
    successMessage: t("responsibilityRemoveSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const pending = assignOwnerRun.pending || addCollaboratorRun.pending || removeRun.pending;

  const active = assignments.filter((row) => row.archivedAt === null);
  const history = assignments.filter((row) => row.archivedAt !== null);

  const assign = () => {
    if (!selectedUserId) return;
    if (selectedResponsibility === "owner") assignOwnerRun.run(scopeType, scopeId, selectedUserId);
    else addCollaboratorRun.run(scopeType, scopeId, selectedUserId, selectedResponsibility);
  };

  return <section className="rounded-2xl border border-line bg-card p-4">
    <h2 className="font-medium text-ink">{title}</h2>
    <div className="mt-3 grid gap-3">
      {RESPONSIBILITIES.map((responsibility) => {
        const rows = active.filter((row) => row.responsibility === responsibility);
        return <div key={responsibility}>
          <h3 className="text-xs font-medium uppercase text-muted">{t(`responsibility_${responsibility}`)}</h3>
          {rows.length === 0 ? <p className="mt-1 text-sm text-muted">{responsibility === "owner" ? t("noOwnerYet") : t("responsibilityNone")}</p> : (
            <ul className="mt-1 divide-y divide-line">
              {rows.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">{row.userName}</span>
                {canManage && <button type="button" disabled={pending} onClick={() => removeRun.run(row.id)} className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-rose disabled:opacity-40">{t("responsibilityRemove")}</button>}
              </li>)}
            </ul>
          )}
        </div>;
      })}
    </div>

    {canManage && <div className="mt-4 grid grid-cols-[1fr_9rem] gap-2 border-t border-line pt-4">
      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
        <SelectTrigger><SelectValue placeholder={t("responsibilityPickPlaceholder")} /></SelectTrigger>
        <SelectContent>{staffOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={selectedResponsibility} onValueChange={(value) => setSelectedResponsibility(value as CourseAssignmentResponsibility)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{RESPONSIBILITIES.map((responsibility) => <SelectItem key={responsibility} value={responsibility}>{t(`responsibility_${responsibility}`)}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" className="col-span-2" disabled={!selectedUserId || pending} onClick={assign}>
        {pending && <LoaderCircle size={15} className="animate-spin" />}
        {t("responsibilityAdd")}
      </Button>
    </div>}

    {history.length > 0 && <div className="mt-4 border-t border-line pt-3">
      <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="text-xs text-muted underline underline-offset-2">
        {t("responsibilityHistory")} ({history.length})
      </button>
      {historyOpen && <ul className="mt-2 divide-y divide-line text-xs text-muted">
        {history.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-1.5">
          <span className="min-w-0 truncate">{row.userName} · {t(`responsibility_${row.responsibility}`)}</span>
          <span className="shrink-0">{formatDate(row.archivedAt!)}</span>
        </li>)}
      </ul>}
    </div>}
  </section>;
}
