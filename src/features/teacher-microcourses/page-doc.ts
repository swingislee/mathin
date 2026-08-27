import { z } from "zod";
import {
  gamePageDocSchema,
  type GamePageDoc,
} from "@/features/courseware-doc/game-page-schema";
import {
  microcoursePageDocSchema,
  type MicrocoursePageDoc,
} from "@/features/courseware-doc/microcourse-schema";

export const teacherMicrocoursePageDocSchema = z.union([
  microcoursePageDocSchema,
  gamePageDocSchema,
]);

export type TeacherMicrocoursePageDoc = MicrocoursePageDoc | GamePageDoc;

