import { analyzePolyhedronTopology, type CubeNetGalleryFoldingBuild, type PolyhedronFoldVector3 } from "@/features/spatial-math/domain";
import { Matrix4, Vector3 } from "three";
import { createPolyhedronFoldRenderModelResolver, type PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { cubeNetHingeProgress, cubeNetTeachingFaces, type CubeNetAngles, type CubeNetTeachingAnchor } from "./cube-net-teaching-session";
import type { CubeView } from "./cube-structures-contract";
import { cubeWorkbenchCamera } from "./cube-workbench-camera";

export interface CubeNetWorkbenchHinge {
  readonly edgeId: string;
  readonly faceId: string;
  readonly parentFaceId: string;
  readonly label: string;
  readonly degrees: number;
  readonly movingFaceIds: readonly string[];
  readonly start: PolyhedronFoldVector3;
  readonly end: PolyhedronFoldVector3;
  readonly direction: number;
}

function faceBasis(points: readonly PolyhedronFoldVector3[]) {
  const vectors = points.map((point) => new Vector3(point.x, point.y, point.z));
  const x = vectors[1].clone().sub(vectors[0]).normalize();
  const normal = x.clone().cross(vectors[2].clone().sub(vectors[0])).normalize();
  const y = normal.clone().cross(x);
  return new Matrix4().makeBasis(x, y, normal).setPosition(vectors[0]);
}

export function createCubeNetWorkbenchResolver(build: CubeNetGalleryFoldingBuild, locale: "zh" | "en") {
  const resolver = createPolyhedronFoldRenderModelResolver(build.page.scene, build.sceneInput.entityId, locale);
  const flat = resolver.resolve(0);
  const rootHeight = flat.faces.find((face) => face.faceId === build.sceneInput.layout.rootFaceId)!.centroid.z;
  // 初始纸张绕 X 转 +90° 后平放；只改变表现坐标，内核与冻结布局保持原值。
  const placeOnTable = (point: PolyhedronFoldVector3) => ({ x: point.x, y: rootHeight - point.z, z: point.y });
  const faces = cubeNetTeachingFaces(build, locale);
  const edges = analyzePolyhedronTopology(build.sceneInput.topology).edges;
  const angles = build.sceneBuild.folding.validation.targetAngles;
  return {
    resolve(values: CubeNetAngles, selectedEdgeId: string | null = null, anchor: CubeNetTeachingAnchor | null = null, movingFaceIds?: readonly string[]) {
      const selectedFaceIds = movingFaceIds ?? (selectedEdgeId ? faces.find((face) => face.edgeId === selectedEdgeId)?.movingFaceIds ?? [] : []);
      const source = resolver.resolve(0, selectedFaceIds, cubeNetHingeProgress(values));
      // 计算内核保留原参考面；表现层将本次支撑面锁在抓取前的位置，任何一侧都可以折动。
      const support = anchor && source.faces.find((face) => face.faceId === anchor.faceId);
      const placement = anchor && support
        ? faceBasis(anchor.vertices).multiply(faceBasis(support.vertices.map((vertex) => placeOnTable(vertex.position))).invert())
        : new Matrix4();
      const place = (point: PolyhedronFoldVector3) => {
        const local = placeOnTable(point);
        const world = new Vector3(local.x, local.y, local.z).applyMatrix4(placement);
        return { x: world.x, y: world.y, z: world.z };
      };
      const renderedFaces = source.faces.map((face) => {
        const vertices = face.vertices.map((vertex) => ({ ...vertex, position: place(vertex.position) }));
        return {
          ...face, vertices, centroid: place(face.centroid),
          trianglePositions: face.triangleVertexIndices.flatMap((triangle) => triangle.flatMap((index) => {
            const point = vertices[index].position;
            return [point.x, point.y, point.z];
          })),
          edgePositions: vertices.flatMap((vertex, index) => {
            const next = vertices[(index + 1) % vertices.length].position;
            return [vertex.position.x, vertex.position.y, vertex.position.z, next.x, next.y, next.z];
          }),
        };
      });
      const points = renderedFaces.flatMap((face) => face.vertices.map((vertex) => vertex.position));
      const min = { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), z: Math.min(...points.map((p) => p.z)) };
      const max = { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)), z: Math.max(...points.map((p) => p.z)) };
      const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
      const model: PolyhedronFoldRenderModel = {
        ...source, faces: renderedFaces,
        bounds: { min, max, center, radius: Math.max(0.5, ...points.map((p) => Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z))) },
      };
      const hinges: CubeNetWorkbenchHinge[] = faces.flatMap((face) => {
        if (!face.edgeId || !face.parentFaceId) return [];
        const edge = edges.find((item) => item.edgeId === face.edgeId)!;
        const parent = model.faces.find((item) => item.faceId === face.parentFaceId)!;
        return [{
          edgeId: face.edgeId, faceId: face.faceId, parentFaceId: face.parentFaceId,
          label: `${faces.find((item) => item.faceId === face.parentFaceId)!.label}—${face.label}`,
          degrees: values[face.edgeId] ?? 0,
          movingFaceIds: face.movingFaceIds,
          start: parent.vertices.find((vertex) => vertex.vertexId === edge.vertexIds[0])!.position,
          end: parent.vertices.find((vertex) => vertex.vertexId === edge.vertexIds[1])!.position,
          direction: Math.sign(angles.find((angle) => angle.edgeId === face.edgeId)!.requestedSignedAngleMicrodegrees),
        }];
      });
      return { model, hinges };
    },
  };
}

export function frameCubeNetWorkbench(model: PolyhedronFoldRenderModel, frame: PolyhedronFoldRenderModel["bounds"], view: CubeView): PolyhedronFoldRenderModel {
  const camera = cubeWorkbenchCamera(frame, view, "cube-net-workbench");
  return {
    ...model, bounds: frame, displayTarget: frame.center,
    camera: { ...camera, projection: "orthographic", zoom: camera.zoom ?? 1, label: { zh: view, en: view } },
  };
}
