import {
  analyzePolyhedronHingeGraph,
  POLYHEDRON_FOLD_PROGRESS_SCALE,
  type CubeNetGalleryFoldingBuild,
  type PolyhedronFoldFrame,
  type PolyhedronFoldVector3,
  type PolyhedronHingeProgress,
} from "@/features/spatial-math/domain";

/** 当前页面的教学操作合同；独立于冻结课件及旧的全局折叠进度。 */
export const CUBE_NET_TEACHING_VERSION = "cube-net-teaching-v1" as const;
export const CUBE_NET_TEACHING_HISTORY_LIMIT = 100;
export type CubeNetAngles = Readonly<Record<string, number>>;
export interface CubeNetTeachingSession {
  readonly version: typeof CUBE_NET_TEACHING_VERSION;
  readonly angles: CubeNetAngles;
  readonly past: readonly CubeNetAngles[];
  readonly future: readonly CubeNetAngles[];
}
export type CubeNetTeachingAction =
  | { readonly kind: "fold"; readonly edgeId: string; readonly degrees: number }
  | { readonly kind: "undo" | "redo" | "unfold" };

export function createCubeNetTeachingSession(edgeIds: readonly string[]): CubeNetTeachingSession {
  return {
    version: CUBE_NET_TEACHING_VERSION,
    angles: Object.fromEntries(edgeIds.map((edgeId) => [edgeId, 0])),
    past: [],
    future: [],
  };
}

export function reduceCubeNetTeachingSession(
  session: CubeNetTeachingSession,
  action: CubeNetTeachingAction,
): CubeNetTeachingSession {
  if (action.kind === "undo") {
    const previous = session.past.at(-1);
    return previous ? {
      ...session, angles: previous, past: session.past.slice(0, -1),
      future: [session.angles, ...session.future],
    } : session;
  }
  if (action.kind === "redo") {
    const next = session.future[0];
    return next ? {
      ...session, angles: next, past: [...session.past, session.angles],
      future: session.future.slice(1),
    } : session;
  }
  let angles: CubeNetAngles;
  if (action.kind === "fold") {
    if (!Object.hasOwn(session.angles, action.edgeId)) throw new Error("UNKNOWN_FOLD_HINGE");
    if (!Number.isInteger(action.degrees) || Math.abs(action.degrees) > 90) {
      throw new Error("INVALID_FOLD_ANGLE");
    }
    if (session.angles[action.edgeId] === action.degrees) return session;
    angles = { ...session.angles, [action.edgeId]: action.degrees };
  } else {
    if (Object.values(session.angles).every((angle) => angle === 0)) return session;
    angles = Object.fromEntries(Object.keys(session.angles).map((edgeId) => [edgeId, 0]));
  }
  return {
    ...session, angles,
    past: [...session.past, session.angles].slice(-CUBE_NET_TEACHING_HISTORY_LIMIT),
    future: [],
  };
}

export function cubeNetHingeProgress(angles: CubeNetAngles): PolyhedronHingeProgress {
  return Object.fromEntries(Object.entries(angles).map(([edgeId, degrees]) => [
    edgeId, Math.round(degrees / 90 * POLYHEDRON_FOLD_PROGRESS_SCALE),
  ]));
}

export function cubeNetTeachingFaces(build: CubeNetGalleryFoldingBuild, locale: "zh" | "en") {
  const { topology, hingeGraph } = build.sceneInput;
  const { traversal } = analyzePolyhedronHingeGraph(topology, hingeGraph);
  return traversal.map((step) => {
    const moving = new Set([step.faceId]);
    traversal.forEach((child) => {
      if (child.parentFaceId && moving.has(child.parentFaceId)) moving.add(child.faceId);
    });
    const label = build.sceneInput.faceLabels.find((face) => face.faceId === step.faceId)!.label;
    return {
      faceId: step.faceId,
      edgeId: step.hingeEdgeId,
      parentFaceId: step.parentFaceId,
      label: label[locale] ?? label.zh,
      movingFaceIds: [...moving],
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
}

export type CubeNetFoldJudgment = "closed" | "open" | "intersection";

/** 判断当前几何而非预置答案；反向整体折叠形成的镜像正方体也成立。 */
export function judgeCubeNetFold(frame: PolyhedronFoldFrame): CubeNetFoldJudgment {
  if (frame.collisionPairs.length > 0 || frame.collisionPairsTruncated) return "intersection";
  const copies = new Map<string, PolyhedronFoldVector3[]>();
  frame.faces.forEach((face) => face.vertices.forEach(({ vertexId, position }) => {
    const positions = copies.get(vertexId) ?? [];
    positions.push(position);
    copies.set(vertexId, positions);
  }));
  // 正方体的八个顶点各由三个面共用。这里只比较重合，不指定立方体在固定面的哪侧。
  const closed = frame.faces.length === 6 && copies.size === 8 && [...copies.values()].every(
    (positions) => positions.length === 3 && positions.every((point) =>
      Math.hypot(point.x - positions[0].x, point.y - positions[0].y, point.z - positions[0].z) <= 0.000_001),
  );
  return closed ? "closed" : "open";
}
