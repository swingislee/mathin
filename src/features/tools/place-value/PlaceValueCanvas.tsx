"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { createVoxelSet, projectVoxels } from "@/features/spatial-math/domain";
import { VoxelGeometry, VoxelModelCanvas } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import type { VoxelRenderCell, VoxelRenderModel } from "@/features/spatial-math/renderer-r3f/voxel-render-model";
import { buildCubeStructureRenderModel, createCubeHistory, replayCubeHistory, CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { cubeWorkbenchCamera } from "../spatial-lab/cube-workbench-camera";
import { boardTotal, type PlaceValueSide, type PlaceValueSnapshot } from "./radix-contract";
import { PLACE_VALUE_CAMERA_TARGET, placeValueGroup, placeValueLayout, placeValueOffset, placeValuePose, placeValueRedSpans, type PlaceValueRod } from "./radix-model";
import { PlaceValueStage, type PlaceValueControlRenderer } from "./PlaceValueStage";
import { PlaceValueClipDepth, PlaceValueRodMesh } from "./PlaceValueRodMesh";
import { placeValueRenderPlan, PLACE_VALUE_CUBE_BUDGET } from "./render-plan";
import { placeValueMessages } from "./messages";

const empty = replayCubeHistory(createCubeHistory([]));
const colors = { yellow: CUBE_COLORS[2], blue: CUBE_COLORS[3], pending: CUBE_COLORS[1] };
export interface PlaceValueCanvasProps {
  snapshot: PlaceValueSnapshot; progress: number; locale: "zh" | "en"; navigation: "orbit" | "pan"; axisSnap: boolean;
  interactive: boolean; selected: boolean; onSelect: (side: PlaceValueSide, unit: number) => void;
  onPointerMissed: (event: MouseEvent) => void;
  renderPlaceControl?: PlaceValueControlRenderer; renderCarryControl?: PlaceValueControlRenderer;
}
/** 共用相机、体素轮廓和选择；数量大时只把连续长条换为带单位分格的等长网格。 */
export function PlaceValueCanvas({ snapshot, progress, locale, navigation, axisSnap, interactive, selected, onSelect, onPointerMissed, renderPlaceControl, renderCarryControl }: PlaceValueCanvasProps) {
  const m = placeValueMessages(locale), t = useTranslations("tools.spatialLab"), radix = snapshot.left.radix, digits = snapshot.left.places.length;
  const messages: VoxelRendererMessages = {
    webglUnavailable: t("renderer.webglUnavailable"), contextLost: t("renderer.contextLost"), unrevealedCount: t("renderer.unrevealedCount"),
    formatProjection: (view) => t("renderer.projections." + view),
    formatLayerCount: (label, count, visible) => count === null ? t("renderer.layerCountUnrevealed", { label }) : t("renderer.layerCount", { label, count, visibility: t(visible ? "renderer.visible" : "renderer.hidden") }),
    formatTotalCount: (count) => t("renderer.totalCount", { count }), formatHiddenByLayerCount: (count) => t("renderer.hiddenByLayer", { count }),
    formatProjectedCell: (u, v, count) => count === null ? t("renderer.projectedCellUnrevealed", { u, v }) : t("renderer.projectedCell", { u, v, count }),
  };
  const base = useMemo(() => {
    const frame = { ...snapshot.frame, center: PLACE_VALUE_CAMERA_TARGET };
    const model = buildCubeStructureRenderModel({ ...empty, frame, view: snapshot.view }, [], m.title);
    const camera = cubeWorkbenchCamera(frame, snapshot.view, "place-value");
    const direction = { x: camera.position.x - camera.target.x, y: camera.position.y - camera.target.y, z: camera.position.z - camera.target.z };
    const ratio = Math.max(1, 240 / Math.hypot(direction.x, direction.y, direction.z));
    return { ...model, entityId: "place-value", camera: { ...camera, position: { x: camera.target.x + direction.x * ratio, y: camera.target.y + direction.y * ratio, z: camera.target.z + direction.z * ratio } } };
  }, [snapshot.frame, snapshot.view, m.title]);
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  const offset = (side: PlaceValueSide) => placeValueOffset(snapshot.mode, side, digits);
  const selection = selected && snapshot.selection ? { side: snapshot.selection.side, group: placeValueGroup(snapshot[snapshot.selection.side], snapshot.selection.unit) } : null;
  const emphasized = (rod: PlaceValueRod, side: PlaceValueSide) => (selection?.side === side && selection.group?.group[0].start === rod.key) || snapshot.highlight === rod.level;
  const displayed = sides.map((side) => {
    const moving = snapshot.motion?.side === side && progress < 1;
    const rods = snapshot.motion?.side === side ? placeValuePose(snapshot.motion, progress) : placeValueLayout(snapshot[side]);
    const red = placeValueRedSpans(snapshot, side, progress);
    return { side, rods, red, moving, plan: placeValueRenderPlan(rods, red, radix, Math.floor(PLACE_VALUE_CUBE_BUDGET / sides.length)) };
  });
  const cellFor = (cube: ReturnType<typeof placeValueRenderPlan>["cubes"][number], side: PlaceValueSide): VoxelRenderCell => {
    const selected = emphasized(cube.rod, side);
    return { key: side + ":" + cube.id, x: cube.x + offset(side), y: cube.y, z: cube.z, materialToken: cube.red ? "pending" : cube.phase < Math.ceil(radix / 2) ? "yellow" : "blue", opacity: cube.rod.opacity,
      selected, emphasis: selected ? { color: CUBE_SELECTION_COLOR, faceOpacity: .08, priority: 2 } : undefined };
  };
  // 降级前视图按整条的真实单位数计算，不把抽样方块数当成数学数量。
  const { left, right, mode } = snapshot;
  const projection = useMemo(() => {
    const sides: PlaceValueSide[] = mode === "compare" ? ["left", "right"] : ["left"], boards = { left, right };
    const cells = sides.flatMap((side) => placeValueLayout(boards[side]).map((rod) => ({
      u: rod.center.x + placeValueOffset(mode, side, digits), v: rod.index, depth: 0, stackSize: rod.length, hiddenCount: rod.length - 1,
      frontmostCell: { x: rod.center.x + placeValueOffset(mode, side, digits), y: rod.index, z: 0 },
    })));
    return { ...projectVoxels(createVoxelSet([]), "front"), cells, bounds: cells.length ? {
      minU: Math.min(...cells.map((p) => p.u)), maxU: Math.max(...cells.map((p) => p.u)), minV: 0, maxV: Math.max(...cells.map((p) => p.v)),
    } : null, visibleVoxelCount: cells.length, hiddenVoxelCount: cells.reduce((sum, cell) => sum + cell.hiddenCount, 0) };
  }, [left, right, mode, digits]);
  const model: VoxelRenderModel = { ...base, showAxes: snapshot.axes, cells: displayed.flatMap(({ side, plan, moving }) => moving ? [] : plan.cubes.map((cube) => cellFor(cube, side))),
    totalCellCount: sides.reduce((sum, side) => sum + boardTotal(snapshot[side]), 0), totalCountRevealed: snapshot.showDigits,
    projectionView: "front", projection, projectionDepthRevealed: snapshot.showDigits };
  const select = (key: string) => { const [side, unit] = key.split(":"); if (side === "left" || side === "right") onSelect(side, Number(unit)); };
  const maxDepth = Math.max(100, ...displayed.flatMap(({ rods }) => rods.map((rod) => rod.length + Math.abs(rod.center.z))));
  return <VoxelModelCanvas model={model} messages={messages} materialColors={colors} preserveSelectedColors
    readOnly={!interactive || progress < 1} cameraInteractive={interactive} cameraPanEnabled={false} navigationMode={navigation} axisSnapEnabled={axisSnap}
    cameraRequestKey={snapshot.cameraRevision} onCellSelect={select} onPointerMissed={onPointerMissed}
    sceneOverlay={<>
      <PlaceValueClipDepth depth={maxDepth} />
      <PlaceValueStage snapshot={snapshot} progress={progress} locale={locale} renderPlaceControl={renderPlaceControl} renderCarryControl={renderCarryControl} />
      {displayed.flatMap(({ side, plan, red, moving }) => [
        ...plan.compact.map((rod) => <PlaceValueRodMesh key={side + ":" + rod.key} rod={rod} red={red} base={radix} offset={offset(side)} selected={emphasized(rod, side)}
          interactive={interactive && progress >= 1} onSelect={(unit) => onSelect(side, unit)} />),
        ...(moving ? plan.detailed.map((rod) => <group key={side + ":" + rod.key} position={[rod.center.x + offset(side), rod.center.y, rod.center.z]} quaternion={rod.quaternion}>
          <VoxelGeometry model={{ ...base, cells: plan.cubes.filter((cube) => cube.rod.key === rod.key).map((cube, index) => ({ ...cellFor(cube, side), x: 0, y: 0, z: (rod.length - 1) / 2 - index })) }}
            palette={{ leaf: colors.yellow, moon: CUBE_SELECTION_COLOR }} materialColors={colors} preserveSelectedColors readOnly />
        </group>) : []),
      ])}
    </>} />;
}
