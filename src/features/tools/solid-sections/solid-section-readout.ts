import type { Camera } from "three";
import type { SolidEntity } from "../solid-geometry/solid-geometry-contract";
import { getSolidMeshData, solidLocalToWorld } from "../solid-geometry/solid-geometry";
import { cubeScreenPoint } from "../spatial-lab/cube-structures-drag";
import { sectionAdd, sectionFlatPoints, sectionScale, solidSectionGuideRadius, type SolidSectionPlane, type SolidSectionResult } from "./solid-sections";

/** 同一个实体固定同一把比例尺，小截面不会被逐帧放大到与大截面一样。 */
export function sectionReadoutPoints(entity: SolidEntity, plane: SolidSectionPlane, result: SolidSectionResult) {
  const radius = solidSectionGuideRadius(entity);
  return sectionFlatPoints(result, plane.normal).map((point) => ({ x: 60 + point.x / radius * 48, y: 60 - point.y / radius * 48 }));
}
export function sectionReadoutLayout(entity: SolidEntity, plane: SolidSectionPlane, result: SolidSectionResult, camera: Camera, size: { width: number; height: number }) {
  const center = result.points.length ? sectionScale(result.points.reduce(sectionAdd, { x: 0, y: 0, z: 0 }), 1 / result.points.length) : plane.origin;
  const source = cubeScreenPoint(center, camera, size);
  const footprint = getSolidMeshData(entity).vertices.map((point) => cubeScreenPoint(solidLocalToWorld(point, entity), camera, size));
  const width = Math.min(160, Math.max(96, size.width * 0.18));
  const left = Math.max(10, Math.min(size.width - width - 60, Math.min(...footprint.map((point) => point.x)) - width - 24));
  const top = Math.max(58, Math.min(size.height - width - 58, source.y - width / 2));
  return { source, left, top, width, end: { x: left + width, y: top + width / 2 }, visible: source.x >= 0 && source.x <= size.width && source.y >= 0 && source.y <= size.height };
}
