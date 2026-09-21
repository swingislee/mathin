"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { Billboard, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Plane, SphereGeometry, Vector3 } from "three";
import { CUBE_SELECTION_COLOR, cubeGroupOutlineColor } from "../spatial-lab/cube-structures-contract";
import { createSolidEntity, type SolidEntity, type SolidFeatureSelection, type SolidKind, type SolidVector } from "./solid-geometry-contract";
import { getSolidTopology, type SolidFace, type SolidMeshData } from "./solid-geometry";
import { solidMeshTopology } from "./exploration-contract";
import { supportsSolidSection } from "../solid-sections/solid-sections-contract";
import { solidSectionPlane } from "../solid-sections/solid-sections";
import { solidSectionVisible, type SolidSectionFrame } from "../solid-sections/solid-sections-motion";
import { SolidSectionOverlay } from "../solid-sections/SolidSectionOverlay";

export type SolidPickMode = "object" | "face" | "edge" | "vertex";
export interface SolidSceneContext { entities: readonly SolidEntity[]; selected: SolidEntity | null }
export interface SolidGeometrySceneProps {
  entities: readonly SolidEntity[]; selectedId: string | null; feature?: SolidFeatureSelection | null;
  selectionActive?: boolean;
  pickMode?: SolidPickMode; readOnly?: boolean;
  onPick?: (entityId: string, feature: SolidFeatureSelection | null) => void;
  renderScene?: (context: SolidSceneContext) => ReactNode;
  section?: SolidSectionFrame;
  locale?: string;
  meshes?: ReadonlyMap<string, SolidMeshData>;
  cutColors?: ReadonlyMap<string, string>;
}
export function solidFaceGeometry(face: SolidFace) {
  const geometry = new BufferGeometry(), points = face.vertices;
  const positions = [];
  for (let i = 1; i < points.length - 1; i++) for (const point of [points[0], points[i], points[i + 1]]) positions.push(point.x, point.y, point.z);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
  return geometry;
}
function canonicalSolid(kind: SolidKind) { const entity = createSolidEntity(kind, "geometry"); return { ...entity, dimensions: { width: 1, height: 1, depth: 1, radius: 0.5 } }; }
function geometryScale(entity: SolidEntity): [number, number, number] {
  const d = entity.dimensions;
  if (entity.kind === "sphere") return [d.radius * 2, d.radius * 2, d.radius * 2];
  if (entity.kind === "cylinder" || entity.kind === "cone") return [d.radius * 2, d.height, d.radius * 2];
  return [d.width, d.height, d.depth];
}
function tuple(p: SolidVector): [number, number, number] { return [p.x, p.y, p.z]; }
const ignoreRaycast = () => null;
function SolidObject({ entity, selected, feature, mode, readOnly, onPick, clippingPlanes, opacityFactor = 1, customMesh, cutColor }: {
  entity: SolidEntity; selected: boolean; feature: SolidFeatureSelection | null; mode: SolidPickMode; readOnly: boolean;
  onPick?: SolidGeometrySceneProps["onPick"];
  clippingPlanes?: Plane[]; opacityFactor?: number;
  customMesh?: SolidMeshData; cutColor?: string;
}) {
  const topology = useMemo(() => customMesh ? solidMeshTopology(customMesh) : getSolidTopology(canonicalSolid(entity.kind)), [entity.kind, customMesh]);
  const geometries = useMemo(() => new Map(topology.faces.map((face) => [face.id, face.surface === "plane" ? solidFaceGeometry(face)
    : entity.kind === "sphere" ? new SphereGeometry(0.5, 64, 32) : new CylinderGeometry(entity.kind === "cone" ? 0 : 0.5, 0.5, 1, 64, 1, true)])), [entity.kind, topology]);
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  const scale: [number, number, number] = customMesh ? [1, 1, 1] : geometryScale(entity);
  const pick = (event: ThreeEvent<MouseEvent>, kind: SolidFeatureSelection["kind"], id: string) => {
    if (readOnly || opacityFactor < 0.02 || event.button !== 0 || event.delta > 4 || clippingPlanes?.some((plane) => plane.distanceToPoint(event.point) < -1e-7)) return;
    event.stopPropagation(); onPick?.(entity.id, mode === kind ? { entityId: entity.id, kind, id } : null);
  };
  return <group name={`solid:${entity.id}`} userData={{ spatialObjectId: entity.id }} position={tuple(entity.position)} rotation={tuple(entity.rotation)}>
    <group scale={scale}>
      {topology.faces.map((face) => { const highlighted = feature?.kind === "face" && feature.id === face.id, faceColor = face.id === "cut" ? cutColor ?? entity.color : entity.color;
        return <mesh key={face.id} geometry={geometries.get(face.id)} onClick={(event) => pick(event, "face", face.id)}>
          <meshStandardMaterial color={highlighted ? CUBE_SELECTION_COLOR : faceColor} side={DoubleSide} roughness={0.78}
            transparent={entity.opacity * opacityFactor < 1} opacity={entity.opacity * opacityFactor} depthWrite={entity.opacity * opacityFactor >= 0.99} clippingPlanes={clippingPlanes}
            emissive={highlighted ? CUBE_SELECTION_COLOR : entity.color} emissiveIntensity={highlighted ? 0.15 : 0.035} />
        </mesh>;
      })}
      {topology.edges.map((edge) => { const highlighted = feature?.kind === "edge" && feature.id === edge.id;
        return <Line key={edge.id} points={edge.points.map(tuple)} color={highlighted || (selected && !feature) ? CUBE_SELECTION_COLOR : cubeGroupOutlineColor(entity.color)}
          lineWidth={highlighted ? 5 : selected ? 2.2 : 1.3} transparent opacity={(highlighted ? 1 : Math.max(0.24, entity.opacity)) * opacityFactor} depthTest={!highlighted} depthWrite={false} clippingPlanes={clippingPlanes}
          raycast={mode === "edge" && !readOnly ? undefined : ignoreRaycast} onClick={(event) => pick(event, "edge", edge.id)} />;
      })}
    </group>
    {entity.kind === "sphere" && selected && <Billboard><Line points={Array.from({ length: 65 }, (_, i): [number, number, number] => [Math.cos(i * Math.PI / 32) * entity.dimensions.radius, Math.sin(i * Math.PI / 32) * entity.dimensions.radius, 0])}
      color={CUBE_SELECTION_COLOR} lineWidth={2.2} depthWrite={false} raycast={ignoreRaycast} /></Billboard>}
    {(mode === "vertex" || feature?.kind === "vertex") && topology.vertices.map((vertex) => {
      const highlighted = feature?.kind === "vertex" && feature.id === vertex.id;
      return <mesh key={vertex.id} position={[vertex.position.x * scale[0], vertex.position.y * scale[1], vertex.position.z * scale[2]]} onClick={(event) => pick(event, "vertex", vertex.id)} renderOrder={highlighted ? 3 : 0}>
        <sphereGeometry args={[highlighted ? 0.075 : 0.055, 16, 12]} /><meshBasicMaterial color={highlighted ? CUBE_SELECTION_COLOR : cubeGroupOutlineColor(entity.color)} depthTest={!highlighted} transparent={opacityFactor < 1} opacity={opacityFactor} clippingPlanes={clippingPlanes} />
      </mesh>;
    })}
  </group>;
}
/** 同一实体渲染器在互补半空间中复用；移去一侧仅改变显示透明度，不修改备课实体。 */
function SectionedSolidObject({ frame, locale, ...props }: Parameters<typeof SolidObject>[0] & { frame: SolidSectionFrame; locale: string }) {
  const plane = useMemo(() => solidSectionPlane(props.entity, frame.normal, frame.offset), [props.entity, frame.normal, frame.offset]);
  const clips = useMemo(() => {
    const positive = new Plane().setFromNormalAndCoplanarPoint(new Vector3(...tuple(plane.normal)), new Vector3(...tuple(plane.origin)));
    return { positive: [positive], negative: [positive.clone().negate()] };
  }, [plane]);
  return <>
    <SolidObject {...props} clippingPlanes={clips.positive} opacityFactor={frame.positiveOpacity} />
    <SolidObject {...props} clippingPlanes={clips.negative} opacityFactor={frame.negativeOpacity} />
    <SolidSectionOverlay entity={props.entity} plane={plane} frame={frame} locale={locale} />
  </>;
}
/** 可嵌入原有 3D 舞台；扩展读取同一动画展示帧，截面等不会先跳到下一组尺寸。 */
export function SolidGeometryScene({ entities, selectedId, feature = null, pickMode = "object", readOnly = false, onPick, renderScene, section, locale = "zh", selectionActive = true, meshes, cutColors }: SolidGeometrySceneProps) {
  return <>{entities.map((entity) => {
    const props = { entity, selected: selectionActive && selectedId === entity.id, feature: selectionActive && feature?.entityId === entity.id ? feature : null, mode: pickMode, readOnly, onPick, customMesh: meshes?.get(entity.id), cutColor: cutColors?.get(entity.id) };
    return !props.customMesh && selectedId === entity.id && section && solidSectionVisible(section) && supportsSolidSection(entity.kind)
      ? <SectionedSolidObject key={entity.id} {...props} selected={false} frame={section} locale={locale} /> : <SolidObject key={entity.id} {...props} />;
  })}
    {renderScene?.({ entities, selected: entities.find((entity) => entity.id === selectedId) ?? null })}
  </>;
}
