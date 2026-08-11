import { z } from "zod";

export const POLYHEDRON_FOLD_SIMULATION_VERSION = "polyhedron-fold-simulation-v1" as const;
export const POLYHEDRON_FOLD_PROGRESS_SCALE = 1_000_000;

export const POLYHEDRON_FOLD_SIMULATION_LIMITS = {
  maxSamples: 101,
  maxFaces: 64,
  maxTriangles: 512,
  maxCollisionPairsPerFrame: 256,
  minClosureToleranceMicrounits: 1,
  maxClosureToleranceMicrounits: 10_000,
} as const;

export const polyhedronFoldProgressSchema = z.number().int().min(0).max(POLYHEDRON_FOLD_PROGRESS_SCALE);

export const polyhedronFoldSimulationRequestSchema = z
  .object({
    simulationVersion: z.literal(POLYHEDRON_FOLD_SIMULATION_VERSION),
    sampleProgressMillionths: z
      .array(polyhedronFoldProgressSchema)
      .min(2)
      .max(POLYHEDRON_FOLD_SIMULATION_LIMITS.maxSamples),
    closureToleranceMicrounits: z
      .number()
      .int()
      .min(POLYHEDRON_FOLD_SIMULATION_LIMITS.minClosureToleranceMicrounits)
      .max(POLYHEDRON_FOLD_SIMULATION_LIMITS.maxClosureToleranceMicrounits),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sampleProgressMillionths[0] !== 0) {
      context.addIssue({
        code: "custom",
        message: "fold samples must start at zero",
        path: ["sampleProgressMillionths", 0],
      });
    }
    const lastIndex = request.sampleProgressMillionths.length - 1;
    if (request.sampleProgressMillionths[lastIndex] !== POLYHEDRON_FOLD_PROGRESS_SCALE) {
      context.addIssue({
        code: "custom",
        message: "fold samples must end at full progress",
        path: ["sampleProgressMillionths", lastIndex],
      });
    }
    request.sampleProgressMillionths.forEach((progress, index) => {
      if (index > 0 && request.sampleProgressMillionths[index - 1] >= progress) {
        context.addIssue({
          code: "custom",
          message: "fold samples must use unique ascending progress",
          path: ["sampleProgressMillionths", index],
        });
      }
    });
  });

export type PolyhedronFoldSimulationRequest = z.infer<typeof polyhedronFoldSimulationRequestSchema>;

export function parsePolyhedronFoldProgress(input: unknown): number {
  return polyhedronFoldProgressSchema.parse(input);
}

export function parsePolyhedronFoldSimulationRequest(input: unknown): PolyhedronFoldSimulationRequest {
  return polyhedronFoldSimulationRequestSchema.parse(input);
}
