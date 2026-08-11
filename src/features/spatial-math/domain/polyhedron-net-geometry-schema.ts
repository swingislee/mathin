import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json";
import { exactVector3Schema } from "./exact";
import { POLYHEDRON_TOPOLOGY_LIMITS } from "./polyhedron-topology-schema";

export const POLYHEDRON_GEOMETRY_VERSION = "polyhedron-geometry-v1" as const;
export const POLYHEDRON_NET_LAYOUT_VERSION = "polyhedron-net-layout-v1" as const;

export const POLYHEDRON_NET_GEOMETRY_LIMITS = {
  maxGeometryBytes: 256 * 1_024,
  maxLayoutBytes: 512 * 1_024,
  minCoordinate: -1_000_000,
  maxCoordinate: 1_000_000,
  maxTargetAngleMicrodegrees: 179_999_999,
} as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "invalid stable id");

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addStableIdIssues(
  ids: readonly string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) context.addIssue({ code: "custom", message: `duplicate ${label}: ${id}`, path: [...path, index] });
    seen.add(id);
    if (index > 0 && compareStableIds(ids[index - 1], id) > 0) {
      context.addIssue({ code: "custom", message: `${label} must use stable order`, path });
    }
  });
}

const geometryVertexSchema = z.object({ vertexId: stableIdSchema, position: exactVector3Schema }).strict();

export const polyhedronGeometrySchema = z
  .object({
    geometryVersion: z.literal(POLYHEDRON_GEOMETRY_VERSION),
    topologyId: stableIdSchema,
    vertices: z.array(geometryVertexSchema).min(4).max(POLYHEDRON_TOPOLOGY_LIMITS.maxVertices),
  })
  .strict()
  .superRefine((geometry, context) => {
    addStableIdIssues(geometry.vertices.map((vertex) => vertex.vertexId), context, ["vertices"], "geometry vertex id");
    const bytes = new TextEncoder().encode(canonicalJsonStringify(geometry)).byteLength;
    if (bytes > POLYHEDRON_NET_GEOMETRY_LIMITS.maxGeometryBytes) {
      context.addIssue({ code: "custom", message: `geometry size ${bytes} exceeds limit`, path: [] });
    }
  });

const planarCoordinateSchema = z
  .number()
  .int()
  .min(POLYHEDRON_NET_GEOMETRY_LIMITS.minCoordinate)
  .max(POLYHEDRON_NET_GEOMETRY_LIMITS.maxCoordinate);

export const exactPlanarPointSchema = z.object({ x: planarCoordinateSchema, y: planarCoordinateSchema }).strict();

const layoutVertexSchema = z
  .object({
    vertexId: stableIdSchema,
    position: exactPlanarPointSchema,
  })
  .strict();

const layoutFaceSchema = z
  .object({
    faceId: stableIdSchema,
    vertices: z.array(layoutVertexSchema).min(3).max(POLYHEDRON_TOPOLOGY_LIMITS.maxVerticesPerFace),
  })
  .strict()
  .superRefine((face, context) => {
    const seen = new Set<string>();
    face.vertices.forEach((vertex, index) => {
      if (seen.has(vertex.vertexId)) {
        context.addIssue({
          code: "custom",
          message: `duplicate layout vertex id: ${vertex.vertexId}`,
          path: ["vertices", index, "vertexId"],
        });
      }
      seen.add(vertex.vertexId);
    });
  });

const foldTargetSchema = z
  .object({
    edgeId: stableIdSchema,
    targetAngleMicrodegrees: z
      .number()
      .int()
      .min(1)
      .max(POLYHEDRON_NET_GEOMETRY_LIMITS.maxTargetAngleMicrodegrees),
  })
  .strict();

export const polyhedronNetLayoutSchema = z
  .object({
    layoutVersion: z.literal(POLYHEDRON_NET_LAYOUT_VERSION),
    topologyId: stableIdSchema,
    rootFaceId: stableIdSchema,
    faces: z.array(layoutFaceSchema).min(1).max(POLYHEDRON_TOPOLOGY_LIMITS.maxFaces),
    foldTargets: z.array(foldTargetSchema).max(POLYHEDRON_TOPOLOGY_LIMITS.maxFaces - 1),
  })
  .strict()
  .superRefine((layout, context) => {
    addStableIdIssues(layout.faces.map((face) => face.faceId), context, ["faces"], "layout face id");
    addStableIdIssues(layout.foldTargets.map((fold) => fold.edgeId), context, ["foldTargets"], "fold target edge id");
    const bytes = new TextEncoder().encode(canonicalJsonStringify(layout)).byteLength;
    if (bytes > POLYHEDRON_NET_GEOMETRY_LIMITS.maxLayoutBytes) {
      context.addIssue({ code: "custom", message: `net layout size ${bytes} exceeds limit`, path: [] });
    }
  });

export type PolyhedronGeometry = z.infer<typeof polyhedronGeometrySchema>;
export type ExactPlanarPoint = z.infer<typeof exactPlanarPointSchema>;
export type PolyhedronNetLayout = z.infer<typeof polyhedronNetLayoutSchema>;

export function parsePolyhedronGeometry(input: unknown): PolyhedronGeometry {
  return polyhedronGeometrySchema.parse(input);
}

export function parsePolyhedronNetLayout(input: unknown): PolyhedronNetLayout {
  return polyhedronNetLayoutSchema.parse(input);
}
