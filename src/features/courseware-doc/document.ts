import { z } from "zod";
import {
  aixuexiPageDocSchema,
  collectAixuexiBindingKeys,
  isAixuexiPageDoc,
  type AixuexiPageDoc,
} from "./aixuexi-schema";
import { collectBindingKeys, PAGE_DOC_VERSION, pageDocSchema, type PageDoc } from "./schema";
import { gamePageDocSchema, type GamePageDoc } from "./game-page-schema";
import {
  coursewareCompositionPageSchema,
  type CoursewareCompositionPage,
} from "./composition-page-schema";
import {
  collectSourceRuntimeBindingKeys,
  isSourceRuntimePageDoc,
  sourceRuntimePageDocSchema,
  type SourceRuntimePageDoc,
} from "./source-runtime-schema";
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
  coursewareCompositionPageSchema,
  gamePageDocSchema,
  sourceRuntimePageDocSchema,
]);

export type CoursewareDoc = PageDoc | AixuexiPageDoc | SpatialPageDoc | MicrocoursePageDoc | CoursewareCompositionPage | GamePageDoc | SourceRuntimePageDoc;

export function parseCoursewareDoc(value: unknown): CoursewareDoc {
  return coursewareDocSchema.parse(value);
}

/**
 * Runtime URL materialization must follow the binding closure declared by the
 * immutable document. Release snapshots intentionally retain historical
 * bindings for audit, but those records are not render dependencies.
 */
export function collectCoursewareDocBindingKeys(doc: CoursewareDoc): ReadonlySet<string> | null {
  if (doc.docVersion === PAGE_DOC_VERSION) return new Set(collectBindingKeys(doc).keys());
  if (isSourceRuntimePageDoc(doc)) return collectSourceRuntimeBindingKeys(doc);
  if (isAixuexiPageDoc(doc)) return collectAixuexiBindingKeys(doc);
  return null;
}

export function scopeCoursewareDocBindings<T extends { bindingKey: string }>(
  doc: CoursewareDoc,
  bindings: readonly T[],
): T[] {
  const required = collectCoursewareDocBindingKeys(doc);
  if (required === null) return [...bindings];
  const scoped = bindings.filter((binding) => required.has(binding.bindingKey));
  const available = new Set(scoped.map((binding) => binding.bindingKey));
  const missing = [...required].filter((bindingKey) => !available.has(bindingKey));
  if (missing.length > 0) {
    throw new Error(`COURSEWARE_DOC_BINDING_MISSING: ${missing.join(",")}`);
  }
  return scoped;
}
