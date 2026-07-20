"use client";

import { LoaderCircle, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { assignClassroomStaffAction, removeClassroomStaffAction } from "./actions/classroom-staff";
import type { StaffAssignmentSummary, StaffOption } from "./classes";

type Responsibility = "primary_teacher" | "assistant_teacher" | "learning_support";

const RESPONSIBILITIES: Responsibility[] = ["primary_teacher", "assistant_teacher", "learning_support"];

export function ClassroomStaffDialog({
  classroomId,
  staffAssignments,
  staffOptions,
}: {
  classroomId: string;
  staffAssignments: StaffAssignmentSummary[];
  staffOptions: StaffOption[];
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedResponsibility, setSelectedResponsibility] = useState<Responsibility>("learning_support");

  const assignRun = useAction(assignClassroomStaffAction, {
    successMessage: t("staffAssignSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => { setSelectedUserId(""); router.refresh(); },
  });
  const removeRun = useAction(removeClassroomStaffAction, {
    successMessage: t("staffRemoveSuccess"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });
  const pending = assignRun.pending || removeRun.pending;

  const byResponsibility = (responsibility: Responsibility) => staffAssignments.filter((row) => row.responsibility === responsibility);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className="gap-1.5">
        <UserCog size={15} />
        {t("staffDialogTitle")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("staffDialogTitle")}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            {RESPONSIBILITIES.map((responsibility) => (
              <div key={responsibility}>
                <h3 className="text-xs font-medium uppercase text-muted">{t(`responsibility_${responsibility}`)}</h3>
                {byResponsibility(responsibility).length === 0 ? (
                  <p className="mt-1 text-sm text-muted">{t("staffNone")}</p>
                ) : (
                  <ul className="mt-1 divide-y divide-line">
                    {byResponsibility(responsibility).map((row) => (
                      <li key={`${row.userId}-${row.responsibility}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                        <span className="min-w-0 truncate">{row.name}</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => removeRun.run(classroomId, row.userId, row.responsibility)}
                          className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-rose disabled:opacity-40"
                        >
                          {t("staffRemove")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[1fr_9rem] gap-2 border-t border-line pt-4">
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger><SelectValue placeholder={t("staffPickPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {staffOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedResponsibility} onValueChange={(value) => setSelectedResponsibility(value as Responsibility)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESPONSIBILITIES.map((responsibility) => (
                  <SelectItem key={responsibility} value={responsibility}>{t(`responsibility_${responsibility}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              disabled={!selectedUserId || pending}
              onClick={() => assignRun.run(classroomId, selectedUserId, selectedResponsibility)}
            >
              {pending && <LoaderCircle size={15} className="animate-spin" />}
              {t("staffAdd")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
