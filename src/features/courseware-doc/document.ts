import { z } from "zod";
import { aixuexiPageDocSchema, type AixuexiPageDoc } from "./aixuexi-schema";
import { pageDocSchema, type PageDoc } from "./schema";

export const coursewareDocSchema = z.discriminatedUnion("docVersion", [
  pageDocSchema,
  aixuexiPageDocSchema,
]);

export type CoursewareDoc = PageDoc | AixuexiPageDoc;

export function parseCoursewareDoc(value: unknown): CoursewareDoc {
  return coursewareDocSchema.parse(value);
}
