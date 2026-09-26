"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { createVoxelSet, projectVoxels } from "@/features/spatial-math/domain";
import { VoxelGeometry, VoxelModelCanvas } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import type { VoxelRenderCell, VoxelRenderModel } from "@/features/spatial-math/renderer-r3f/voxel-render-model";
import { buildCubeStructureRenderModel, createCubeHistory, replayCubeHistory, CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { cubeWorkbenchCamera } from "../spatial-lab/cube-workbench-camera";
import type { PlaceValueSide, PlaceValueSnapshot } from "./contract";
import { boardTotal } from "./contract";
import { PLACE_VALUE_CAMERA_TARGET, placeValueGroup, placeValueLayout, placeValueOffset, placeValuePose, type PlaceValueCube } from "./model";
import { PlaceValueStage, type PlaceValueControlRenderer } from "./PlaceValueStage";
import { placeValueMessages } from "./messages";

const empty = replayCubeHistory(createCubeHistory([]));
const colors = { yellow: CUBE_COLORS[2], blue: CUBE_COLORS[3] };
export interface PlaceValueCanvasProps {
  snapshot: PlaceValueSnapshot; progress: number; locale: "zh" | "en"; navigation: "orbit" | "pan"; axisSnap: boolean;
  interactive: boolean; selected: boolean; onSelect: (side: PlaceValueSide, unit: number) => void;
  onPointerMissed: (event: MouseEvent) => void;
  renderPlaceControl?: PlaceValueControlRenderer;
}
/** 方块、轮廓、相机、指针保护与降级展示均复用立方体舞台；领域层只提供单位块位置。 */
export function PlaceValueCanvas({ snapshot, progress, locale, navigation, axisSnap, interactive, selected, onSelect, onPointerMissed, renderPlaceControl }: PlaceValueCanvasProps) {
  const m = placeValueMessages(locale), t = useTranslations("tools.spatialLab");
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
    // 正面近景仍需把相机留在百链之外；正交画幅由 frame 决定，不用透视缩短百链。
    const direction = { x: camera.position.x - camera.target.x, y: camera.position.y - camera.target.y, z: camera.position.z - camera.target.z };
    const ratio = Math.max(1, 240 / Math.hypot(direction.x, direction.y, direction.z));
    return { ...model, entityId: "place-value", camera: { ...camera, position: { x: camera.target.x + direction.x * ratio, y: camera.target.y + direction.y * ratio, z: camera.target.z + direction.z * ratio } } };
  }, [snapshot.frame, snapshot.view, m.title]);
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  const offset = (side: PlaceValueSide) => placeValueOffset(snapshot.mode, side);
  const selection = selected && snapshot.selection ? { side: snapshot.selection.side, ids: new Set(placeValueGroup(snapshot[snapshot.selection.side], snapshot.selection.unit)?.ids) } : null;
  const cellsFor = (cubes: PlaceValueCube[], side: PlaceValueSide, shift = 0): VoxelRenderCell[] => cubes.map((cube) => {
    const emphasized = (selection?.side === side && selection.ids.has(cube.id)) || (snapshot.highlight !== "all" && snapshot.highlight === cube.place);
    return { key: side + ":" + cube.id, x: cube.x + shift, y: cube.y, z: cube.z, materialToken: cube.id % 2 ? "blue" : "yellow", opacity: cube.opacity, selected: emphasized,
      emphasis: emphasized ? { color: CUBE_SELECTION_COLOR, faceOpacity: .08, priority: 2 } : undefined };
  });
  const displayed = sides.map((side) => ({ side, pose: snapshot.motion?.side === side ? placeValuePose(snapshot.motion, progress) : { cubes: placeValueLayout(snapshot[side]), rotations: [] } }));
  const { left, right, mode } = snapshot;
  const projection = useMemo(() => {
    const boards = { left, right }, boardSides: PlaceValueSide[] = mode === "compare" ? ["left", "right"] : ["left"];
    const canonical = boardSides.flatMap((side) => placeValueLayout(boards[side]).map((p) => ({ x: p.x + placeValueOffset(mode, side), y: Math.floor(p.y), z: p.z })));
    return projectVoxels(createVoxelSet(canonical), base.projectionView);
  }, [left, right, mode, base.projectionView]);
  const model: VoxelRenderModel = { ...base, showAxes: snapshot.axes, cells: displayed.flatMap(({ side, pose }) => cellsFor(pose.cubes, side, offset(side))),
    totalCellCount: sides.reduce((sum, side) => sum + boardTotal(snapshot[side]), 0), totalCountRevealed: snapshot.showDigits,
    projection, projectionDepthRevealed: snapshot.showDigits };
  const select = (key: string) => { const [side, unit] = key.split(":"); if (side === "left" || side === "right") onSelect(side, Number(unit)); };
  return <VoxelModelCanvas model={model} messages={messages} materialColors={colors} preserveSelectedColors
    readOnly={!interactive || progress < 1} cameraInteractive={interactive} cameraPanEnabled={false} navigationMode={navigation} axisSnapEnabled={axisSnap}
    cameraRequestKey={snapshot.cameraRevision} onCellSelect={select} onPointerMissed={onPointerMissed}
    sceneOverlay={<>
      <PlaceValueStage snapshot={snapshot} progress={progress} locale={locale} renderPlaceControl={renderPlaceControl} />
      {displayed.flatMap(({ side, pose }) => pose.rotations.map((rotation) => <group key={side + ":" + rotation.ids[0]} position={[rotation.pivot.x + offset(side), rotation.pivot.y, rotation.pivot.z]} rotation={rotation.axis === "x" ? [rotation.angle, 0, 0] : [0, rotation.angle, 0]}>
        <VoxelGeometry model={{ ...base, cells: cellsFor(rotation.local, side) }} palette={{ leaf: colors.yellow, moon: CUBE_SELECTION_COLOR }} materialColors={colors} preserveSelectedColors readOnly />
      </group>))}
    </>} />;
}
