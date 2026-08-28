export type ClassBuildPurpose = "production" | "test";

export interface ClassBuildMicrocourseTopic {
  id: string;
  slug: string;
  titleZh: string;
  titleEn: string;
}

export interface ClassBuildLecture {
  id: string;
  no: number;
  name: string;
  objectives: string;
  ready: boolean;
}

export interface ClassBuildCourseCandidate {
  id: string;
  familyId: string;
  familyTitle: string;
  title: string;
  productCode: string | null;
  /** 教材年度版本（course_catalog_versions）。同一年级/季节/班型在换代后会有多个版本。 */
  catalogVersionSlug: string;
  catalogVersionTitle: string;
  /** 已被同族同维度的更新版本替代；建班候选默认不返回这类课程。 */
  isSuperseded: boolean;
  grade: number;
  courseSeason: number | null;
  classType: string;
  lectureCount: number;
  releasedLectureCount: number;
  courseKind: "curriculum" | "microcourse";
  authorId: string | null;
  authorName: string | null;
  primaryTopicSlug: string | null;
  primaryTopicTitleZh: string | null;
  primaryTopicTitleEn: string | null;
  keywords: string[];
}

export interface ClassBuildCourseDetail extends ClassBuildCourseCandidate {
  lectures: ClassBuildLecture[];
}

export interface ClassBuildScheduleConflict {
  sessionId: string;
  classroomName: string;
  lectureName: string;
  scheduledAt: string;
  durationMin: number;
  teacherConflict: boolean;
  roomConflict: boolean;
  roomId: string | null;
  roomName: string | null;
  campusId: string | null;
  campusName: string | null;
}
