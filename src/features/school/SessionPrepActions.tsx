"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import {
  completeSessionPreparationAction,
  copySessionPreparationAction,
  listSessionPreparationCopyCandidatesAction,
  type SessionPrepCopyCandidate,
} from "./actions/classes";
import type { SessionPrepStatus } from "./teaching-operations/scopes";

/**
 * 进入课前阶段会自动开始备课；复制与完成是两个独立叶子，分别贴近阶段导航和试讲入口。
 * 完成备课会冻结教师当前选择；产物、审核、检查项与 release 状态继续展示，
 * 但 R1-Live 不再把这些质量信号变成阻止教师确认或开课的前置条件。
 */
export function SessionPrepCopyAction({
  sessionId,
  prepStatus,
}: {
  sessionId: string;
  prepStatus: SessionPrepStatus;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const [copyOpen, setCopyOpen] = useState(false);
  const [candidates, setCandidates] = useState<SessionPrepCopyCandidate[] | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [loadingCandidates, startLoadCandidates] = useTransition();
  const copyRun = useAction(copySessionPreparationAction, {
    successMessage: t("prepCopied"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      setCopyOpen(false);
      router.refresh();
    },
  });
  const openCopyDialog = () => {
    setCopyOpen(true);
    if (candidates) return;
    startLoadCandidates(async () => {
      const result = await listSessionPreparationCopyCandidatesAction(sessionId);
      if (result.ok) setCandidates(result.data);
      else toast.error(t("actionFailed"));
    });
  };


  if (prepStatus === "ready") return null;

  return (
    <>
      <Button size="sm" variant="secondary" disabled={copyRun.pending} onClick={openCopyDialog}>
        {t("copyPrep")}
      </Button>
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("copyPrepDialogTitle")}</DialogTitle>
          </DialogHeader>
          {loadingCandidates ? (
            <p className="text-sm text-muted">{t("loading")}</p>
          ) : !candidates || candidates.length === 0 ? (
            <p className="text-sm text-muted">{t("copyPrepEmpty")}</p>
          ) : (
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={t("copyPrepPlaceholder")} /></SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.sessionId} value={candidate.sessionId}>
                    {candidate.classroomName}
                    {candidate.scheduledAt ? ` · ${new Date(candidate.scheduledAt).toLocaleDateString()}` : ""}
                    {candidate.releaseNo ? ` · v${candidate.releaseNo}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCopyOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              disabled={!selectedCandidate || copyRun.pending}
              onClick={() => copyRun.run(sessionId, selectedCandidate)}
            >
              {t("copyPrepConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SessionPrepCompleteAction({
  sessionId,
  prepStatus,
  hasUnpublishedChanges,
}: {
  sessionId: string;
  prepStatus: SessionPrepStatus;
  /** ready 状态下讲次是否已发布比当前采纳更新的 release（doc19 §14.6"显示 update_available"）。 */
  hasUnpublishedChanges: boolean;
}) {
  const t = useTranslations("school.session");
  const router = useRouter();
  const completeRun = useAction(completeSessionPreparationAction, {
    successMessage: t("prepCompleted"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => {
      router.refresh();
    },
  });

  if (prepStatus === "ready" && !hasUnpublishedChanges) return null;

  return (
    <Button size="sm" disabled={completeRun.pending} onClick={() => completeRun.run(sessionId)}>
      {prepStatus === "ready" ? t("updateRelease") : t("completePrep")}
    </Button>
  );
}
