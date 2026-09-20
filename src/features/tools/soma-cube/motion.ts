import { somaPose, type SomaPiece } from "./pieces";

/** 旧格点朝向与新自由姿态共用同一个刚体表现层。 */
export function somaRigidPoses(pieces: readonly SomaPiece[]) { return pieces.map(somaPose); }
