"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Html } from "@react-three/drei";
import { createVoxelSet, projectVoxels } from "@/features/spatial-math/domain";
import { VoxelGeometry, VoxelModelCanvas } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import type { VoxelRenderCell, VoxelRenderModel } from "@/features/spatial-math/renderer-r3f/voxel-render-model";
import { buildCubeStructureRenderModel, createCubeHistory, replayCubeHistory, CUBE_COLORS, CUBE_SELECTION_COLOR } from "../spatial-lab/cube-structures-contract";
import { cubeWorkbenchCamera } from "../spatial-lab/cube-workbench-camera";
import type { PlaceValueSide, PlaceValueSnapshot } from "./contract";
import { boardTotal } from "./contract";
import { PLACE_VALUE_COLUMNS, placeValueGroup, placeValueLayout, placeValuePose, type PlaceValueCube } from "./model";
import { placeValueMessages } from "./messages";

const empty = replayCubeHistory(createCubeHistory([]));
const colors = { yellow: CUBE_COLORS[2], blue: CUBE_COLORS[3] };
const ignoreRaycast = () => null;
export interface PlaceValueCanvasProps {
  snapshot: PlaceValueSnapshot; progress: number; locale: "zh" | "en"; navigation: "orbit" | "pan"; axisSnap: boolean;
  interactive: boolean; selected: boolean; onSelect: (side: PlaceValueSide, unit: number) => void;
  onPointerMissed: (event: MouseEvent) => void;
}
/** 方块、轮廓、相机、指针保护与降级展示均复用立方体舞台；领域层只提供单位块位置。 */
export function PlaceValueCanvas({ snapshot, progress, locale, navigation, axisSnap, interactive, selected, onSelect, onPointerMissed }: PlaceValueCanvasProps) {
  const m = placeValueMessages(locale), t = useTranslations("tools.spatialLab");
  const messages: VoxelRendererMessages = {
    webglUnavailable: t("renderer.webglUnavailable"), contextLost: t("renderer.contextLost"), unrevealedCount: t("renderer.unrevealedCount"),
    formatProjection: (view) => t("renderer.projections." + view),
    formatLayerCount: (label, count, visible) => count === null ? t("renderer.layerCountUnrevealed", { label }) : t("renderer.layerCount", { label, count, visibility: t(visible ? "renderer.visible" : "renderer.hidden") }),
    formatTotalCount: (count) => t("renderer.totalCount", { count }), formatHiddenByLayerCount: (count) => t("renderer.hiddenByLayer", { count }),
    formatProjectedCell: (u, v, count) => count === null ? t("renderer.projectedCellUnrevealed", { u, v }) : t("renderer.projectedCell", { u, v, count }),
  };
  const base = useMemo(() => {
    const model = buildCubeStructureRenderModel({ ...empty, frame: snapshot.frame, view: snapshot.view }, [], m.title);
    const camera = cubeWorkbenchCamera(snapshot.frame, snapshot.view, "place-value");
    // 正面近景仍需把相机留在百链之外；正交画幅由 frame 决定，不用透视缩短百链。
    const direction = { x: camera.position.x - camera.target.x, y: camera.position.y - camera.target.y, z: camera.position.z - camera.target.z };
    const ratio = Math.max(1, 240 / Math.hypot(direction.x, direction.y, direction.z));
    return { ...model, entityId: "place-value", camera: { ...camera, position: { x: camera.target.x + direction.x * ratio, y: camera.target.y + direction.y * ratio, z: camera.target.z + direction.z * ratio } } };
  }, [snapshot.frame, snapshot.view, m.title]);
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  const offset = (side: PlaceValueSide) => snapshot.mode === "compare" ? side === "left" ? -9 : 9 : 0;
  const selection = selected && snapshot.selection ? { side: snapshot.selection.side, ids: new Set(placeValueGroup(snapshot[snapshot.selection.side], snapshot.selection.unit)?.ids) } : null;
  const cellsFor = (cubes: PlaceValueCube[], side: PlaceValueSide, shift = 0): VoxelRenderCell[] => cubes.map((cube) => {
    const emphasized = (selection?.side === side && selection.ids.has(cube.id)) || (snapshot.highlight !== "all" && snapshot.highlight === cube.place);
    return { key: side + ":" + cube.id, x: cube.x + shift, y: cube.y, z: cube.z, materialToken: cube.id % 2 ? "blue" : "yellow", opacity: cube.opacity, selected: emphasized,
      emphasis: emphasized ? { color: CUBE_SELECTION_COLOR, faceOpacity: .08, priority: 2 } : undefined };
  });
  const displayed = sides.map((side) => ({ side, pose: snapshot.motion?.side === side ? placeValuePose(snapshot.motion, progress) : { cubes: placeValueLayout(snapshot[side]), rotation: null } }));
  const canonical = sides.flatMap((side) => placeValueLayout(snapshot[side]).map((p) => ({ x: p.x + offset(side), y: Math.floor(p.y), z: p.z })));
  const model: VoxelRenderModel = { ...base, showAxes: snapshot.axes, cells: displayed.flatMap(({ side, pose }) => cellsFor(pose.cubes, side, offset(side))),
    totalCellCount: sides.reduce((sum, side) => sum + boardTotal(snapshot[side]), 0), totalCountRevealed: snapshot.showDigits,
    projection: projectVoxels(createVoxelSet(canonical), base.projectionView), projectionDepthRevealed: snapshot.showDigits };
  const select = (key: string) => { const [side, unit] = key.split(":"); if (side === "left" || side === "right") onSelect(side, Number(unit)); };
  return <VoxelModelCanvas model={model} messages={messages} materialColors={colors} preserveSelectedColors
    readOnly={!interactive || progress < 1} cameraInteractive={interactive} navigationMode={navigation} axisSnapEnabled={axisSnap}
    cameraRequestKey={snapshot.cameraRevision} onCellSelect={select} onPointerMissed={onPointerMissed}
    sceneOverlay={<>
      {snapshot.grid && <gridHelper args={[120, 120, CUBE_COLORS[5], CUBE_COLORS[5]]} position={[0, -.01, -45]} raycast={ignoreRaycast} />}
      {displayed.map(({ side, pose }) => pose.rotation && <group key={side} position={[pose.rotation.pivot.x + offset(side), pose.rotation.pivot.y, pose.rotation.pivot.z]} rotation={[pose.rotation.angle, 0, 0]}>
        <VoxelGeometry model={{ ...base, cells: cellsFor(pose.rotation.local, side) }} palette={{ leaf: colors.yellow, moon: CUBE_SELECTION_COLOR }} materialColors={colors} preserveSelectedColors readOnly />
      </group>)}
      {snapshot.showLabels && sides.flatMap((side) => (["hundreds", "tens", "ones"] as const).map((place) => <Html key={side + place} position={[PLACE_VALUE_COLUMNS[place] + offset(side), -.7, 1]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
        <span className="whitespace-nowrap rounded bg-paper/90 px-1 text-xs text-muted">{m[place]}</span>
      </Html>))}
      {snapshot.showLabels && progress >= 1 && sides.map((side) => {
        const board = snapshot[side], ones = board.ones.length >= 10, count = ones ? board.ones.length : board.tens.length;
        return count >= 10 && <Html key={side + "-pending"} position={[(ones ? PLACE_VALUE_COLUMNS.ones : PLACE_VALUE_COLUMNS.tens) + offset(side), count + .8, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded bg-paper/90 px-1 text-xs text-ink">{ones ? m.pendingOnes(count) : m.pendingTens(count)}</span>
        </Html>;
      })}
    </>} />;
}
