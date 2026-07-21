"use client";

import { LoaderCircle, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAction } from "@/components/action-form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  archiveClassroomAction,
  restoreClassroomAction,
  trashClassroomAction,
  transitionClassroomStatusAction,
} from "./actions/classes";
import { ClassroomEditor } from "./ClassroomEditor";
import { ClassroomStaffDialog } from "./ClassroomStaffDialog";
import type { ClassroomDetail, StaffOption, TeachingReadinessRow } from "./classes";
import { ConsumeRuleDialog } from "./ConsumeRuleDialog";
import { hasTeachingReadinessRisk } from "./teaching-operations/readiness";

type LifecycleErrorCode =
  | "FORBIDDEN_SCOPE"
  | "CLASSROOM_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CLASSROOM_PREP_INCOMPLETE"
  | "CLASSROOM_HAS_ACTIVE_ENROLLMENTS"
  | "CLASSROOM_HAS_HISTORY";

/**
 * ObjectBar 只允许"一个主动作+⋯"（doc19 §17.3），把原本散在页头的三个独立
 * Button+Dialog（编辑/人员/课消）和新增的生命周期操作都收进这一个设置 Sheet。
 */
export function ClassroomSettingsSheet({
  classroom,
  staffOptions,
  teachingReadiness,
}: {
  classroom: ClassroomDetail;
  staffOptions: StaffOption[];
  teachingReadiness: TeachingReadinessRow[];
}) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);

  const errorMessage = {
    default: t("actionFailed"),
    FORBIDDEN_SCOPE: t("reasonForbiddenScope"),
    CLASSROOM_NOT_FOUND: t("lifecycleNotFound"),
    INVALID_TRANSITION: t("lifecycleInvalidTransition"),
    CLASSROOM_PREP_INCOMPLETE: t("lifecyclePrepIncomplete"),
    CLASSROOM_HAS_ACTIVE_ENROLLMENTS: t("lifecycleHasActiveEnrollments"),
    CLASSROOM_HAS_HISTORY: t("lifecycleHasHistory"),
  } satisfies Record<LifecycleErrorCode | "default", string>;

  const transitionRun = useAction(transitionClassroomStatusAction, {
    successMessage: t("lifecycleTransitionSuccess"),
    errorMessage,
    onSuccess: () => router.refresh(),
  });
  const trashRun = useAction(trashClassroomAction, {
    successMessage: t("lifecycleTrashSuccess"),
    errorMessage,
    onSuccess: () => { setOpen(false); router.refresh(); },
  });
  const restoreRun = useAction(restoreClassroomAction, {
    successMessage: t("lifecycleRestoreSuccess"),
    errorMessage,
    onSuccess: () => router.refresh(),
  });
  const archiveRun = useAction(
    (archived: boolean) => archiveClassroomAction(classroom.id, archived),
    { successMessage: t("lifecycleArchiveSuccess"), errorMessage, onSuccess: () => router.refresh() },
  );

  const riskyLectureCount = teachingReadiness.filter(hasTeachingReadinessRisk).length;
  const pending = transitionRun.pending || trashRun.pending || restoreRun.pending || archiveRun.pending;

  const activate = () => {
    if (riskyLectureCount > 0) { setConfirmActivate(true); return; }
    transitionRun.run(classroom.id, "active");
  };
  const confirmActivateAnyway = () => { setConfirmActivate(false); transitionRun.run(classroom.id, "active"); };

  return (
    <>
      <Button type="button" size="sm" variant="secondary" aria-label={t("settings")} onClick={() => setOpen(true)}>
        <Settings size={15} />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-md" closeLabel={t("cancel")}>
          <SheetHeader>
            <SheetTitle>{t("settings")}</SheetTitle>
          </SheetHeader>

          <section className="grid gap-2">
            <h3 className="text-xs font-medium uppercase text-muted">{t("settingsBasicInfo")}</h3>
            <div className="flex flex-wrap gap-2">
              <ClassroomEditor classroom={classroom} />
              <ClassroomStaffDialog classroomId={classroom.id} staffAssignments={classroom.staffAssignments} staffOptions={staffOptions} />
              <ConsumeRuleDialog classroomId={classroom.id} />
            </div>
          </section>

          <section className="grid gap-2 border-t border-line pt-4">
            <h3 className="text-xs font-medium uppercase text-muted">{t("settingsLifecycle")}</h3>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">{t("settingsCurrentStatus")}</span>
              <Badge variant="secondary">{t(classroom.operationalStatus === "active" ? "operationalActive" : classroom.operationalStatus)}</Badge>
              {classroom.archivedAt && <Badge variant="outline">{t("archived")}</Badge>}
              {classroom.trashedAt && <Badge variant="outline">{t("trashed")}</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={pending || classroom.operationalStatus !== "planning" || Boolean(classroom.trashedAt)} onClick={activate}>
                {pending && <LoaderCircle size={14} className="animate-spin" />}{t("lifecycleActivate")}
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={pending || classroom.operationalStatus !== "active"} onClick={() => transitionRun.run(classroom.id, "completed")}>
                {t("lifecycleComplete")}
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={pending || Boolean(classroom.trashedAt)} onClick={() => archiveRun.run(!classroom.archivedAt)}>
                {classroom.archivedAt ? t("lifecycleUnarchive") : t("lifecycleArchive")}
              </Button>
              {classroom.trashedAt ? (
                <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => restoreRun.run(classroom.id)}>
                  {t("lifecycleRestore")}
                </Button>
              ) : (
                <Button type="button" size="sm" variant="secondary" disabled={pending || classroom.operationalStatus !== "planning"} onClick={() => trashRun.run(classroom.id)}>
                  {t("lifecycleTrash")}
                </Button>
              )}
            </div>
          </section>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmActivate} onOpenChange={setConfirmActivate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("activateWithRiskTitle")}</DialogTitle>
            <DialogDescription>{t("activateWithRiskBody", { count: riskyLectureCount })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setConfirmActivate(false)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>{t("cancel")}</button>
            <button type="button" onClick={confirmActivateAnyway} className={cn(buttonVariants({ size: "sm" }))}>{t("activateAnyway")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
