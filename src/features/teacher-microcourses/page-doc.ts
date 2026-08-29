import { z } from "zod";
import {
  coursewareCompositionPageSchema,
  type CoursewareCompositionPage,
} from "@/features/courseware-doc/composition-page-schema";
import {
  legacyMicrocourseCompositionPageSchema,
  type MicrocoursePageDoc,
} from "@/features/courseware-doc/microcourse-schema";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";

export const teacherMicrocoursePageDocSchema = z.union([
  coursewareCompositionPageSchema,
  legacyMicrocourseCompositionPageSchema,
]);

export type LegacyTeacherCompositionPage = Extract<MicrocoursePageDoc, { mode: "composition" }>;
/** Runtime parsing intentionally rejects standalone legacy game/H5/Sudoku pages. */
export type TeacherMicrocoursePageDoc = CoursewareCompositionPage | MicrocoursePageDoc | GamePageDoc;
