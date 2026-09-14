import { analyzePolyhedronTopology, type CubeNetGalleryFoldingBuild, type PolyhedronFoldVector3 } from "@/features/spatial-math/domain";
import { createPolyhedronFoldRenderModelResolver, type PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { cubeNetHingeProgress, cubeNetTeachingFaces, type CubeNetAngles } from "./cube-net-teaching-session";
import type { CubeView } from "./cube-structures-contract";
import { cubeWorkbenchCamera } from "./cube-workbench-camera";

export interface CubeNetWorkbenchHinge {
  readonly edgeId: string;
  readonly faceId: string;
  readonly parentFaceId: string;
  readonly label: string;
  readonly movingFaceIds: readonly string[];
  readonly start: PolyhedronFoldVector3;
  readonly end: PolyhedronFoldVector3;
  readonly direction: number;
}

export function createCubeNetWorkbenchResolver(build: CubeNetGalleryFoldingBuild, locale: "zh" | "en") {
  const resolver = createPolyhedronFoldRenderModelResolver(build.page.scene, build.sceneInput.entityId, locale);
  const flat = resolver.resolve(0);
  const rootHeight = flat.faces.find((face) => face.faceId === build.sceneInput.layout.rootFaceId)!.centroid.z;
  // 绕 X 转 +90° 并将固定面放到地面；只改变表现坐标，内核与冻结布局保持原值。
  const place = (point: PolyhedronFoldVector3) => ({ x: point.x, y: rootHeight - point.z, z: point.y });
  const faces = cubeNetTeachingFaces(build, locale);
  const edges = analyzePolyhedronTopology(build.sceneInput.topology).edges;
  const angles = build.sceneBuild.folding.validation.targetAngles;
  return {
    resolve(values: CubeNetAngles, selectedEdgeId: string | null = null) {
      const selectedFaceIds = selectedEdgeId ? faces.find((face) => face.edgeId === selectedEdgeId)?.movingFaceIds ?? [] : [];
      const source = resolver.resolve(0, selectedFaceIds, cubeNetHingeProgress(values));
      const model: PolyhedronFoldRenderModel = {
        ...source,
        bounds: {
          ...source.bounds, center: place(source.bounds.center),
          min: { x: source.bounds.min.x, y: rootHeight - source.bounds.max.z, z: source.bounds.min.y },
          max: { x: source.bounds.max.x, y: rootHeight - source.bounds.min.z, z: source.bounds.max.y },
        },
        faces: source.faces.map((face) => {
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
        }),
      };
      const hinges: CubeNetWorkbenchHinge[] = faces.flatMap((face) => {
        if (!face.edgeId || !face.parentFaceId) return [];
        const edge = edges.find((item) => item.edgeId === face.edgeId)!;
        const parent = model.faces.find((item) => item.faceId === face.parentFaceId)!;
        return [{
          edgeId: face.edgeId, faceId: face.faceId, parentFaceId: face.parentFaceId,
          label: `${faces.find((item) => item.faceId === face.parentFaceId)!.label}—${face.label}`,
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
