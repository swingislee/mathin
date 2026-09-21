"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { BoxGeometry, BufferGeometry, EdgesGeometry, Float32BufferAttribute, type InstancedMesh, Matrix4 } from "three";
import { CUBE_COLORS, cubeGroupOutlineColor } from "../spatial-lab/cube-structures-contract";
import type { SolidEntity, SolidFeatureSelection, SolidVector } from "../solid-geometry/solid-geometry-contract";
import { getSolidMetrics, getSolidTopology } from "../solid-geometry/solid-geometry";
import type { AnyMeasurementSettings as MeasurementSettings } from "./measurement-v2-contract";
import { MeasurementAccumulationOverlay } from "./MeasurementAccumulationOverlay";
import { buildMeasurementUnitCells, formatMeasurementEquation, formatMeasurementValue, measurementDimensionLines, measurementFaceArea, measurementTargetLayers, measurementUnitGrid, type MeasurementUnitCell } from "./measurement-model";
import { measurementMessages } from "./measurement-messages";
import { useMeasurementLayers, useMeasurementReducedMotion } from "./useMeasurementLayers";

const ignoreRaycast = () => null;
const tuple = (v: SolidVector): [number, number, number] => [v.x, v.y, v.z];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function unitLayerEdges(cells: readonly MeasurementUnitCell[]): BufferGeometry {
  const box = new BoxGeometry(1, 1, 1), source = new EdgesGeometry(box);
  const edges = source.getAttribute("position"), vertices = new Float32Array(cells.length * edges.count * 3);
  let offset = 0;
  for (const cell of cells) for (let i = 0; i < edges.count; i++) {
    vertices[offset++] = edges.getX(i) + cell.center.x;
    vertices[offset++] = edges.getY(i) + cell.center.y;
    vertices[offset++] = edges.getZ(i) + cell.center.z;
  }
  source.dispose(); box.dispose();
  const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  return geometry;
}

/** 同层用实例化单位方块；最多六层，不逐块增加 React 动画或课堂写入。 */
function UnitLayer({ cells, layer, progress, reducedMotion }: { cells: readonly MeasurementUnitCell[]; layer: number; progress: number; reducedMotion: boolean }) {
  const mesh = useRef<InstancedMesh>(null), invalidate = useThree((state) => state.invalidate);
  const edges = useMemo(() => unitLayerEdges(cells), [cells]);
  const color = CUBE_COLORS[layer % CUBE_COLORS.length], amount = clamp(progress - layer);
  useEffect(() => () => edges.dispose(), [edges]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4();
    cells.forEach((cell, index) => { matrix.makeTranslation(cell.center.x, cell.center.y, cell.center.z); mesh.current!.setMatrixAt(index, matrix); });
    mesh.current.instanceMatrix.needsUpdate = true; mesh.current.computeBoundingBox(); mesh.current.computeBoundingSphere(); invalidate();
  }, [cells, invalidate]);
  return <group visible={amount > 0} position={[0, reducedMotion ? 0 : (1 - amount) * 0.7, 0]} name={`measurement-unit-layer-${layer}`}>
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length]} raycast={ignoreRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.8} transparent={amount < 1} opacity={amount} depthWrite={amount >= 0.99} />
    </instancedMesh>
    <lineSegments geometry={edges} raycast={ignoreRaycast}>
      <lineBasicMaterial color={cubeGroupOutlineColor(color)} transparent opacity={amount} depthWrite={false} />
    </lineSegments>
  </group>;
}

export interface MeasurementOverlayProps {
  /** 宿主传入实际展示帧（包括拖动/动画），而不是下一步逻辑终点。 */
  entity: SolidEntity | null;
  settings: MeasurementSettings;
  feature?: SolidFeatureSelection | null;
  locale: string;
  onAnimating?: (active: boolean) => void;
}

function ActiveMeasurementOverlay({ entity, settings, feature, locale, onAnimating }: MeasurementOverlayProps & { entity: SolidEntity }) {
  const m = measurementMessages(locale), { kind } = entity, { width, height, depth, radius } = entity.dimensions;
  const cells = useMemo(() => buildMeasurementUnitCells({ kind, dimensions: { width, height, depth, radius } }), [kind, width, height, depth, radius]);
  const layers = useMemo(() => Array.from({ length: Math.max(0, ...cells.map((cell) => cell.layer + 1)) }, (_, index) => cells.filter((cell) => cell.layer === index)), [cells]);
  const layerFrame = useMeasurementLayers(measurementTargetLayers(entity, settings), `${entity.id}:${width}:${height}:${depth}`);
  const reducedMotion = useMeasurementReducedMotion();
  const dimensionLines = settings.dimensions ? measurementDimensionLines(entity) : [];
  const grid = settings.unitGrid ? measurementUnitGrid(entity) : [];
  const face = settings.faceArea && feature?.entityId === entity.id && feature.kind === "face" ? getSolidTopology(entity).faces.find((item) => item.id === feature.id) : null;
  const faceArea = face ? measurementFaceArea(entity, face.id) : null;
  const faceAnchor = face?.normal ? { x: face.center.x + face.normal.x * 0.09, y: face.center.y + face.normal.y * 0.09, z: face.center.z + face.normal.z * 0.09 }
    : { x: radius + 0.25, y: 0, z: radius * 0.3 };
  const metrics = getSolidMetrics(entity), upper = kind === "sphere" ? radius : height / 2;
  const color = cubeGroupOutlineColor(entity.color);
  return <>{"version" in settings && <MeasurementAccumulationOverlay key={`${entity.id}:${settings.accumulation}`} entity={entity} settings={settings} locale={locale} onAnimating={onAnimating} />}<group position={tuple(entity.position)} rotation={tuple(entity.rotation)} name={`solid-measurement:${entity.id}`}>
    {dimensionLines.map((line) => <group key={line.id}>
      <Line points={[tuple(line.start), tuple(line.end)]} color={color} lineWidth={1.3} raycast={ignoreRaycast} />
      <Line points={[tuple(line.startAnchor), tuple(line.start)]} color={color} lineWidth={0.8} dashed dashSize={0.07} gapSize={0.045} raycast={ignoreRaycast} />
      <Line points={[tuple(line.endAnchor), tuple(line.end)]} color={color} lineWidth={0.8} dashed dashSize={0.07} gapSize={0.045} raycast={ignoreRaycast} />
      <Html center position={tuple(line.label)} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <span className="whitespace-nowrap rounded bg-paper/95 px-1 py-0.5 text-xs text-ink">{m.dimensionNames[line.id]} {formatMeasurementValue(line.value, locale, 1, settings)}</span>
      </Html>
    </group>)}
    {grid.map((segment, index) => <Line key={index} points={segment.map(tuple)} color={color} lineWidth={0.85} transparent opacity={0.65} depthWrite={false} raycast={ignoreRaycast} />)}
    {settings.unitFill && layers.map((layerCells, index) => <UnitLayer key={index} cells={layerCells} layer={index} progress={layerFrame} reducedMotion={reducedMotion} />)}
    {faceArea !== null && <Html center position={tuple(faceAnchor)} occlude zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
      <span className="whitespace-nowrap rounded bg-moon/95 px-1.5 py-0.5 text-xs text-ink">{m.selectedArea} {formatMeasurementValue(faceArea, locale, 2, settings)}</span>
    </Html>}
    {settings.totals && <Html center position={[0, upper + 0.62, 0]} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
      <span className="block whitespace-nowrap rounded bg-paper/95 px-2 py-1 text-xs leading-5 text-ink">{formatMeasurementEquation("S", metrics.surfaceArea, locale, 2, settings)}<br />{formatMeasurementEquation("V", metrics.volume, locale, 3, settings)}</span>
    </Html>}
  </group></>;
}

/** 插入现有场景 children；没有第二个 Canvas、相机或页面布局。 */
export function MeasurementOverlay(props: MeasurementOverlayProps) {
  return props.settings.enabled && props.entity ? <ActiveMeasurementOverlay {...props} entity={props.entity} /> : null;
}
