"use client";

import { useMemo } from "react";
import { Scissors, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CubeNetGalleryFoldingBuild } from "@/features/spatial-math/domain";
import { CubeIconButton } from "./CubeWorkbenchControls";
import { CUBE_NET_THUMBNAIL, groupCubeNetTeachingGallery } from "./cube-net-teaching-gallery";
import styles from "./CubeNetGalleryWindow.module.css";

/** 与画布并排的非模态图谱窗口，选图后保持打开，不使用遮罩或焦点锁。 */
export function CubeNetGalleryWindow({ builds, selectedId, busy, closeLabel, onSelect, onCut, onClose }: {
  readonly builds: readonly CubeNetGalleryFoldingBuild[];
  readonly selectedId: string;
  readonly busy: boolean;
  readonly closeLabel: string;
  readonly onSelect: (build: CubeNetGalleryFoldingBuild) => void;
  readonly onCut: () => void;
  readonly onClose: () => void;
}) {
  const t = useTranslations("tools.spatialLab.cubeNet.manual");
  const items = useMemo(() => groupCubeNetTeachingGallery(builds.map((build) => build.entry)).flatMap((group) => group.items), [builds]);
  const { columns, rows, cellPx } = CUBE_NET_THUMBNAIL;
  return <aside className={styles.window} aria-label={t("chooseNet")} data-cube-net-picker="docked">
    <div className={styles.header}><h2 className="text-sm font-medium">{t("chooseNet")}</h2>
      <CubeIconButton label={closeLabel} onClick={onClose}><X aria-hidden /></CubeIconButton></div>
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 p-2">
        <p className="text-xs leading-5 text-muted">{t("galleryWindowHint")}</p>
          <div className={styles.thumbnails}>
            {items.map((item, index) => {
              const width = Math.max(...item.cells.map((cell) => cell.x)) + 1, height = Math.max(...item.cells.map((cell) => cell.y)) + 1;
              const label = t("net", { number: index + 1 });
              return <Button key={item.entry.id} type="button" variant={item.entry.id === selectedId ? "secondary" : "ghost"}
                className="h-auto min-w-0 w-full flex-col gap-0 p-0 pb-1 text-[11px]" aria-label={label} aria-pressed={item.entry.id === selectedId}
                disabled={busy} onClick={() => onSelect(builds.find((build) => build.entry.id === item.entry.id)!)}>
                <svg viewBox={`0 0 ${columns} ${rows}`} width={columns * cellPx} height={rows * cellPx} className="!h-auto !w-full max-w-24 shrink-0" aria-hidden data-cube-net-cell-px={cellPx}>
                  {item.cells.map((cell) => <rect key={`${cell.x},${cell.y}`} x={cell.x + (columns - width) / 2} y={cell.y + (rows - height) / 2}
                    width="1" height="1" rx="0.04" fill="var(--leaf)" stroke="var(--ink)" strokeWidth="0.07" />)}
                </svg>
                <span>{label}</span>
              </Button>;
            })}
          </div>
      </div>
    </ScrollArea>
    <div className="p-2"><Button size="sm" variant="secondary" className="w-full" disabled={busy} onClick={onCut}><Scissors aria-hidden />{t("cutEntry")}</Button></div>
  </aside>;
}
