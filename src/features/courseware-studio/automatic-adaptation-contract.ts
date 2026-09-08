import { pageDocSchema } from "@/features/courseware-doc/schema";
import { sourceRuntimePageDocSchema } from "@/features/courseware-doc/source-runtime-schema";
import { courseware43SessionFromLegacyAdaptClass, defaultCourseware43Session, materializeCourseware43PageDoc, type LegacyCourseware43AdaptClass } from "@/features/courseware-doc/courseware-4x3-strategy";
import { withSourceRuntimeCourseware43Session } from "@/features/courseware-doc/source-runtime-four-by-three";

/** 整讲粗版与单页编辑器共用同一匹配策略和物化器。 */
export function automaticCourseware43Doc(doc: unknown, adaptClass: string | null) {
  const page = pageDocSchema.safeParse(doc);
  if (page.success) return materializeCourseware43PageDoc(page.data,
    courseware43SessionFromLegacyAdaptClass(adaptClass as LegacyCourseware43AdaptClass | null) ?? defaultCourseware43Session("page-doc"));
  const source = sourceRuntimePageDocSchema.safeParse(doc);
  if (source.success) return withSourceRuntimeCourseware43Session(source.data, defaultCourseware43Session("source-runtime"));
  throw new Error("UNSUPPORTED_AUTO_ADAPTATION");
}
