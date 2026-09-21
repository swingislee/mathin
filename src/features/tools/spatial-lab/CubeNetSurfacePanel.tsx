"use client";

import { SpatialActionButton } from "../spatial-interaction/SpatialActionButton";


import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SpatialCanvasPanel, SpatialColorPicker, SpatialIconButton, SpatialMarkIcon } from "../spatial-interaction/SpatialWorkbenchControls";
import { SpatialOpacitySlider } from "../spatial-interaction/SpatialOpacitySlider";
import { CUBE_COLORS, CUBE_MARK_SHAPES, type CubeColor, type CubeMarkShape } from "./cube-structures-contract";
import { cubeStructuresMessages } from "./cube-structures-messages";
import type { CubeNetSurfaces, CubeNetSurfaceOperation, CubeNetSurfaceTool } from "./cube-net-surfaces";

export interface CubeNetSurfaceBrush { readonly color: CubeColor; readonly opacity: number; readonly mark: "letter" | CubeMarkShape | null }
export const DEFAULT_CUBE_NET_BRUSH: CubeNetSurfaceBrush = { color: CUBE_COLORS[1], opacity: 30, mark: "letter" };
export function cubeNetBrushOperation(tool: CubeNetSurfaceTool, brush: CubeNetSurfaceBrush, ids: readonly string[]): CubeNetSurfaceOperation {
  switch (tool) {
    case "face": return { kind: "paint", ids, color: brush.color };
    case "transparent": return { kind: "opacity", ids, opacity: brush.opacity / 100 };
    case "mark": return { kind: "mark", ids, mark: brush.mark ? { kind: brush.mark, color: brush.color } : null };
    case "number": return { kind: "number", id: ids[0], color: brush.color };
  }
}

export function CubeNetSurfacePanel({ locale, tool, brush, surfaces, identities, selected, busy, onBrush, onApply, onPreview, onClose }: {
  readonly locale: "zh" | "en"; readonly tool: CubeNetSurfaceTool; readonly brush: CubeNetSurfaceBrush;
  readonly surfaces: CubeNetSurfaces; readonly identities: readonly string[]; readonly selected: string | null; readonly busy: boolean;
  readonly onBrush: (brush: CubeNetSurfaceBrush) => void; readonly onApply: (operation: CubeNetSurfaceOperation) => void;
  readonly onPreview: (value: number | null) => void; readonly onClose: () => void;
}) {
  const t = useTranslations("tools.spatialLab.cubeNet.manual.surface");
  const m = cubeStructuresMessages(locale);
  const title = tool === "mark" ? t("mark") : m[tool];
  return <SpatialCanvasPanel title={title} closeLabel={m.closePanel} onClose={onClose}>
    <div className="space-y-3 text-xs" data-cube-net-surface-panel={tool}>
      <p className="leading-5 text-muted">{t(`${tool}Hint`)}</p>
      {tool !== "transparent" && <SpatialColorPicker value={brush.color} labels={m.colors} label={m.colorLabel} disabled={busy} onChange={(color) => onBrush({ ...brush, color })} />}
      {tool === "mark" && <div className="flex flex-wrap gap-1">
        <Button size="sm" variant={brush.mark === "letter" ? "secondary" : "ghost"} aria-pressed={brush.mark === "letter"} disabled={busy} onClick={() => onBrush({ ...brush, mark: "letter" })}>{t("letters")}</Button>
        {CUBE_MARK_SHAPES.map((shape) => <SpatialIconButton key={shape} label={m[`${shape}Shape`]} active={brush.mark === shape} disabled={busy} onClick={() => onBrush({ ...brush, mark: shape })}><SpatialMarkIcon shape={shape} /></SpatialIconButton>)}
        <SpatialActionButton action="clear" label={m.clearMarks} active={brush.mark === null} disabled={busy} onClick={() => onBrush({ ...brush, mark: null })} />
      </div>}
      {tool === "transparent" && <SpatialOpacitySlider key={`${selected}:${brush.opacity}`} value={brush.opacity} label={m.opacityLabel} disabled={busy}
        onPreview={onPreview} onCommit={(opacity) => { onBrush({ ...brush, opacity }); if (selected) onApply({ kind: "opacity", ids: [selected], opacity: opacity / 100 }); }} />}
      {tool === "number" && <p className="font-bold tabular-nums">{m.nextNumber}: {surfaces.nextNumber}</p>}
      <p className="text-muted">{selected ? t("selected", { face: selected }) : t("pickFace")}</p>
      <div className="flex flex-wrap gap-1">
        {tool !== "number" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onApply(cubeNetBrushOperation(tool, brush, identities))}>{t("applyAll")}</Button>}
        {tool === "face" && <Button size="sm" variant="ghost" disabled={busy || !selected} onClick={() => onApply({ kind: "paint", ids: [selected!], color: CUBE_COLORS[0] })}>{t("restoreColor")}</Button>}
        {tool === "transparent" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onApply({ kind: "opacity", ids: identities, opacity: 1 })}>{t("restoreOpacity")}</Button>}
        {tool === "number" && <>
          <Button size="sm" variant="ghost" disabled={busy || !selected} onClick={() => onApply({ kind: "clear-numbers", ids: [selected!] })}>{m.clearNumbers}</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onApply({ kind: "restart-numbering" })}>{m.restartNumbering}</Button>
        </>}
      </div>
    </div>
  </SpatialCanvasPanel>;
}
