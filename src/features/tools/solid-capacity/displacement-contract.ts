import { z } from "zod";
import { solveDisplacement } from "./displacement-math";

const size = z.number().finite().min(0.25).max(5);
const tankSize = z.number().finite().min(2).max(12);
const fields = {
  tank: z.object({ width: tankSize, depth: tankSize, height: tankSize, waterHeight: z.number().finite().min(0.1).max(12) }).strict(),
  body: z.object({ kind: z.enum(["cuboid", "stepped"]), width: size, height: size, depth: size, bottom: z.number().finite().min(0).max(13) }).strict(),
  showAmounts: z.boolean(), showDimensions: z.boolean(), showInitialLevel: z.boolean(), axes: z.boolean(), grid: z.boolean(),
  view: z.enum(["angle", "front", "left", "right", "top", "bottom"]),
};
type Fields = z.infer<z.ZodObject<typeof fields>>;
function check(state: Fields, ctx: z.RefinementCtx) {
  if (state.tank.waterHeight > state.tank.height || state.body.bottom > state.tank.height + 1 ||
      state.body.width > state.tank.width - 0.2 || state.body.depth > state.tank.depth - 0.2 || state.body.height > state.tank.height || solveDisplacement(state).overflow) {
    ctx.addIssue({ code: "custom", message: "The object and conserved water must fit inside the tank", path: ["body"] });
  }
}
export const displacementInitialSchema = z.object(fields).strict().superRefine(check);
export const displacementSnapshotSchema = z.object({ ...fields, cameraRevision: z.number().int().min(0).max(1_000_000) }).strict().superRefine(check);
export type DisplacementInitial = z.infer<typeof displacementInitialSchema>;
export type DisplacementSnapshot = z.infer<typeof displacementSnapshotSchema>;
export function createDefaultDisplacementInitial(): DisplacementInitial {
  return { tank: { width: 6, depth: 4, height: 5, waterHeight: 2 }, body: { kind: "cuboid", width: 2, height: 2, depth: 2, bottom: 5.4 },
    showAmounts: false, showDimensions: true, showInitialLevel: true, axes: false, grid: false, view: "angle" };
}
export function displacementSnapshot(initial: DisplacementInitial): DisplacementSnapshot { return { ...displacementInitialSchema.parse(structuredClone(initial)), cameraRevision: 0 }; }
export function displacementInitial(snapshot: DisplacementSnapshot): DisplacementInitial {
  const { cameraRevision: _revision, ...initial } = snapshot; void _revision;
  return displacementInitialSchema.parse(initial);
}
