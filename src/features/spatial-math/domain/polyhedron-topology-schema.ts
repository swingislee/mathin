import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json";

export const POLYHEDRON_TOPOLOGY_VERSION = "polyhedron-topology-v1" as const;
export const POLYHEDRON_HINGE_GRAPH_VERSION = "polyhedron-hinge-graph-v1" as const;

export const POLYHEDRON_TOPOLOGY_LIMITS = {
  maxBytes: 512 * 1_024,
  maxVertices: 512,
  maxEdges: 1_536,
  maxFaces: 512,
  maxVerticesPerFace: 64,
  maxHingeBytes: 64 * 1_024,
} as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "invalid stable id");

const vertexSchema = z.object({ id: stableIdSchema }).strict();

const edgeSchema = z
  .object({
    id: stableIdSchema,
    vertexIds: z.tuple([stableIdSchema, stableIdSchema]),
  })
  .strict();

const faceSchema = z
  .object({
    id: stableIdSchema,
    vertexIds: z.array(stableIdSchema).min(3).max(POLYHEDRON_TOPOLOGY_LIMITS.maxVerticesPerFace),
  })
  .strict();

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

export const polyhedronTopologySchema = z
  .object({
    topologyVersion: z.literal(POLYHEDRON_TOPOLOGY_VERSION),
    topologyId: stableIdSchema,
    vertices: z.array(vertexSchema).min(4).max(POLYHEDRON_TOPOLOGY_LIMITS.maxVertices),
    edges: z.array(edgeSchema).max(POLYHEDRON_TOPOLOGY_LIMITS.maxEdges),
    faces: z.array(faceSchema).min(4).max(POLYHEDRON_TOPOLOGY_LIMITS.maxFaces),
  })
  .strict()
  .superRefine((topology, context) => {
    addStableIdIssues(topology.vertices.map((vertex) => vertex.id), context, ["vertices"], "vertex id");
    addStableIdIssues(topology.edges.map((edge) => edge.id), context, ["edges"], "edge id");
    addStableIdIssues(topology.faces.map((face) => face.id), context, ["faces"], "face id");
    topology.edges.forEach((edge, edgeIndex) => {
      if (edge.vertexIds[0] === edge.vertexIds[1]) {
        context.addIssue({ code: "custom", message: "edge endpoints must be distinct", path: ["edges", edgeIndex, "vertexIds"] });
      }
      if (compareStableIds(edge.vertexIds[0], edge.vertexIds[1]) > 0) {
        context.addIssue({ code: "custom", message: "edge endpoints must use stable order", path: ["edges", edgeIndex, "vertexIds"] });
      }
    });
    topology.faces.forEach((face, faceIndex) => {
      const seen = new Set<string>();
      face.vertexIds.forEach((vertexId, vertexIndex) => {
        if (seen.has(vertexId)) {
          context.addIssue({
            code: "custom",
            message: `duplicate face vertex id: ${vertexId}`,
            path: ["faces", faceIndex, "vertexIds", vertexIndex],
          });
        }
        seen.add(vertexId);
      });
    });
    const bytes = new TextEncoder().encode(canonicalJsonStringify(topology)).byteLength;
    if (bytes > POLYHEDRON_TOPOLOGY_LIMITS.maxBytes) {
      context.addIssue({ code: "custom", message: `topology size ${bytes} exceeds limit`, path: [] });
    }
  });

const hingeSchema = z
  .object({
    edgeId: stableIdSchema,
    foldSense: z.enum(["mountain", "valley"]),
  })
  .strict();

export const polyhedronHingeGraphSchema = z
  .object({
    hingeVersion: z.literal(POLYHEDRON_HINGE_GRAPH_VERSION),
    topologyId: stableIdSchema,
    rootFaceId: stableIdSchema,
    hinges: z.array(hingeSchema).max(POLYHEDRON_TOPOLOGY_LIMITS.maxFaces - 1),
  })
  .strict()
  .superRefine((graph, context) => {
    addStableIdIssues(graph.hinges.map((hinge) => hinge.edgeId), context, ["hinges"], "hinge edge id");
    const bytes = new TextEncoder().encode(canonicalJsonStringify(graph)).byteLength;
    if (bytes > POLYHEDRON_TOPOLOGY_LIMITS.maxHingeBytes) {
      context.addIssue({ code: "custom", message: `hinge graph size ${bytes} exceeds limit`, path: [] });
    }
  });

export type PolyhedronTopology = z.infer<typeof polyhedronTopologySchema>;
export type PolyhedronHingeGraph = z.infer<typeof polyhedronHingeGraphSchema>;

export function parsePolyhedronTopology(input: unknown): PolyhedronTopology {
  return polyhedronTopologySchema.parse(input);
}

export function parsePolyhedronHingeGraph(input: unknown): PolyhedronHingeGraph {
  return polyhedronHingeGraphSchema.parse(input);
}
