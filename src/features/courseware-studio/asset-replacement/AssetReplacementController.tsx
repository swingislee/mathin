"use client";

import { useMemo, useState } from "react";
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
import type { CoursewareSharedAssetDetail } from "../data";
import { AssetReplacementPreview } from "./AssetReplacementPreview";
import { AssetReplacementRail } from "./AssetReplacementRail";
import { AssetUsageTree, selectableIds } from "./AssetUsageTree";
import { useAssetReplacementFlow } from "./useAssetReplacementFlow";

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
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectableIds(detail.usages)));

  const eligible = useMemo(() => selectableIds(detail.usages), [detail.usages]);
  const selectedIds = useMemo(() => eligible.filter((id) => selected.has(id)), [eligible, selected]);
  const replacement = useAssetReplacementFlow({ detail, selectedBindingIds: selectedIds });

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
              {replacement.staged ? (
                <AssetReplacementPreview
                  currentPreviewUrl={detail.asset.previewUrl}
                  staged={replacement.staged}
                  selectedCount={selectedIds.length}
                  unselectedCount={eligible.length - selectedIds.length}
                  frozenSelectedCount={replacement.frozenSelectedCount}
                  mode={replacement.predictedMode}
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
                staged={replacement.staged}
                note={replacement.note}
                pending={replacement.pending}
                canStage={replacement.canStage}
                canApply={replacement.canApply}
                message={replacement.message}
                onFileChange={replacement.setFile}
                onNoteChange={replacement.setNote}
                onStage={replacement.stage}
                onApply={replacement.apply}
                onDiscardStaged={replacement.discardStaged}
                onRollback={replacement.requestRollback}
              />
            </WorkspaceRail>
          }
        />
      </ObjectWorkspace>

      <ConfirmDialog
        open={replacement.rollbackBatchId !== null}
        onOpenChange={(open) => { if (!open) replacement.cancelRollback(); }}
        title={t("assetRollbackConfirmTitle")}
        description={t("assetRollbackConfirmDescription")}
        confirmLabel={t("assetRollback")}
        cancelLabel={t("cancel")}
        onConfirm={replacement.rollback}
        pending={replacement.pending}
      />
    </>
  );
}
