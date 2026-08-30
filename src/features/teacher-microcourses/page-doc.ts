import { z } from "zod";
import {
  coursewareCompositionPageSchema,
  type CoursewareCompositionPage,
} from "@/features/courseware-doc/composition-page-schema";
import {
  microcoursePageDocSchema,
  type MicrocoursePageDoc,
} from "@/features/courseware-doc/microcourse-schema";
import {
  gamePageDocSchema,
  type GamePageDoc,
} from "@/features/courseware-doc/game-page-schema";

export const teacherMicrocoursePageDocSchema = z.union([
  coursewareCompositionPageSchema,
  microcoursePageDocSchema,
  gamePageDocSchema,
]);

export type LegacyTeacherCompositionPage = Extract<MicrocoursePageDoc, { mode: "composition" }>;
/** Historical standalone game/H5/Sudoku pages stay readable while new pages use composition. */
export type TeacherMicrocoursePageDoc = CoursewareCompositionPage | MicrocoursePageDoc | GamePageDoc;
