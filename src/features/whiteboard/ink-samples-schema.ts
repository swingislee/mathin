import { z } from "zod";

export const strokeBrushSchema = z.enum(["round-v1", "freehand-v1", "freehand-v2"]);
export const strokeSamplesSchema = z.array(z.tuple([
  z.number().finite().nonnegative(), z.number().finite().min(0).max(1).nullable(),
])).max(10_000);
