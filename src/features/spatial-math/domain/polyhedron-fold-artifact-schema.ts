import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json";
import {
  POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION,
  polyhedronFoldSimulationRequestSchema,
} from "./polyhedron-fold-simulation-schema";
import {
  polyhedronGeometrySchema,
  polyhedronNetLayoutSchema,
} from "./polyhedron-net-geometry-schema";
import {
  polyhedronHingeGraphSchema,
  polyhedronTopologySchema,
} from "./polyhedron-topology-schema";

export const POLYHEDRON_FOLD_ARTIFACT_VERSION = "polyhedron-fold-artifact-v1" as const;

export const POLYHEDRON_FOLD_ARTIFACT_LIMITS = {
  maxBytes: 384 * 1_024,
  maxErrorMicrounits: 1_000_000_000_000,
} as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "invalid stable id");

const plainTextSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => !/<\/?[A-Za-z][^>]*>/.test(value), "HTML markup is not allowed");

const localizedTextSchema = z.object({ zh: plainTextSchema, en: plainTextSchema.optional() }).strict();

const faceLabelSchema = z.object({ faceId: stableIdSchema, label: localizedTextSchema }).strict();

const targetAngleSchema = z
  .object({
    edgeId: stableIdSchema,
    parentFaceId: stableIdSchema,
    childFaceId: stableIdSchema,
    requestedSignedAngleMicrodegrees: z.number().int().min(-179_999_999).max(179_999_999),
    expectedSignedAngleMicrodegrees: z.number().int().min(-180_000_000).max(180_000_000),
    deltaMicrodegrees: z.number().int().min(-360_000_000).max(360_000_000),
  })
  .strict();

const faceClosureSchema = z
  .object({
    faceId: stableIdSchema,
    maximumVertexErrorMicrounits: z.number().int().min(0).max(POLYHEDRON_FOLD_ARTIFACT_LIMITS.maxErrorMicrounits),
  })
  .strict();

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addUniqueIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
  requireSorted = false,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) context.addIssue({ code: "custom", message: `duplicate ${label}: ${value}`, path: [...path, index] });
    seen.add(value);
    if (requireSorted && index > 0 && compareIds(values[index - 1], value) > 0) {
      context.addIssue({ code: "custom", message: `${label} must use stable order`, path });
    }
  });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export const polyhedronFoldArtifactSchema = z
  .object({
    artifactVersion: z.literal(POLYHEDRON_FOLD_ARTIFACT_VERSION),
    topology: polyhedronTopologySchema,
    geometry: polyhedronGeometrySchema,
    hingeGraph: polyhedronHingeGraphSchema,
    layout: polyhedronNetLayoutSchema,
    validation: z
      .object({
        kernelVersion: z.literal(POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION),
        request: polyhedronFoldSimulationRequestSchema,
        passesSampledValidation: z.literal(true),
        collisionEvidence: z.literal("deterministic-samples-only"),
        targetAngles: z.array(targetAngleSchema),
        finalClosure: z
          .object({
            toleranceMicrounits: z.number().int().positive().max(10_000),
            maximumVertexErrorMicrounits: z.number().int().min(0).max(POLYHEDRON_FOLD_ARTIFACT_LIMITS.maxErrorMicrounits),
            faces: z.array(faceClosureSchema),
          })
          .strict(),
      })
      .strict(),
    fallback: z
      .object({
        kind: z.literal("polyhedron-net-2d-v1"),
        summary: localizedTextSchema,
        faceLabels: z.array(faceLabelSchema),
        foldOrderEdgeIds: z.array(stableIdSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const topologyId = artifact.topology.topologyId;
    for (const [label, path, candidate] of [
      ["geometry", "geometry", artifact.geometry.topologyId],
      ["hinge graph", "hingeGraph", artifact.hingeGraph.topologyId],
      ["layout", "layout", artifact.layout.topologyId],
    ] as const) {
      if (candidate !== topologyId) {
        context.addIssue({ code: "custom", message: `${label} topology id mismatch`, path: [path, "topologyId"] });
      }
    }
    if (artifact.hingeGraph.rootFaceId !== artifact.layout.rootFaceId) {
      context.addIssue({ code: "custom", message: "hinge and layout root face mismatch", path: ["layout", "rootFaceId"] });
    }

    const topologyVertexIds = artifact.topology.vertices.map((vertex) => vertex.id);
    const geometryVertexIds = artifact.geometry.vertices.map((vertex) => vertex.vertexId);
    if (!sameIds(topologyVertexIds, geometryVertexIds)) {
      context.addIssue({ code: "custom", message: "geometry must cover topology vertices in stable order", path: ["geometry", "vertices"] });
    }
    const topologyFaceIds = artifact.topology.faces.map((face) => face.id);
    const layoutFaceIds = artifact.layout.faces.map((face) => face.faceId);
    if (!sameIds(topologyFaceIds, layoutFaceIds)) {
      context.addIssue({ code: "custom", message: "layout must cover topology faces in stable order", path: ["layout", "faces"] });
    }

    const hingeEdgeIds = artifact.hingeGraph.hinges.map((hinge) => hinge.edgeId);
    const angleEdgeIds = artifact.validation.targetAngles.map((angle) => angle.edgeId);
    addUniqueIssues(angleEdgeIds, context, ["validation", "targetAngles"], "target angle edge id");
    if ([...hingeEdgeIds].sort(compareIds).join("|") !== [...angleEdgeIds].sort(compareIds).join("|")) {
      context.addIssue({ code: "custom", message: "target angles must cover every hinge", path: ["validation", "targetAngles"] });
    }

    const closureFaceIds = artifact.validation.finalClosure.faces.map((face) => face.faceId);
    addUniqueIssues(closureFaceIds, context, ["validation", "finalClosure", "faces"], "closure face id", true);
    if (!sameIds(topologyFaceIds, closureFaceIds)) {
      context.addIssue({ code: "custom", message: "closure rows must cover topology faces", path: ["validation", "finalClosure", "faces"] });
    }
    const maximumFaceError = artifact.validation.finalClosure.faces.reduce(
      (maximum, face) => Math.max(maximum, face.maximumVertexErrorMicrounits),
      0,
    );
    if (maximumFaceError !== artifact.validation.finalClosure.maximumVertexErrorMicrounits) {
      context.addIssue({
        code: "custom",
        message: "closure maximum must equal the maximum face error",
        path: ["validation", "finalClosure", "maximumVertexErrorMicrounits"],
      });
    }

    const fallbackFaceIds = artifact.fallback.faceLabels.map((face) => face.faceId);
    addUniqueIssues(fallbackFaceIds, context, ["fallback", "faceLabels"], "fallback face id", true);
    if (!sameIds(topologyFaceIds, fallbackFaceIds)) {
      context.addIssue({ code: "custom", message: "fallback labels must cover topology faces", path: ["fallback", "faceLabels"] });
    }
    addUniqueIssues(artifact.fallback.foldOrderEdgeIds, context, ["fallback", "foldOrderEdgeIds"], "fold order edge id");
    if (!sameIds(angleEdgeIds, artifact.fallback.foldOrderEdgeIds)) {
      context.addIssue({ code: "custom", message: "fallback fold order must match validated traversal", path: ["fallback", "foldOrderEdgeIds"] });
    }

    const bytes = new TextEncoder().encode(canonicalJsonStringify(artifact)).byteLength;
    if (bytes > POLYHEDRON_FOLD_ARTIFACT_LIMITS.maxBytes) {
      context.addIssue({ code: "custom", message: `fold artifact size ${bytes} exceeds limit`, path: [] });
    }
  });

export type PolyhedronFoldArtifact = z.infer<typeof polyhedronFoldArtifactSchema>;

export function parsePolyhedronFoldArtifact(input: unknown): PolyhedronFoldArtifact {
  return polyhedronFoldArtifactSchema.parse(input);
}
