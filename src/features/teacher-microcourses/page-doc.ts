import {
  coursewareCompositionPageSchema,
  type CoursewareCompositionPage,
} from "@/features/courseware-doc/composition-page-schema";

/** Teacher authoring has one document contract and therefore one editor. */
export const teacherMicrocoursePageDocSchema = coursewareCompositionPageSchema;

export type TeacherMicrocoursePageDoc = CoursewareCompositionPage;
