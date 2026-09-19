import { Matrix4, Quaternion, Vector3 } from "three";
import type { PolyhedronFoldRenderFace, PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { cubeNetFaceBasis, transformCubeNetWorkbenchModel, type CubeNetWorkbenchHinge } from "../spatial-lab/cube-net-workbench-model";
import { cubeWorkbenchCamera } from "../spatial-lab/cube-workbench-camera";
import type { SolidNetsSnapshot } from "./contract";
import { solidNetGeometry, type SolidNetPoint } from "./geometry";

const point = (v: Vector3): SolidNetPoint => ({ x: v.x, y: v.y, z: v.z });
const vector = (p: SolidNetPoint) => new Vector3(p.x, p.y, p.z);
const coordinates = (p: SolidNetPoint) => [p.x, p.y, p.z];
const ease = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };

export function resolveSolidNet(snapshot: SolidNetsSnapshot, selectedIds: readonly string[] = []) {
  const geometry = solidNetGeometry(snapshot.kind, snapshot.dimensions), matrices = new Map([["base", new Matrix4()]]);
  const hinges: CubeNetWorkbenchHinge[] = [];
  for (const hinge of geometry.hinges) {
    const parent = matrices.get(hinge.parentId)!, axis = vector(hinge.end).sub(vector(hinge.start)).normalize();
    const rotation = new Matrix4().makeTranslation(hinge.start.x, hinge.start.y, hinge.start.z)
      .multiply(new Matrix4().makeRotationAxis(axis, -snapshot.angles[hinge.id] * Math.PI / 180))
      .multiply(new Matrix4().makeTranslation(-hinge.start.x, -hinge.start.y, -hinge.start.z));
    matrices.set(hinge.faceId, parent.clone().multiply(rotation));
    const moving = new Set([hinge.faceId]);
    for (const descendant of geometry.hinges) if (moving.has(descendant.parentId)) moving.add(descendant.faceId);
    hinges.push({ edgeId: hinge.id, parentFaceId: hinge.parentId, faceId: hinge.faceId,
      label: `${snapshot.surfaces[hinge.parentId].label}—${snapshot.surfaces[hinge.faceId].label}`,
      degrees: snapshot.angles[hinge.id], movingFaceIds: [...moving], direction: -1,
      minDegrees: -hinge.closedDegrees, maxDegrees: hinge.closedDegrees,
      start: point(vector(hinge.start).applyMatrix4(parent)), end: point(vector(hinge.end).applyMatrix4(parent)) });
  }
  const faces: PolyhedronFoldRenderFace[] = geometry.faces.map((face) => {
    const vertices = face.vertices.map((value, index) => ({ vertexId: `${face.id}_${index}`, position: point(vector(value).applyMatrix4(matrices.get(face.id)!)) }));
    const triangles: [number, number, number][] = face.vertices.length === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
    const surface = snapshot.surfaces[face.id];
    return { faceId: face.id, label: snapshot.labelsVisible ? surface.label : "", materialToken: surface.color, opacity: surface.opacity,
      selected: selectedIds.includes(face.id), colliding: false, vertices, triangleVertexIndices: triangles,
      trianglePositions: triangles.flatMap((indices) => indices.flatMap((index) => coordinates(vertices[index].position))),
      edgePositions: vertices.flatMap((value, index) => [...coordinates(value.position), ...coordinates(vertices[(index + 1) % vertices.length].position)]),
      centroid: point(vertices.reduce((sum, value) => sum.add(vector(value.position)), new Vector3()).divideScalar(vertices.length)) };
  });
  const flat = geometry.faces.flatMap((face) => face.vertices);
  const min = { x: Math.min(...flat.map((p) => p.x)), y: 0, z: Math.min(...flat.map((p) => p.z)) };
  const max = { x: Math.max(...flat.map((p) => p.x)), y: snapshot.dimensions.height, z: Math.max(...flat.map((p) => p.z)) };
  const center = { x: (min.x + max.x) / 2, y: 0, z: (min.z + max.z) / 2 };
  const frame = { min, max, center, radius: Math.max(1.2, ...flat.map((p) => Math.hypot(p.x - center.x, p.z - center.z))) };
  const camera = cubeWorkbenchCamera(frame, snapshot.view, "solid-net");
  const source: PolyhedronFoldRenderModel = { profile: "standard-4x3", sceneId: "solid-net", entityId: snapshot.kind, label: "Solid net", progressMillionths: 0,
    background: "paper", lighting: "soft", showEdges: true, faces, bounds: frame, displayTarget: center,
    camera: { ...camera, projection: "orthographic", zoom: 1, label: { zh: "立体展开", en: "Solid nets" } } };
  const support = snapshot.anchor && faces.find((face) => face.faceId === snapshot.anchor!.faceId);
  const placement = support ? cubeNetFaceBasis(snapshot.anchor!.vertices).multiply(cubeNetFaceBasis(support.vertices.map((vertex) => vertex.position)).invert()) : new Matrix4();
  const place = (p: SolidNetPoint) => point(vector(p).applyMatrix4(placement));
  const model = transformCubeNetWorkbenchModel(source, place);
  return { model: { ...model, camera: source.camera, displayTarget: center }, frame, placement,
    hinges: hinges.map((hinge) => ({ ...hinge, start: place(hinge.start), end: place(hinge.end) })) };
}

export function solidNetAllMotion(snapshot: SolidNetsSnapshot, folded: boolean) {
  const geometry = solidNetGeometry(snapshot.kind, snapshot.dimensions);
  const targetAngles = Object.fromEntries(geometry.hinges.map((hinge) => [hinge.id, folded ? hinge.closedDegrees : 0]));
  const ordered = [...geometry.hinges].sort((a, b) => folded ? a.depth - b.depth : b.depth - a.depth)
    .filter((hinge) => Math.abs(snapshot.angles[hinge.id] - targetAngles[hinge.id]) > 1e-8);
  const stepMs = 440, settleMs = !folded && snapshot.anchor ? 440 : 0;
  const beforeSettle = { ...snapshot, angles: targetAngles }, target = { ...beforeSettle, anchor: folded ? snapshot.anchor : null };
  const placement = resolveSolidNet(beforeSettle).placement, translation = new Vector3(), orientation = new Quaternion();
  placement.decompose(translation, orientation, new Vector3());
  const canonicalRoot = geometry.faces[0].vertices.slice(0, 3);
  return { target, durationMs: Math.max(1, ordered.length * stepMs + settleMs), sample(time: number): SolidNetsSnapshot {
    if (time >= ordered.length * stepMs + settleMs) return target;
    const angles = { ...snapshot.angles };
    for (const [index, hinge] of ordered.entries()) angles[hinge.id] = snapshot.angles[hinge.id]
      + (targetAngles[hinge.id] - snapshot.angles[hinge.id]) * ease((time - index * stepMs) / stepMs);
    if (!settleMs || time < ordered.length * stepMs) return { ...snapshot, angles };
    const t = ease((time - ordered.length * stepMs) / settleMs);
    const matrix = new Matrix4().compose(translation.clone().multiplyScalar(1 - t), orientation.clone().slerp(new Quaternion(), t), new Vector3(1, 1, 1));
    const vertices = canonicalRoot.map((p) => point(vector(p).applyMatrix4(matrix))) as [SolidNetPoint, SolidNetPoint, SolidNetPoint];
    return { ...beforeSettle, anchor: { faceId: "base", vertices } };
  } };
}

/** 从持久化前后态重建过程；没有前态的晚加入端直接使用最新完整快照。 */
export function solidNetSnapshotTransition(from: SolidNetsSnapshot, to: SolidNetsSnapshot) {
  if (from.kind !== to.kind || JSON.stringify(from.dimensions) !== JSON.stringify(to.dimensions)) return null;
  const angleChanged = Object.keys(to.angles).some((id) => Math.abs(to.angles[id] - from.angles[id]) > 1e-8);
  const anchorChanged = JSON.stringify(from.anchor) !== JSON.stringify(to.anchor);
  if (!angleChanged && !anchorChanged) return null;
  const flat = Object.values(to.angles).every((angle) => angle === 0);
  const closed = solidNetGeometry(to.kind, to.dimensions).hinges.every((hinge) => Math.abs(to.angles[hinge.id] - hinge.closedDegrees) < 1e-8);
  if ((flat && !to.anchor) || (closed && JSON.stringify(from.anchor) === JSON.stringify(to.anchor))) {
    const motion = solidNetAllMotion(from, closed);
    return { durationMs: motion.durationMs, sample: (time: number) => { const frame = motion.sample(time); return { ...to, angles: frame.angles, anchor: frame.anchor }; } };
  }
  const a = resolveSolidNet(from).placement, b = resolveSolidNet(to).placement;
  const ap = new Vector3(), aq = new Quaternion(), bp = new Vector3(), bq = new Quaternion();
  a.decompose(ap, aq, new Vector3()); b.decompose(bp, bq, new Vector3());
  const root = solidNetGeometry(to.kind, to.dimensions).faces[0].vertices.slice(0, 3);
  return { durationMs: 320, sample(time: number): SolidNetsSnapshot {
    if (time >= 320) return to;
    const t = ease(time / 320), matrix = new Matrix4().compose(ap.clone().lerp(bp, t), aq.clone().slerp(bq, t), new Vector3(1, 1, 1));
    return { ...to, angles: Object.fromEntries(Object.keys(to.angles).map((id) => [id, from.angles[id] + (to.angles[id] - from.angles[id]) * t])),
      anchor: { faceId: "base", vertices: root.map((p) => point(vector(p).applyMatrix4(matrix))) as [SolidNetPoint, SolidNetPoint, SolidNetPoint] } };
  } };
}
