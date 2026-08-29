import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CourseFamilyDetail } from "./course-family-detail";
import type { CourseSeason } from "./types";

const uuidSchema = z.uuid();
const selectAllValue = "__all__";
const topicSchema = z.object({
  slug: z.string(),
  titleZh: z.string(),
  titleEn: z.string(),
});

const libraryRowSchema = z.object({
  course_id: uuidSchema,
  source_classroom_id: uuidSchema,
  source_classroom_name: z.string(),
  author_id: uuidSchema,
  author_name: z.string(),
  offering_type: z.enum(["long_term_formal", "short_term_topic"]),
  created_at: z.string(),
  updated_at: z.string(),
  topics: z.array(topicSchema),
  keywords: z.array(z.string()),
  lecture_titles: z.array(z.string()),
  search_text: z.string(),
});

export type TeacherMicrocourseStructure = "single" | "short" | "series";
export type TeacherMicrocourseReadiness = "ready" | "incomplete";
export type TeacherMicrocourseOffering = "long_term_formal" | "short_term_topic";

export interface TeacherMicrocourseLibraryFilters {
  q?: string;
  structure?: TeacherMicrocourseStructure;
  readiness?: TeacherMicrocourseReadiness;
  grade?: number;
  courseSeason?: CourseSeason | "unspecified";
  classType?: string;
  topic?: string;
  offering?: TeacherMicrocourseOffering;
}

export interface TeacherMicrocourseCatalogItem {
  courseId: string;
  sourceClassroomId: string;
  sourceClassroomName: string;
  authorId: string;
  authorName: string;
  offeringType: TeacherMicrocourseOffering;
  createdAt: string;
  updatedAt: string;
  topics: Array<z.infer<typeof topicSchema>>;
  keywords: string[];
  lectureTitles: string[];
  searchText: string;
}

export type TeacherMicrocourseLibraryEntry = TeacherMicrocourseCatalogItem
  & CourseFamilyDetail["variants"][number];

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isCourseSeason(value: number): value is CourseSeason {
  return Number.isInteger(value) && value >= 1 && value <= 4;
}

export function parseTeacherMicrocourseLibraryFilters(
  input: Record<string, string | string[] | undefined>,
): TeacherMicrocourseLibraryFilters {
  const structure = first(input.mcStructure);
  const readiness = first(input.mcReadiness);
  const grade = Number(first(input.mcGrade));
  const seasonText = first(input.mcSeason);
  const season = Number(seasonText);
  const offering = first(input.mcOffering);
  const classType = first(input.mcClassType)?.trim();
  const topic = first(input.mcTopic)?.trim();
  return {
    q: first(input.q)?.trim().slice(0, 80) || undefined,
    structure: structure === "single" || structure === "short" || structure === "series"
      ? structure
      : undefined,
    readiness: readiness === "ready" || readiness === "incomplete" ? readiness : undefined,
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 9 ? grade : undefined,
    courseSeason: seasonText === "unspecified"
      ? "unspecified"
      : isCourseSeason(season) ? season : undefined,
    classType: classType && classType !== selectAllValue ? classType.slice(0, 40) : undefined,
    topic: topic && topic !== selectAllValue ? topic.slice(0, 60) : undefined,
    offering: offering === "long_term_formal" || offering === "short_term_topic"
      ? offering
      : undefined,
  };
}

export function teacherMicrocourseStructure(lectureCount: number): TeacherMicrocourseStructure {
  if (lectureCount <= 1) return "single";
  if (lectureCount <= 4) return "short";
  return "series";
}

export function teacherMicrocourseIsReady(
  entry: Pick<TeacherMicrocourseLibraryEntry, "lectureCount" | "releasedLectureCount">,
) {
  return entry.lectureCount > 0 && entry.lectureCount === entry.releasedLectureCount;
}

export function filterTeacherMicrocourseLibrary(
  entries: TeacherMicrocourseLibraryEntry[],
  filters: TeacherMicrocourseLibraryFilters,
) {
  const query = filters.q?.toLocaleLowerCase();
  return entries.filter((entry) => {
    if (query && !entry.searchText.toLocaleLowerCase().includes(query)) return false;
    if (filters.structure && teacherMicrocourseStructure(entry.lectureCount) !== filters.structure) return false;
    if (filters.readiness === "ready" && !teacherMicrocourseIsReady(entry)) return false;
    if (filters.readiness === "incomplete" && teacherMicrocourseIsReady(entry)) return false;
    if (filters.grade && entry.grade !== filters.grade) return false;
    if (filters.courseSeason === "unspecified" && entry.courseSeason !== null) return false;
    // 学期未限定的微课可在任一具体学期复用；筛某个学期时不能把这类通用内容漏掉。
    if (typeof filters.courseSeason === "number" && entry.courseSeason !== filters.courseSeason && entry.courseSeason !== null) return false;
    if (filters.classType === "__default__" && entry.classType !== "") return false;
    // 空班型表示通用难度，因此筛 G+/X+/A+ 等具体难度时也应同时返回可复用的通用内容。
    if (filters.classType && filters.classType !== "__default__" && entry.classType !== filters.classType && entry.classType !== "") return false;
    if (filters.topic && !entry.topics.some((topic) => topic.slug === filters.topic)) return false;
    if (filters.offering && entry.offeringType !== filters.offering) return false;
    return true;
  });
}

export function teacherMicrocourseLibrarySearchParams(
  filters: TeacherMicrocourseLibraryFilters,
) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.structure) params.set("mcStructure", filters.structure);
  if (filters.readiness) params.set("mcReadiness", filters.readiness);
  if (filters.grade) params.set("mcGrade", String(filters.grade));
  if (filters.courseSeason !== undefined) params.set("mcSeason", String(filters.courseSeason));
  if (filters.classType) params.set("mcClassType", filters.classType);
  if (filters.topic) params.set("mcTopic", filters.topic);
  if (filters.offering) params.set("mcOffering", filters.offering);
  return params;
}

export async function listTeacherMicrocourseLibrary(
  familyId: string,
): Promise<TeacherMicrocourseCatalogItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_teacher_microcourse_library", {
    p_family_id: uuidSchema.parse(familyId),
  });
  if (error) throw new Error(error.message);
  return z.array(libraryRowSchema).parse(data ?? []).map((row) => ({
    courseId: row.course_id,
    sourceClassroomId: row.source_classroom_id,
    sourceClassroomName: row.source_classroom_name,
    authorId: row.author_id,
    authorName: row.author_name,
    offeringType: row.offering_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    topics: row.topics,
    keywords: row.keywords,
    lectureTitles: row.lecture_titles,
    searchText: row.search_text,
  }));
}
