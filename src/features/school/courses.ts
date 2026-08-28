import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { SELECT_ALL_VALUE } from "./controls";
import { courseware_template_array_schema, type CoursewareTemplatePage } from "./courseware-overlay";
import type { SchoolPeriod } from "./school-periods";

export type { SchoolPeriod } from "./school-periods";

export const COURSE_TERMS = [
  { value: 1, labelKey: "summer" },
  { value: 2, labelKey: "autumn" },
  { value: 3, labelKey: "winter" },
  { value: 4, labelKey: "spring" },
] as const;

export type SchoolYearStatus = "planning" | "active" | "closed";

export interface SchoolTermRow {
  id: string;
  schoolYearId: string;
  year: number;
  term: SchoolPeriod;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  isCurrent: boolean;
}

export interface SchoolYearActivationPreview {
  promoteCount: number;
  retainedCount: number;
  canActivate: boolean;
}

export interface SchoolYearRow {
  id: string;
  startYear: number;
  name: string;
  status: SchoolYearStatus;
  gradeEffectiveOn: string | null;
  activatedAt: string | null;
  periods: SchoolTermRow[];
  activationPreview: SchoolYearActivationPreview | null;
}

const schoolYearsV2Schema = z.array(z.object({
  id: z.string().uuid(),
  startYear: z.number().int(),
  name: z.string(),
  status: z.enum(["planning", "active", "closed"]),
  gradeEffectiveOn: z.string().nullable(),
  activatedAt: z.string().nullable(),
  periods: z.array(z.object({
    id: z.string().uuid(),
    period: z.number().int().min(1).max(4),
    name: z.string(),
    startsOn: z.string().nullable(),
    endsOn: z.string().nullable(),
    isCurrent: z.boolean(),
  })),
}));

async function getSchoolYearsV2Data() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_school_years_v2");
  if (error) throw new Error(error.message);
  return { supabase, years: schoolYearsV2Schema.parse(data ?? []) };
}

function termRows(years: z.infer<typeof schoolYearsV2Schema>): SchoolTermRow[] {
  return years.flatMap((year) => year.periods.map((period) => ({
    id: period.id,
    schoolYearId: year.id,
    year: year.startYear,
    term: period.period as SchoolPeriod,
    name: period.name,
    startsOn: period.startsOn,
    endsOn: period.endsOn,
    isCurrent: period.isCurrent,
  })));
}

export async function listSchoolTerms(): Promise<SchoolTermRow[]> {
  const { years } = await getSchoolYearsV2Data();
  return termRows(years);
}

export async function listSchoolYears(): Promise<SchoolYearRow[]> {
  const { supabase, years } = await getSchoolYearsV2Data();

  const previews = new Map<string, SchoolYearActivationPreview>();
  await Promise.all(years.filter((row) => row.status === "planning").map(async (row) => {
    const { data, error } = await supabase.rpc("get_school_year_activation_preview", { p_school_year_id: row.id });
    if (error) throw new Error(error.message);
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const raw = data as Record<string, unknown>;
    previews.set(row.id, {
      promoteCount: Number(raw.promoteCount ?? 0),
      retainedCount: Number(raw.retainedCount ?? 0),
      canActivate: raw.canActivate === true,
    });
  }));

  const terms = termRows(years);
  return years.map((row) => ({
    id: row.id,
    startYear: row.startYear,
    name: row.name,
    status: row.status,
    gradeEffectiveOn: row.gradeEffectiveOn,
    activatedAt: row.activatedAt,
    periods: terms.filter((term) => term.schoolYearId === row.id),
    activationPreview: previews.get(row.id) ?? null,
  }));
}

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
    const picked = Array.isArray(value) ? value[0] : value;
    return picked === SELECT_ALL_VALUE ? undefined : picked;
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

/** 供候课/覆盖层编辑页取模板页（不需要课程信息时用这个，省一次 join）。 */
export async function getLectureCoursewareTemplate(id: string): Promise<CoursewareTemplatePage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("course_lectures")
    .select("courseware_template")
    .eq("id", id)
    .maybeSingle<{ courseware_template: CoursewareTemplatePage[] }>();
  if (error) throw new Error(error.message);
  return Array.isArray(data?.courseware_template) ? data.courseware_template : [];
}

/**
 * 备课/试讲读取 session 实际选择的 track release 页面投影。已有 release 时顺序、稳定
 * page identity 与标题来自 immutable release；只有没有 release 的历史讲次才回退 legacy
 * courseware_template。不要用 lectureId 读取函数替代本入口。
 */
export async function getSessionCoursewareTemplate(sessionId: string): Promise<CoursewareTemplatePage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_session_courseware_template", {
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message);
  return courseware_template_array_schema.parse(data);
}

export interface LectureDetail {
  id: string;
  no: number;
  name: string;
  courseId: string;
  courseTitle: string;
  coursewareTemplate: CoursewareTemplatePage[];
  /** P6:有已发布 release 时,模板页提供中台只读预览入口。 */
  hasRelease: boolean;
}

export async function getLectureDetail(id: string): Promise<LectureDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("course_lectures")
    .select("id,no,name,courseware_template,current_release_id,courses(id,title)")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      no: number;
      name: string;
      courseware_template: CoursewareTemplatePage[];
      current_release_id: string | null;
      courses: { id: string; title: string } | null;
    }>();
  if (error) throw new Error(error.message);
  if (!data || !data.courses) return null;
  return {
    id: data.id,
    no: data.no,
    name: data.name,
    courseId: data.courses.id,
    courseTitle: data.courses.title,
    coursewareTemplate: Array.isArray(data.courseware_template) ? data.courseware_template : [],
    hasRelease: data.current_release_id !== null,
  };
}
