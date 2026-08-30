import { z } from "zod";
import {
  coursewareCompositionPageSchema,
  type CoursewareCompositionPage,
} from "@/features/courseware-doc/composition-page-schema";
import {
  legacyMicrocourseCompositionPageSchema,
  type MicrocoursePageDoc,
} from "@/features/courseware-doc/microcourse-schema";

export const teacherMicrocoursePageDocSchema = z.union([
  coursewareCompositionPageSchema,
  legacyMicrocourseCompositionPageSchema,
]);

export type LegacyTeacherCompositionPage = Extract<MicrocoursePageDoc, { mode: "composition" }>;
export type TeacherMicrocoursePageDoc = CoursewareCompositionPage | LegacyTeacherCompositionPage;
