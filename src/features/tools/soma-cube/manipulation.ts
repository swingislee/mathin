import { Quaternion } from "three";
import type { SpatialObjectAction } from "../spatial-interaction/object-gesture-math";
import { spatialBasisQuaternion, type SpatialRigidPose } from "../spatial-interaction/rigid-motion";
import type { SomaSnapshot } from "./contract";
import { somaOrientAroundAnchor } from "./model";
import { somaRigidPoses } from "./motion";
import { SOMA_ROTATIONS, somaPlacementValid, type SomaId } from "./pieces";

const orientations = SOMA_ROTATIONS.map((basis) => new Quaternion(...spatialBasisQuaternion(basis)));
const snapDelta = (value: number) => Math.sign(value) * Math.round(Math.abs(value)) || 0;
/** 连续手势只输出一个准确候选；显示中间角度不扩展已有的 24 朝向/整数坐标合同。 */
export function somaGestureLanding(snapshot: SomaSnapshot, id: SomaId, pose: SpatialRigidPose, action: SpatialObjectAction) {
  const source = snapshot.pieces.find((piece) => piece.id === id)!;
  const original = somaRigidPoses([source])[0];
  let target = source;
  if (action === "translate") target = { ...source, position: {
    x: source.position.x + snapDelta(pose.position.x - original.position.x),
    y: source.position.y + snapDelta(pose.position.y - original.position.y),
    z: source.position.z + snapDelta(pose.position.z - original.position.z),
  } };
  else {
    const rotation = new Quaternion(...pose.quaternion).normalize();
    let nearest = source.orientation, angle = orientations[nearest].angleTo(rotation);
    orientations.forEach((candidate, index) => { const next = candidate.angleTo(rotation); if (next < angle - 1e-7) { nearest = index; angle = next; } });
    target = somaOrientAroundAnchor(source, nearest);
  }
  const next = { ...snapshot, selectedId: id, pieces: snapshot.pieces.map((piece) => piece.id === id ? target : piece) };
  return { snapshot: next, pose: somaRigidPoses([target])[0], valid: somaPlacementValid(next.pieces) };
}
