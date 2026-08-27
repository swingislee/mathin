import { z } from "zod";
import { aixuexiPageDocSchema, type AixuexiPageDoc } from "./aixuexi-schema";
import { pageDocSchema, type PageDoc } from "./schema";
import { gamePageDocSchema, type GamePageDoc } from "./game-page-schema";
import {
  microcoursePageDocSchema,
  type MicrocoursePageDoc,
} from "./microcourse-schema";
import {
  spatialPageDocSchema,
  type SpatialPageDoc,
} from "@/features/spatial-math/domain/page-schema";
export { isSpatialPageDoc } from "./spatial";

export const coursewareDocSchema = z.union([
  pageDocSchema,
  aixuexiPageDocSchema,
  spatialPageDocSchema,
  microcoursePageDocSchema,
  gamePageDocSchema,
]);

export type CoursewareDoc = PageDoc | AixuexiPageDoc | SpatialPageDoc | MicrocoursePageDoc | GamePageDoc;

export function parseCoursewareDoc(value: unknown): CoursewareDoc {
  return coursewareDocSchema.parse(value);
}
