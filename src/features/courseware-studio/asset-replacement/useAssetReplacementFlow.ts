"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  applyCoursewareImageReplacementAction,
  rollbackCoursewareImageReplacementAction,
  stageCoursewareImageReplacementAction,
} from "../actions";
import type { CoursewareSharedAssetDetail } from "../data";
import { selectableIds } from "./AssetUsageTree";
import type { StagedUpload } from "./AssetReplacementPreview";

export function useAssetReplacementFlow({
  detail,
  selectedBindingIds,
  onMutated,
}: {
  detail: CoursewareSharedAssetDetail | null;
  selectedBindingIds: string[];
  onMutated?: () => void;
}) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [staged, setStaged] = useState<StagedUpload | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eligibleIds = useMemo(() => detail ? selectableIds(detail.usages) : [], [detail]);
  const selectedSet = useMemo(() => new Set(selectedBindingIds), [selectedBindingIds]);
  const frozenSelectedCount = useMemo(
    () => detail?.usages
      .filter((usage) => selectedSet.has(usage.bindingId))
      .reduce((count, usage) => count + usage.frozenSessionCount, 0) ?? 0,
    [detail, selectedSet],
  );
  const predictedMode: "publish_pointer" | "branch_rebind" = selectedBindingIds.length === eligibleIds.length
    ? "publish_pointer"
    : "branch_rebind";

  useEffect(() => () => {
    if (staged) URL.revokeObjectURL(staged.previewUrl);
  }, [staged]);

  const stage = () => startTransition(async () => {
    if (!file) return;
    const result = await stageCoursewareImageReplacementAction({ file });
    if (!result.ok) {
      setMessage(t("assetStageFailed", { code: result.code }));
      return;
    }
    setStaged({ ...result.data, previewUrl: URL.createObjectURL(file), fileName: file.name });
    setMessage(t("assetStaged"));
  });

  const apply = () => startTransition(async () => {
    if (!detail || !staged || selectedBindingIds.length === 0) return;
    const result = await applyCoursewareImageReplacementAction({
      sourceSharedAssetId: detail.asset.id,
      selectedBindingIds,
      uploadId: staged.uploadId,
      track: detail.track,
      note,
    });
    if (!result.ok) {
      setMessage(t("assetReplaceFailed", { code: result.code }));
      return;
    }
    setMessage(t(result.data.mode === "publish_pointer" ? "assetPointerUpdated" : "assetBranchCreated", { count: result.data.affectedCount }));
    onMutated?.();
    router.refresh();
  });

  const rollback = () => startTransition(async () => {
    if (!rollbackBatchId) return;
    const result = await rollbackCoursewareImageReplacementAction(rollbackBatchId);
    setRollbackBatchId(null);
    setMessage(result.ok ? t("assetRollbackSucceeded") : t("assetRollbackFailed", { code: result.code }));
    if (result.ok) {
      onMutated?.();
      router.refresh();
    }
  });

  return {
    file,
    setFile,
    staged,
    note,
    setNote,
    message,
    pending,
    predictedMode,
    frozenSelectedCount,
    eligibleCount: eligibleIds.length,
    canStage: !pending && Boolean(file) && selectedBindingIds.length > 0,
    canApply: !pending && Boolean(staged) && selectedBindingIds.length > 0,
    stage,
    apply,
    discardStaged: () => setStaged(null),
    rollbackBatchId,
    requestRollback: setRollbackBatchId,
    cancelRollback: () => setRollbackBatchId(null),
    rollback,
  };
}
