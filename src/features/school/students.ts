import { createClient } from "@/lib/supabase/server";

export const STUDENT_STATUSES = ["lead", "trialing", "enrolled", "paused", "alumni", "invalid"] as const;
export const FOLLOW_UP_STATUSES = ["pending", "following", "invited", "trialed", "signed", "lost"] as const;

export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export interface StudentSummary {
  id: string;
  name: string;
  grade: number | null;
  status: StudentStatus;
  followUpStatus: FollowUpStatus;
  assignedName: string;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
}

export interface StudentDetail extends StudentSummary {
  gender: string;
  birthday: string | null;
  phone: string;
  wechat: string;
  school: string;
  parentName: string;
  parentRelation: string;
  parentPhone: string;
  bindCode: string;
  remark: string;
  followUps: StudentFollowUp[];
}

export interface StudentFollowUp {
  id: string;
  content: string;
  kind: string;
  nextFollowUpAt: string | null;
  statusAfter: string | null;
  createdAt: string;
  authorName: string;
}

export interface StudentFilters {
  status?: StudentStatus;
  followUpStatus?: FollowUpStatus;
  grade?: number;
  q?: string;
  page: number;
}

interface StudentRow {
  id: string;
  name: string;
  gender: string;
  birthday: string | null;
  phone: string;
  wechat: string;
  school: string;
  grade: number | null;
  status: StudentStatus;
  follow_up_status: FollowUpStatus;
  parent_name: string;
  parent_relation: string;
  parent_phone: string;
  bind_code: string;
  remark: string;
  last_follow_up_at: string | null;
  next_follow_up_at: string | null;
  profiles: { display_name: string } | null;
}

interface FollowUpRow {
  id: string;
  content: string;
  kind: string;
  next_follow_up_at: string | null;
  status_after: string | null;
  created_at: string;
  profiles: { display_name: string } | null;
}

const PAGE_SIZE = 20;

export function parseStudentFilters(searchParams: Record<string, string | string[] | undefined>): StudentFilters {
  const pick = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const status = pick("status");
  const followUpStatus = pick("followUpStatus");
  const grade = Number(pick("grade"));
  const page = Math.max(1, Number(pick("page")) || 1);
  return {
    status: STUDENT_STATUSES.includes(status as StudentStatus) ? status as StudentStatus : undefined,
    followUpStatus: FOLLOW_UP_STATUSES.includes(followUpStatus as FollowUpStatus) ? followUpStatus as FollowUpStatus : undefined,
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 12 ? grade : undefined,
    q: pick("q")?.trim().slice(0, 80) || undefined,
    page,
  };
}

function toSummary(row: StudentRow): StudentSummary {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade,
    status: row.status,
    followUpStatus: row.follow_up_status,
    assignedName: row.profiles?.display_name || "",
    lastFollowUpAt: row.last_follow_up_at,
    nextFollowUpAt: row.next_follow_up_at,
  };
}

export async function listStudents(filters: StudentFilters): Promise<{ students: StudentSummary[]; count: number | null }> {
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabase
    .from("students")
    .select("id,name,grade,status,follow_up_status,last_follow_up_at,next_follow_up_at,profiles!students_assigned_to_fkey(display_name)", { count: "estimated" });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.followUpStatus) query = query.eq("follow_up_status", filters.followUpStatus);
  if (filters.grade) query = query.eq("grade", filters.grade);
  if (filters.q) {
    const escaped = filters.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    query = query.or(`name.ilike.%${escaped}%,school.ilike.%${escaped}%`);
  }

  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .range(from, to)
    .returns<StudentRow[]>();
  if (error) throw new Error(error.message);
  return { students: (data ?? []).map(toSummary), count };
}

export async function getStudentDetail(id: string): Promise<StudentDetail | null> {
  const supabase = await createClient();
  const { data: student, error } = await supabase
    .from("students")
    .select("id,name,gender,birthday,phone,wechat,school,grade,status,follow_up_status,parent_name,parent_relation,parent_phone,bind_code,remark,last_follow_up_at,next_follow_up_at,profiles!students_assigned_to_fkey(display_name)")
    .eq("id", id)
    .maybeSingle<StudentRow>();
  if (error) throw new Error(error.message);
  if (!student) return null;

  const { data: followUps, error: followUpError } = await supabase
    .from("student_follow_ups")
    .select("id,content,kind,next_follow_up_at,status_after,created_at,profiles!student_follow_ups_author_id_fkey(display_name)")
    .eq("student_id", id)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<FollowUpRow[]>();
  if (followUpError) throw new Error(followUpError.message);

  return {
    ...toSummary(student),
    gender: student.gender,
    birthday: student.birthday,
    phone: student.phone,
    wechat: student.wechat,
    school: student.school,
    parentName: student.parent_name,
    parentRelation: student.parent_relation,
    parentPhone: student.parent_phone,
    bindCode: student.bind_code,
    remark: student.remark,
    followUps: (followUps ?? []).map((followUp) => ({
      id: followUp.id,
      content: followUp.content,
      kind: followUp.kind,
      nextFollowUpAt: followUp.next_follow_up_at,
      statusAfter: followUp.status_after,
      createdAt: followUp.created_at,
      authorName: followUp.profiles?.display_name || "",
    })),
  };
}
