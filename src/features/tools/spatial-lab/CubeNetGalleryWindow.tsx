"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { CubeNetGalleryFoldingBuild } from "@/features/spatial-math/domain";
import { CubeCanvasPanel } from "./CubeWorkbenchControls";
import { CUBE_NET_THUMBNAIL, groupCubeNetTeachingGallery } from "./cube-net-teaching-gallery";
import styles from "./CubeNetGalleryWindow.module.css";

/** 复用画布浮窗；图标固定单元尺寸，超宽只横向滚动，选图后保持打开。 */
export function CubeNetGalleryWindow({ builds, selectedId, busy, closeLabel, onSelect, onClose }: {
  readonly builds: readonly CubeNetGalleryFoldingBuild[];
  readonly selectedId: string;
  readonly busy: boolean;
  readonly closeLabel: string;
  readonly onSelect: (build: CubeNetGalleryFoldingBuild) => void;
  readonly onClose: () => void;
}) {
  const t = useTranslations("tools.spatialLab.cubeNet.manual");
  const items = useMemo(() => groupCubeNetTeachingGallery(builds.map((build) => build.entry)).flatMap((group) => group.items), [builds]);
  const { columns, rows, cellPx } = CUBE_NET_THUMBNAIL;
  return <CubeCanvasPanel title={t("chooseNet")} anchor="bottom" closeLabel={closeLabel} onClose={onClose}>
          <div className={styles.strip} data-cube-net-picker="floating-strip" aria-label={t("galleryWindowHint")}>
            {items.map((item, index) => {
              const width = Math.max(...item.cells.map((cell) => cell.x)) + 1, height = Math.max(...item.cells.map((cell) => cell.y)) + 1;
              const label = t("net", { number: index + 1 });
              return <Button key={item.entry.id} type="button" variant={item.entry.id === selectedId ? "secondary" : "ghost"}
                className={styles.thumbnail} aria-label={label} title={label} aria-pressed={item.entry.id === selectedId}
                disabled={busy} onClick={() => onSelect(builds.find((build) => build.entry.id === item.entry.id)!)}>
                <svg viewBox={`0 0 ${columns} ${rows}`} width={columns * cellPx} height={rows * cellPx} className="!h-16 !w-24 shrink-0" aria-hidden data-cube-net-cell-px={cellPx}>
                  {item.cells.map((cell) => <rect key={`${cell.x},${cell.y}`} x={cell.x + (columns - width) / 2} y={cell.y + (rows - height) / 2}
                    width="1" height="1" rx="0.04" fill="var(--leaf)" stroke="var(--ink)" strokeWidth="0.07" />)}
                </svg>
              </Button>;
            })}
          </div>
  </CubeCanvasPanel>;
}
