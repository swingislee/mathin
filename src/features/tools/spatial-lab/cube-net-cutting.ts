import { Matrix4, Vector3 } from "three";
import {
  analyzeCubeNet, analyzePolyhedronFoldSimulation, analyzePolyhedronTopology,
  buildPolyhedronFoldScene, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest,
  materializeSpatialPageDoc, parsePolyhedronHingeGraph, parsePolyhedronNetLayout,
  parsePolyhedronSceneAdapterInput, unitSquareNet,
  type CubeNetGalleryFoldingBuild, type PolyhedronNetLayout, type PolyhedronSceneAdapterInput,
} from "@/features/spatial-math/domain";
import type { PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";

export type CubeNetCutPoses = Readonly<Record<string, readonly number[]>>;
export interface CubeNetCutSnapshot {
  readonly cuts: readonly string[];
  readonly poses: CubeNetCutPoses;
}
export interface CubeNetCutSession extends CubeNetCutSnapshot {
  readonly past: readonly CubeNetCutSnapshot[];
  readonly future: readonly CubeNetCutSnapshot[];
}
export const createCubeNetCutSession = (): CubeNetCutSession => ({ cuts: [], poses: {}, past: [], future: [] });
export function reduceCubeNetCutSession(session: CubeNetCutSession, action: { kind: "toggle"; edgeId: string } | { kind: "unfold"; poses: CubeNetCutPoses } | { kind: "undo" } | { kind: "redo" }): CubeNetCutSession {
  const snapshot = { cuts: session.cuts, poses: session.poses };
  if (action.kind === "undo") return session.past.length ? {
    ...session.past[session.past.length - 1], past: session.past.slice(0, -1), future: [snapshot, ...session.future],
  } : session;
  if (action.kind === "redo") return session.future.length ? {
    ...session.future[0], past: [...session.past, snapshot].slice(-100), future: session.future.slice(1),
  } : session;
  if (action.kind === "unfold") return { ...session, poses: action.poses, past: [...session.past, snapshot].slice(-100), future: [] };
  const cuts = session.cuts.includes(action.edgeId) ? session.cuts.filter((id) => id !== action.edgeId) : [...session.cuts, action.edgeId].sort();
  return { cuts, poses: session.poses, past: [...session.past, snapshot].slice(-100), future: [] };
}

export function analyzeCubeNetCuts(base: PolyhedronSceneAdapterInput, cuts: readonly string[]) {
  const edges = analyzePolyhedronTopology(base.topology).edges;
  if (new Set(cuts).size !== cuts.length || cuts.some((id) => !edges.some((edge) => edge.edgeId === id))) throw new Error("CUBE_NET_UNKNOWN_CUT_EDGE");
  const remaining = edges.filter((edge) => !cuts.includes(edge.edgeId));
  const visited = new Set([base.layout.rootFaceId]);
  const queue = [base.layout.rootFaceId];
  for (let index = 0; index < queue.length; index++) for (const edge of remaining) {
    if (!edge.faceIds.includes(queue[index])) continue;
    for (const faceId of edge.faceIds) if (!visited.has(faceId)) { visited.add(faceId); queue.push(faceId); }
  }
  return {
    status: visited.size !== base.topology.faces.length ? "disconnected" as const : remaining.length === 5 ? "ready" as const : "more-cuts" as const,
    remainingCuts: Math.max(0, remaining.length - 5),
    remaining,
  };
}

/** 沿老师实际保留的五条棱，逐面将立方体表面刚性铺平；目录只用于识别结果。 */
export function createCubeNetCutSceneInput(base: PolyhedronSceneAdapterInput, cuts: readonly string[]) {
  const checked = analyzeCubeNetCuts(base, cuts);
  if (checked.status !== "ready") throw new Error(`CUBE_NET_CUT_${checked.status.toUpperCase().replaceAll("-", "_")}`);
  const points = new Map(base.geometry.vertices.map((vertex) => [vertex.vertexId, new Vector3(
    vertex.position.x.numerator / vertex.position.x.denominator,
    vertex.position.y.numerator / vertex.position.y.denominator,
    vertex.position.z.numerator / vertex.position.z.denominator,
  )]));
  const rootFaceId = base.layout.rootFaceId;
  const transforms = new Map([[rootFaceId, new Matrix4()]]);
  const queue = [rootFaceId];
  const rootFace = base.topology.faces.find((face) => face.id === rootFaceId)!;
  const normal = (faceId: string, transform: Matrix4) => {
    const face = base.topology.faces.find((item) => item.id === faceId)!;
    const [a, b, c] = face.vertexIds.slice(0, 3).map((id) => points.get(id)!.clone().applyMatrix4(transform));
    return b.sub(a).cross(c.sub(a)).normalize();
  };
  const rootNormal = normal(rootFaceId, new Matrix4());
  for (let index = 0; index < queue.length; index++) {
    const parentId = queue[index], parent = transforms.get(parentId)!;
    for (const edge of checked.remaining) {
      if (!edge.faceIds.includes(parentId)) continue;
      const childId = edge.faceIds.find((id) => id !== parentId)!;
      if (transforms.has(childId)) continue;
      const [start, end] = edge.vertexIds.map((id) => points.get(id)!.clone().applyMatrix4(parent));
      const axis = end.sub(start).normalize(), childNormal = normal(childId, parent);
      const angle = Math.atan2(axis.dot(childNormal.clone().cross(rootNormal)), childNormal.dot(rootNormal));
      const rotation = new Matrix4().makeTranslation(start.x, start.y, start.z)
        .multiply(new Matrix4().makeRotationAxis(axis, angle))
        .multiply(new Matrix4().makeTranslation(-start.x, -start.y, -start.z));
      transforms.set(childId, rotation.multiply(parent)); queue.push(childId);
    }
  }
  // 统一用根面的局部坐标铺图，选择哪个参考面仅改变整张纸的定位。
  const origin = points.get(rootFace.vertexIds[0])!;
  const u = points.get(rootFace.vertexIds[1])!.clone().sub(origin).normalize();
  const v = rootNormal.clone().cross(u);
  const exact = (value: number) => {
    if (Math.abs(value - Math.round(value)) > 1e-7) throw new Error("CUBE_NET_CUT_NON_GRID_VERTEX");
    return Math.round(value);
  };
  const faces: PolyhedronNetLayout["faces"] = base.topology.faces.map((face) => ({ faceId: face.id,
    vertices: face.vertexIds.map((vertexId) => {
      const point = points.get(vertexId)!.clone().applyMatrix4(transforms.get(face.id)!).sub(origin);
      if (Math.abs(point.dot(rootNormal)) > 1e-7) throw new Error("CUBE_NET_CUT_NON_PLANAR_FACE");
      return { vertexId, position: { x: exact(point.dot(u)), y: exact(point.dot(v)) } };
    }),
  }));
  const net = unitSquareNet(faces.map((face) => ({
    x: Math.min(...face.vertices.map((vertex) => vertex.position.x)),
    y: Math.min(...face.vertices.map((vertex) => vertex.position.y)),
  })));
  const analysis = analyzeCubeNet(net);
  if (!analysis.isCubeNet) throw new Error("CUBE_NET_CUT_LAYOUT_OVERLAP");
  const entry = createCubeNetGalleryCatalog().entries.find((item) => item.canonicalKey === analysis.canonicalKey)!;
  if (!entry) throw new Error("CUBE_NET_CUT_UNKNOWN_SHAPE");
  const provisional = parsePolyhedronHingeGraph({ ...base.hingeGraph, rootFaceId,
    hinges: checked.remaining.map((edge) => ({ edgeId: edge.edgeId, foldSense: "valley" })),
  });
  const layout = parsePolyhedronNetLayout({ ...base.layout, rootFaceId, faces,
    foldTargets: checked.remaining.map((edge) => ({ edgeId: edge.edgeId, targetAngleMicrodegrees: 90_000_000 })),
  });
  const simulation = analyzePolyhedronFoldSimulation(base.topology, base.geometry, provisional, layout, base.simulationRequest);
  const hingeGraph = parsePolyhedronHingeGraph({ ...provisional,
    hinges: provisional.hinges.map((hinge) => {
      const angle = simulation.targetAngles.find((item) => item.edgeId === hinge.edgeId)!.expectedSignedAngleMicrodegrees;
      if (Math.abs(angle) !== 90_000_000) throw new Error("CUBE_NET_CUT_INVALID_FOLD_ANGLE");
      return { edgeId: hinge.edgeId, foldSense: angle > 0 ? "valley" : "mountain" };
    }),
  });
  const fingerprint = base.topology.edges.map((edge) => cuts.includes(edge.id) ? "1" : "0").join("");
  const sceneInput = parsePolyhedronSceneAdapterInput({ ...base, sceneId: `scene.spatial-lab.cube-cut.${fingerprint}`, hingeGraph, layout });
  return { entry, analysis, sceneInput };
}

export async function buildCubeNetFromCuts(base: CubeNetGalleryFoldingBuild, cuts: readonly string[]): Promise<CubeNetGalleryFoldingBuild> {
  const compiled = createCubeNetCutSceneInput(base.sceneInput, cuts);
  const sceneBuild = await buildPolyhedronFoldScene(compiled.sceneInput);
  const page = await materializeSpatialPageDoc({ ...base.page, scene: sceneBuild.scene });
  return { ...compiled, request: createCubeNetGalleryFoldingRequest(compiled.entry.id), sceneBuild, page };
}

export function cubeNetCutEdges(base: PolyhedronSceneAdapterInput, model: PolyhedronFoldRenderModel, cuts: readonly string[]) {
  return analyzePolyhedronTopology(base.topology).edges.flatMap((edge) => {
    const copies = edge.faceIds.map((faceId) => {
      const face = model.faces.find((item) => item.faceId === faceId)!;
      return { key: `${edge.edgeId}:${faceId}`, edgeId: edge.edgeId, cut: cuts.includes(edge.edgeId),
        start: face.vertices.find((vertex) => vertex.vertexId === edge.vertexIds[0])!.position,
        end: face.vertices.find((vertex) => vertex.vertexId === edge.vertexIds[1])!.position,
      };
    });
    const distance = (a: typeof copies[number]["start"], b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    return distance(copies[0].start, copies[1].start) < 1e-6 && distance(copies[0].end, copies[1].end) < 1e-6 ? [copies[0]] : copies;
  });
}
export type CubeNetCutEdge = ReturnType<typeof cubeNetCutEdges>[number];
