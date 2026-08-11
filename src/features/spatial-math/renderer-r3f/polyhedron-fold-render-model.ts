import {
  POLYHEDRON_FOLD_PROGRESS_SCALE,
  POLYHEDRON_SCENE_ADAPTER_ERROR_CODES,
  PolyhedronSceneAdapterError,
  createPolyhedronFoldFrameResolver,
  parseSpatialScene,
  type PolyhedronFoldVector3,
  type SpatialScene,
} from "../domain";

export const POLYHEDRON_FOLD_RENDERER_PROFILE = "standard-4x3" as const;
export const POLYHEDRON_FOLD_RENDERER_MAX_DPR = 1.5;
export const POLYHEDRON_FOLD_RENDERER_MAX_TRANSITION_MS = 10_000;

export type SpatialRendererLocale = "zh" | "en";
export type PolyhedronFoldEasing = "linear" | "ease-in-out";

export function interpolatePolyhedronFoldProgress(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs: number,
  easing: PolyhedronFoldEasing,
): number {
  if (![from, to, elapsedMs, durationMs].every(Number.isFinite)) {
    throw new RangeError("fold transition values must be finite");
  }
  if (from < 0 || from > 1 || to < 0 || to > 1 || elapsedMs < 0 || durationMs < 0) {
    throw new RangeError("fold transition values are out of range");
  }
  if (durationMs === 0 || elapsedMs >= durationMs) return to;
  const progress = Math.min(1, elapsedMs / durationMs);
  const eased = easing === "ease-in-out" ? progress * progress * (3 - 2 * progress) : progress;
  return from + (to - from) * eased;
}

interface LocalizedText {
  readonly zh: string;
  readonly en?: string;
}

export interface PolyhedronFoldRenderFace {
  readonly faceId: string;
  readonly label: string;
  readonly materialToken: string;
  readonly selected: boolean;
  readonly colliding: boolean;
  readonly vertices: readonly {
    readonly vertexId: string;
    readonly position: PolyhedronFoldVector3;
  }[];
  readonly triangleVertexIndices: readonly (readonly [number, number, number])[];
  readonly trianglePositions: readonly number[];
  readonly edgePositions: readonly number[];
  readonly centroid: PolyhedronFoldVector3;
}

export interface PolyhedronFoldRenderBounds {
  readonly min: PolyhedronFoldVector3;
  readonly max: PolyhedronFoldVector3;
  readonly center: PolyhedronFoldVector3;
  readonly radius: number;
}

export interface PolyhedronFoldRenderModel {
  readonly profile: typeof POLYHEDRON_FOLD_RENDERER_PROFILE;
  readonly sceneId: string;
  readonly entityId: string;
  readonly label: string;
  readonly progressMillionths: number;
  readonly background: SpatialScene["presentation"]["background"];
  readonly lighting: SpatialScene["presentation"]["lighting"];
  readonly showEdges: boolean;
  readonly camera: SpatialScene["presentation"]["cameraBookmarks"][number];
  readonly faces: readonly PolyhedronFoldRenderFace[];
  readonly bounds: PolyhedronFoldRenderBounds;
}

export interface PolyhedronNetFallbackFace {
  readonly faceId: string;
  readonly label: string;
  readonly materialToken: string;
  readonly selected: boolean;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly centroid: { readonly x: number; readonly y: number };
}

export interface PolyhedronNetFallbackHinge {
  readonly edgeId: string;
  readonly order: number;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

export interface PolyhedronNetFallbackModel {
  readonly profile: typeof POLYHEDRON_FOLD_RENDERER_PROFILE;
  readonly sceneId: string;
  readonly entityId: string;
  readonly label: string;
  readonly summary: string;
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly labelFontSize: number;
  readonly faces: readonly PolyhedronNetFallbackFace[];
  readonly hinges: readonly PolyhedronNetFallbackHinge[];
}

function localizedText(value: LocalizedText | undefined, locale: SpatialRendererLocale, fallback: string): string {
  if (!value) return fallback;
  return locale === "en" ? value.en ?? value.zh : value.zh;
}

function foldProgressMillionths(progress: number): number {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("fold progress must be between zero and one");
  }
  return Math.round(progress * POLYHEDRON_FOLD_PROGRESS_SCALE);
}

function foldableEntity(scene: SpatialScene, entityId: string) {
  const entity = scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "polyhedron" || !entity.folding) {
    throw new PolyhedronSceneAdapterError(
      POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.entityNotFoldable,
      `scene entity is not foldable: ${entityId}`,
    );
  }
  return entity as typeof entity & { folding: NonNullable<typeof entity.folding> };
}

function centroid(points: readonly PolyhedronFoldVector3[]): PolyhedronFoldVector3 {
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }),
    { x: 0, y: 0, z: 0 },
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length,
    z: total.z / points.length,
  };
}

function renderBounds(points: readonly PolyhedronFoldVector3[]): PolyhedronFoldRenderBounds {
  if (points.length === 0) throw new Error("fold render model requires at least one vertex");
  const min = {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
    z: Math.min(...points.map((point) => point.z)),
  };
  const max = {
    x: Math.max(...points.map((point) => point.x)),
    y: Math.max(...points.map((point) => point.y)),
    z: Math.max(...points.map((point) => point.z)),
  };
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const radius = Math.max(
    0.5,
    ...points.map((point) => Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z)),
  );
  return { min, max, center, radius };
}

export interface PolyhedronFoldRenderModelResolver {
  readonly resolve: (progress: number, selectedFaceIds?: readonly string[]) => PolyhedronFoldRenderModel;
}

export function createPolyhedronFoldRenderModelResolver(
  sceneValue: unknown,
  entityId: string,
  locale: SpatialRendererLocale,
  cameraId?: string,
): PolyhedronFoldRenderModelResolver {
  const scene = parseSpatialScene(sceneValue);
  const entity = foldableEntity(scene, entityId);
  const frameResolver = createPolyhedronFoldFrameResolver(
    entity.folding.topology,
    entity.folding.geometry,
    entity.folding.hingeGraph,
    entity.folding.layout,
  );
  const faceById = new Map(entity.faces.map((face) => [face.id, face]));
  const labelByFaceId = new Map(entity.folding.fallback.faceLabels.map((entry) => [entry.faceId, entry.label]));
  const resolvedCameraId = cameraId ?? scene.presentation.defaultCameraId;
  const camera = scene.presentation.cameraBookmarks.find((bookmark) => bookmark.id === resolvedCameraId);
  if (!camera) throw new Error(`unknown spatial camera bookmark: ${resolvedCameraId}`);
  return {
    resolve: (progress, selectedFaceIds = []) => {
      const progressMillionths = foldProgressMillionths(progress);
      const frame = frameResolver.resolve(progressMillionths);
      const selected = new Set(selectedFaceIds);
      const collidingFaceIds = new Set(frame.collisionPairs.flatMap((pair) => pair.faceIds));
      const faces = frame.faces.map((face): PolyhedronFoldRenderFace => {
        const positionsByIndex = face.vertices.map((vertex) => vertex.position);
        const trianglePositions = face.triangleVertexIndices.flatMap((triangle) =>
          triangle.flatMap((index) => {
            const point = positionsByIndex[index];
            if (!point) throw new Error(`fold triangle index is out of range for ${face.faceId}`);
            return [point.x, point.y, point.z];
          }),
        );
        const edgePositions = face.vertices.flatMap((vertex, index) => {
          const next = face.vertices[(index + 1) % face.vertices.length];
          return [
            vertex.position.x,
            vertex.position.y,
            vertex.position.z,
            next.position.x,
            next.position.y,
            next.position.z,
          ];
        });
        return {
          faceId: face.faceId,
          label: localizedText(labelByFaceId.get(face.faceId), locale, face.faceId),
          materialToken: faceById.get(face.faceId)?.materialToken ?? entity.materialToken,
          selected: selected.has(face.faceId),
          colliding: collidingFaceIds.has(face.faceId),
          vertices: face.vertices,
          triangleVertexIndices: face.triangleVertexIndices,
          trianglePositions,
          edgePositions,
          centroid: centroid(positionsByIndex),
        };
      });
      return {
        profile: POLYHEDRON_FOLD_RENDERER_PROFILE,
        sceneId: scene.sceneId,
        entityId,
        label: localizedText(entity.label, locale, entityId),
        progressMillionths,
        background: scene.presentation.background,
        lighting: scene.presentation.lighting,
        showEdges: scene.presentation.showEdges,
        camera,
        faces,
        bounds: renderBounds(faces.flatMap((face) => face.vertices.map((vertex) => vertex.position))),
      };
    },
  };
}

export function buildPolyhedronFoldRenderModel(
  sceneValue: unknown,
  entityId: string,
  progress: number,
  locale: SpatialRendererLocale,
  options: {
    readonly cameraId?: string;
    readonly selectedFaceIds?: readonly string[];
  } = {},
): PolyhedronFoldRenderModel {
  return createPolyhedronFoldRenderModelResolver(sceneValue, entityId, locale, options.cameraId).resolve(
    progress,
    options.selectedFaceIds,
  );
}

export function buildPolyhedronNetFallbackModel(
  sceneValue: unknown,
  entityId: string,
  locale: SpatialRendererLocale,
  selectedFaceIds: readonly string[] = [],
): PolyhedronNetFallbackModel {
  const scene = parseSpatialScene(sceneValue);
  const entity = foldableEntity(scene, entityId);
  const selected = new Set(selectedFaceIds);
  const labelByFaceId = new Map(entity.folding.fallback.faceLabels.map((entry) => [entry.faceId, entry.label]));
  const faceById = new Map(entity.faces.map((face) => [face.id, face]));
  const sourcePoints = entity.folding.layout.faces.flatMap((face) => face.vertices.map((vertex) => vertex.position));
  const minX = Math.min(...sourcePoints.map((point) => point.x));
  const maxX = Math.max(...sourcePoints.map((point) => point.x));
  const minY = Math.min(...sourcePoints.map((point) => point.y));
  const maxY = Math.max(...sourcePoints.map((point) => point.y));
  const flipY = (y: number) => minY + maxY - y;
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const padding = extent * 0.08;
  const faces = entity.folding.layout.faces.map((face): PolyhedronNetFallbackFace => {
    const points = face.vertices.map((vertex) => ({ x: vertex.position.x, y: flipY(vertex.position.y) }));
    return {
      faceId: face.faceId,
      label: localizedText(labelByFaceId.get(face.faceId), locale, face.faceId),
      materialToken: faceById.get(face.faceId)?.materialToken ?? entity.materialToken,
      selected: selected.has(face.faceId),
      points,
      centroid: {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      },
    };
  });
  const edgeById = new Map(entity.folding.topology.edges.map((edge) => [edge.id, edge]));
  const hinges = entity.folding.fallback.foldOrderEdgeIds.map((edgeId, index): PolyhedronNetFallbackHinge => {
    const edge = edgeById.get(edgeId);
    if (!edge) throw new Error(`unknown fallback hinge edge: ${edgeId}`);
    const hostFace = entity.folding.layout.faces.find((face) => {
      const vertexIds = new Set(face.vertices.map((vertex) => vertex.vertexId));
      return edge.vertexIds.every((vertexId) => vertexIds.has(vertexId));
    });
    if (!hostFace) throw new Error(`fallback hinge has no planar host: ${edgeId}`);
    const positions = new Map(hostFace.vertices.map((vertex) => [vertex.vertexId, vertex.position]));
    const from = positions.get(edge.vertexIds[0]);
    const to = positions.get(edge.vertexIds[1]);
    if (!from || !to) throw new Error(`fallback hinge endpoints are missing: ${edgeId}`);
    return {
      edgeId,
      order: index + 1,
      from: { x: from.x, y: flipY(from.y) },
      to: { x: to.x, y: flipY(to.y) },
    };
  });
  return {
    profile: POLYHEDRON_FOLD_RENDERER_PROFILE,
    sceneId: scene.sceneId,
    entityId,
    label: localizedText(entity.label, locale, entityId),
    summary: localizedText(entity.folding.fallback.summary, locale, scene.title.zh),
    viewBox: {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    },
    labelFontSize: extent / 12,
    faces,
    hinges,
  };
}
