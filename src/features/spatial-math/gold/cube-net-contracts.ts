import { z } from "zod";
import { unitSquareNetSchema } from "../domain/net-schema";
import { localizedTextSchema } from "../domain/scene-schema";
import { SPATIAL_GOLD_REVIEW_STATUS } from "./contracts";

const stableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const spatialCubeNetGoldCaseSchema = z
  .object({
    id: stableIdSchema,
    reviewStatus: z.literal(SPATIAL_GOLD_REVIEW_STATUS),
    title: localizedTextSchema,
    capability: z.literal("P4"),
    problemFamily: z.literal("cube-net"),
    termIds: z.tuple([z.literal("nets-of-solids")]),
    net: unitSquareNetSchema.refine((value) => value.cells.length === 6, "cube net gold case must have six cells"),
    expected: z.object({ isCubeNet: z.literal(true) }).strict(),
  })
  .strict();

export const spatialCubeNetGoldCaseSetSchema = z
  .array(spatialCubeNetGoldCaseSchema)
  .length(11)
  .superRefine((cases, context) => {
    const ids = cases.map((goldCase) => goldCase.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "cube net gold case ids must be unique" });
    }
    if (ids.some((id, index) => index > 0 && ids[index - 1] > id)) {
      context.addIssue({ code: "custom", message: "cube net gold cases must use stable id order" });
    }
    const cellSets = cases.map((goldCase) => JSON.stringify(goldCase.net.cells));
    if (new Set(cellSets).size !== cellSets.length) {
      context.addIssue({ code: "custom", message: "cube net gold cell sets must be unique" });
    }
  });

export type SpatialCubeNetGoldCase = z.infer<typeof spatialCubeNetGoldCaseSchema>;
