export type ClassBuildPurpose = "production" | "test";

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
  grade: number;
  courseSeason: number;
  classType: string;
  lectureCount: number;
  releasedLectureCount: number;
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
}
