import { createClient } from "@/lib/supabase/server";

export const COURSE_TERMS = [
  { value: 1, labelKey: "summer" },
  { value: 2, labelKey: "autumn" },
  { value: 3, labelKey: "winter" },
  { value: 4, labelKey: "spring" },
] as const;

export interface CourseSummary {
  id: string;
  title: string;
  productCode: string | null;
  grade: number;
  term: number;
  classType: string;
  status: "enabled" | "disabled";
  lectureCount: number;
}

export interface CourseLecture {
  id: string;
  no: number;
  name: string;
  objectives: string;
  templatePageCount: number;
}

export interface CourseDetail extends Omit<CourseSummary, "lectureCount"> {
  lectures: CourseLecture[];
}

export interface CourseFilters {
  grade?: number;
  term?: number;
  classType?: string;
  status?: "enabled" | "disabled";
  q?: string;
  page: number;
}

interface CourseRow {
  id: string;
  title: string;
  product_code: string | null;
  grade: number;
  term: number;
  class_type: string;
  status: "enabled" | "disabled";
  course_lectures: Array<{ count: number }> | null;
}

interface LectureRow {
  id: string;
  no: number;
  name: string;
  objectives: string;
  courseware_template: unknown;
}

const PAGE_SIZE = 20;

export function parseCourseFilters(searchParams: Record<string, string | string[] | undefined>): CourseFilters {
  const pick = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const grade = Number(pick("grade"));
  const term = Number(pick("term"));
  const status = pick("status");
  const page = Math.max(1, Number(pick("page")) || 1);
  return {
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 9 ? grade : undefined,
    term: Number.isInteger(term) && term >= 1 && term <= 4 ? term : undefined,
    classType: pick("classType")?.slice(0, 20) || undefined,
    status: status === "enabled" || status === "disabled" ? status : undefined,
    q: pick("q")?.trim().slice(0, 80) || undefined,
    page,
  };
}

export async function listCourses(filters: CourseFilters): Promise<{ courses: CourseSummary[]; count: number | null }> {
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabase
    .from("courses")
    .select("id,title,product_code,grade,term,class_type,status,course_lectures(count)", { count: "estimated" });

  if (filters.grade) query = query.eq("grade", filters.grade);
  if (filters.term) query = query.eq("term", filters.term);
  if (filters.classType) query = query.eq("class_type", filters.classType);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.q) {
    const escaped = filters.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    query = query.or(`title.ilike.%${escaped}%,product_code.ilike.%${escaped}%`);
  }

  const { data, error, count } = await query
    .order("grade", { ascending: true })
    .order("term", { ascending: true })
    .order("class_type", { ascending: true })
    .range(from, to)
    .returns<CourseRow[]>();
  if (error) throw new Error(error.message);
  return {
    courses: (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      productCode: row.product_code,
      grade: row.grade,
      term: row.term,
      classType: row.class_type,
      status: row.status,
      lectureCount: row.course_lectures?.[0]?.count ?? 0,
    })),
    count,
  };
}

export async function getCourseDetail(id: string): Promise<CourseDetail | null> {
  const supabase = await createClient();
  const { data: course, error } = await supabase
    .from("courses")
    .select("id,title,product_code,grade,term,class_type,status")
    .eq("id", id)
    .maybeSingle<Omit<CourseRow, "course_lectures">>();
  if (error) throw new Error(error.message);
  if (!course) return null;

  const { data: lectures, error: lectureError } = await supabase
    .from("course_lectures")
    .select("id,no,name,objectives,courseware_template")
    .eq("course_id", id)
    .order("no", { ascending: true })
    .returns<LectureRow[]>();
  if (lectureError) throw new Error(lectureError.message);

  return {
    id: course.id,
    title: course.title,
    productCode: course.product_code,
    grade: course.grade,
    term: course.term,
    classType: course.class_type,
    status: course.status,
    lectures: (lectures ?? []).map((lecture) => ({
      id: lecture.id,
      no: lecture.no,
      name: lecture.name,
      objectives: lecture.objectives,
      templatePageCount: Array.isArray(lecture.courseware_template) ? lecture.courseware_template.length : 0,
    })),
  };
}
