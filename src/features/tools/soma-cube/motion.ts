import { Vector3 } from "three";
import { spatialBasisQuaternion, type SpatialRigidPose } from "../spatial-interaction/rigid-motion";
import { SOMA_ROTATIONS, somaDefinition, type SomaPiece } from "./pieces";

/** v1 朝向仍是 24 个离散值；只在显示层转换成整宝的刚体姿态。 */
export function somaRigidPoses(pieces: readonly SomaPiece[]): SpatialRigidPose[] {
  return pieces.map((piece) => {
    const quaternion = spatialBasisQuaternion(SOMA_ROTATIONS[piece.orientation]);
    const cells = somaDefinition(piece.id).cells.map((p) => new Vector3(p.x, p.y, p.z).applyQuaternion({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] }));
    return { id: piece.id, quaternion, position: {
      x: piece.position.x - Math.round(Math.min(...cells.map((p) => p.x))),
      y: piece.position.y - Math.round(Math.min(...cells.map((p) => p.y))),
      z: piece.position.z - Math.round(Math.min(...cells.map((p) => p.z))),
    } };
  });
}
