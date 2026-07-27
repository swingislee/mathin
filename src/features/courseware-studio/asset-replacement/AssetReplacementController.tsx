"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ObjectBar,
  ObjectWorkspace,
  TrackSwitcher,
  WorkspaceMain,
  WorkspaceRail,
  WorkspaceSplitShell,
} from "@/features/school/object-workspace";
import { useRouter } from "@/i18n/navigation";
import {
  applyCoursewareImageReplacementAction,
  rollbackCoursewareImageReplacementAction,
  stageCoursewareImageReplacementAction,
} from "../actions";
import type { CoursewareSharedAssetDetail } from "../data";
import { AssetReplacementPreview, type StagedUpload } from "./AssetReplacementPreview";
import { AssetReplacementRail } from "./AssetReplacementRail";
import { AssetUsageTree, selectableIds } from "./AssetUsageTree";

/**
 * 素材替换工作区（doc 23 §13）。
 *
 * 重建前这是一个 250 行的单体组件，同时拥有：轨道导航（自己的 `<nav>`）、页面级
 * 两栏网格（自己的 `xl:grid-cols`）、使用树、勾选状态、上传、暂存、新旧对比、
 * 替换影响、应用、回滚、右侧栏。外面还套着一层 `DashboardPage`，标题写死"素材详情"——
 * 一个专业编辑器被当成普通页面渲染，于是外层页面滚动叠着内部长内容一起滚。
 *
 * 现在：路由合同把它标成 panel，页面外壳换成 ObjectWorkspace internal；
 * 导航、分栏、Rail 全部用通用原语；业务拆成使用树 / 对比 / Rail / 历史四个组件。
 * 这个 Controller 只剩它真正该有的东西——状态与 action 编排，不再拥有页面布局。
 */
export function AssetReplacementController({ detail, backHref }: { detail: CoursewareSharedAssetDetail; backHref: string }) {
  // 资源指针或使用树变化后，以 key 重置仅属于旧资源的本地状态（上传、勾选）。
  const scope = `${detail.track}:${detail.asset.id}:${detail.asset.publishedRevisionId}:${detail.usages.map((usage) => `${usage.bindingId}:${usage.pinnedRevisionId ?? ""}`).join(",")}`;
  return <AssetReplacementControllerBody key={scope} detail={detail} backHref={backHref} />;
}

function AssetReplacementControllerBody({ detail, backHref }: { detail: CoursewareSharedAssetDetail; backHref: string }) {
  const t = useTranslations("coursewareStudio");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectableIds(detail.usages)));
  const [file, setFile] = useState<File | null>(null);
  const [staged, setStaged] = useState<StagedUpload | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const eligible = useMemo(() => selectableIds(detail.usages), [detail.usages]);
  const selectedIds = useMemo(() => eligible.filter((id) => selected.has(id)), [eligible, selected]);
  const frozenSelectedCount = useMemo(
    () => detail.usages.filter((usage) => selected.has(usage.bindingId)).reduce((count, usage) => count + usage.frozenSessionCount, 0),
    [detail.usages, selected],
  );
  const predictedMode = selectedIds.length === eligible.length ? "publish_pointer" : "branch_rebind";

  useEffect(() => () => {
    if (staged) URL.revokeObjectURL(staged.previewUrl);
  }, [staged]);

  const toggle = (ids: string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

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
    if (!staged || selectedIds.length === 0) return;
    const result = await applyCoursewareImageReplacementAction({
      sourceSharedAssetId: detail.asset.id,
      selectedBindingIds: selectedIds,
      uploadId: staged.uploadId,
      track: detail.track,
      note,
    });
    if (!result.ok) {
      setMessage(t("assetReplaceFailed", { code: result.code }));
      return;
    }
    setMessage(t(result.data.mode === "publish_pointer" ? "assetPointerUpdated" : "assetBranchCreated", { count: result.data.affectedCount }));
    router.refresh();
  });

  const rollback = () => startTransition(async () => {
    if (!rollbackBatchId) return;
    const result = await rollbackCoursewareImageReplacementAction(rollbackBatchId);
    setRollbackBatchId(null);
    setMessage(result.ok ? t("assetRollbackSucceeded") : t("assetRollbackFailed", { code: result.code }));
    if (result.ok) router.refresh();
  });

  const trackLabel = detail.track === "adapted-4x3" ? t("trackAdapted") : t("trackNative");
  const detailHref = (track: "native-16x9" | "adapted-4x3") => `/dashboard/courseware-assets/${detail.asset.id}?track=${track}`;

  return (
    <>
      <ObjectWorkspace
        scroll="internal"
        objectBar={
          <ObjectBar
            // §13.2：标题是素材名而不是通用的"素材详情"。同一个替换流程会连着开好几个
            // 素材，全都叫"素材详情"等于标签页上没有信息。
            title={detail.asset.name || t("unnamedAsset")}
            backHref={backHref}
            backLabel={t("backToAssetLibrary")}
            context={[
              { value: detail.asset.mime },
              { value: `${detail.asset.width} × ${detail.asset.height}` },
              { value: `r${detail.asset.publishedRevisionNo}` },
            ]}
            status={<Badge variant="secondary">{t("assetSelectableCount", { selected: selectedIds.length, total: eligible.length })}</Badge>}
          />
        }
        navigation={
          <TrackSwitcher
            items={[
              { value: "native-16x9", label: t("trackNative"), href: detailHref("native-16x9") },
              { value: "adapted-4x3", label: t("trackAdapted"), href: detailHref("adapted-4x3") },
            ]}
            activeValue={detail.track}
            ariaLabel={t("assetTrack")}
          />
        }
      >
        <WorkspaceSplitShell
          main={
            <WorkspaceMain>
              <AssetUsageTree
                usages={detail.usages}
                selected={selected}
                onToggle={toggle}
                selectedCount={selectedIds.length}
                eligibleCount={eligible.length}
                trackLabel={trackLabel}
              />
              {staged ? (
                <AssetReplacementPreview
                  currentPreviewUrl={detail.asset.previewUrl}
                  staged={staged}
                  selectedCount={selectedIds.length}
                  unselectedCount={eligible.length - selectedIds.length}
                  frozenSelectedCount={frozenSelectedCount}
                  mode={predictedMode}
                  trackLabel={trackLabel}
                />
              ) : null}
            </WorkspaceMain>
          }
          rail={
            <WorkspaceRail title={t("assetReplacementRailTitle")}>
              <AssetReplacementRail
                asset={detail.asset}
                batches={detail.batches}
                staged={staged}
                note={note}
                pending={pending}
                canStage={!pending && Boolean(file) && selectedIds.length > 0}
                canApply={!pending && Boolean(staged) && selectedIds.length > 0}
                message={message}
                onFileChange={setFile}
                onNoteChange={setNote}
                onStage={stage}
                onApply={apply}
                onDiscardStaged={() => setStaged(null)}
                onRollback={setRollbackBatchId}
              />
            </WorkspaceRail>
          }
        />
      </ObjectWorkspace>

      <ConfirmDialog
        open={rollbackBatchId !== null}
        onOpenChange={(open) => { if (!open) setRollbackBatchId(null); }}
        title={t("assetRollbackConfirmTitle")}
        description={t("assetRollbackConfirmDescription")}
        confirmLabel={t("assetRollback")}
        cancelLabel={t("cancel")}
        onConfirm={rollback}
        pending={pending}
      />
    </>
  );
}
