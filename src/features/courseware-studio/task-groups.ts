import type { CoursewareTaskItem, CoursewareTaskTab } from "./data";
import { compareCourseVariant } from "@/features/school/teaching-operations/course-difficulty";

export interface CoursewareTaskLecture {
  id: string;
  no: number;
  name: string;
  tracks: CoursewareTaskItem[];
}

export interface CoursewareTaskCourse {
  id: string;
  title: string;
  productCode: string | null;
  grade: number;
  courseSeason: number | null;
  classType: string;
  lastEditedAt: string;
  lectures: CoursewareTaskLecture[];
}

export interface CoursewareTaskVersion {
  id: string;
  title: string | null;
  isCurrent: boolean;
  courses: CoursewareTaskCourse[];
}

export interface CoursewareTaskFamily {
  id: string;
  title: string;
  lectureCount: number;
  versions: CoursewareTaskVersion[];
}

/** Keep the RPC's family order (including recency), then organize each course's lectures. */
export function groupCoursewareTasks(tasks: CoursewareTaskItem[], tab: CoursewareTaskTab): CoursewareTaskFamily[] {
  const families = new Map<string, CoursewareTaskFamily>();
  for (const item of tasks) {
    let family = families.get(item.familyId);
    if (!family) {
      family = { id: item.familyId, title: item.familyTitle, lectureCount: 0, versions: [] };
      families.set(item.familyId, family);
    }
    const versionId = item.catalogVersionId ?? "uncatalogued";
    let version = family.versions.find(row => row.id === versionId);
    if (!version) {
      version = { id: versionId, title: item.catalogVersionTitle, isCurrent: item.catalogVersionCurrent, courses: [] };
      family.versions.push(version);
    }
    let course = version.courses.find(row => row.id === item.courseId);
    if (!course) {
      course = {
        id: item.courseId, title: item.courseTitle, productCode: item.productCode,
        grade: item.grade ?? 99, courseSeason: item.courseSeason, classType: item.classType,
        lastEditedAt: item.lastEditedAt ?? "", lectures: [],
      };
      version.courses.push(course);
    }
    if ((item.lastEditedAt ?? "") > course.lastEditedAt) course.lastEditedAt = item.lastEditedAt!;
    let lecture = course.lectures.find(row => row.id === item.lectureId);
    if (!lecture) {
      lecture = { id: item.lectureId, no: item.lectureNo, name: item.lectureName, tracks: [] };
      course.lectures.push(lecture);
      family.lectureCount += 1;
    }
    lecture.tracks.push(item);
  }
  for (const family of families.values()) {
    if (tab !== "recent") family.versions.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)
      || (b.title ?? "").localeCompare(a.title ?? "", "zh-Hans", { numeric: true }));
    for (const version of family.versions) {
      version.courses.sort((a, b) => (tab === "recent" ? b.lastEditedAt.localeCompare(a.lastEditedAt) : 0)
        || compareCourseVariant(a, b) || a.title.localeCompare(b.title, "zh-Hans"));
      for (const course of version.courses) {
        course.lectures.sort((a, b) => a.no - b.no);
        for (const lecture of course.lectures) lecture.tracks.sort((a, b) =>
          Number(a.track === "adapted-4x3") - Number(b.track === "adapted-4x3"));
      }
    }
  }
  return [...families.values()];
}
