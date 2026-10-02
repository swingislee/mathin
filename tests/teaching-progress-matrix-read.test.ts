import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const client = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
import { getTeachingProgressMatrix } from "../src/features/school/teaching-workbench/teaching-progress-matrix-read";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failures: Set<string>;
const session = (id: string, classroom: string, override: string | null = null) => ({
  id, classroom_id: classroom, title: id, lecture_no: 1, scheduled_at: "2026-10-01T00:00:00Z", duration_min: 60,
  started_at: "2026-10-01T00:00:00Z", ended_at: "2026-10-01T01:00:00Z", teacher_override: override,
  deleted_at: null, voided_at: null, cancelled_by: null,
});
const options = { userId: "teacher-a", canViewTeam: true, canReadCommunication: true, termId: "term" };

beforeEach(() => {
  client.from.mockClear();
  client.rpc.mockReset();
  failures = new Set();
  tables = {
    classrooms: ["a", "b", "c"].map(id => ({ id, name: id, term_id: "term", grade: 3, room: "", purpose: "production", archived_at: null, trashed_at: null,
      course: { title: "Course", grade: 3, class_type: "A" }, default_room: { name: "Room", campuses: { name: "Campus" } } })),
    classroom_staff_assignments: ["a", "b", "c"].map(id => ({ classroom_id: id, user_id: `teacher-${id}`, responsibility: "primary_teacher", profile: { display_name: id } })),
    class_sessions: [session("s1", "a"), session("s2", "a", "teacher-b"), session("s3", "b"), session("s4", "b", "teacher-a"),
      { ...session("cancelled", "a"), cancelled_by: "admin" }],
    session_preparation_reviews: [{ session_id: "s1", artifact_kind: "solution", status: "approved" }, { session_id: "s1", artifact_kind: "lesson_plan", status: "pending" }],
    lesson_plans: [],
    profiles: [{ id: "teacher-a", display_name: "A" }, { id: "teacher-b", display_name: "B" }],
  };
  client.from.mockImplementation((name: string) => {
    let rows = [...(tables[name] ?? [])];
    const orders: { key: string; ascending: boolean }[] = [];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
      is: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return query; },
      order: (key: string, options?: { ascending: boolean }) => { orders.push({ key, ascending: options?.ascending ?? true }); return query; },
      range: async (start: number, end: number) => {
        rows.sort((a, b) => { for (const order of orders) { const diff = String(a[order.key] ?? "").localeCompare(String(b[order.key] ?? "")); if (diff) return order.ascending ? diff : -diff; } return 0; });
        return failures.has(name) ? { data: null, error: { message: "unavailable" } } : { data: rows.slice(start, end + 1), error: null };
      },
    };
    return query;
  });
  client.rpc.mockImplementation(async (_name: string, args: { p_session_ids: string[] }) => failures.has("facts")
    ? { data: null, error: { message: "unavailable" } }
    : { data: args.p_session_ids.map(sessionId => ({ sessionId,
      tasks: sessionId === "s1" ? [{ kind: "reviews", status: "done" }, { kind: "assignment", status: "done" }] : [],
      learningStatuses: sessionId === "s1" ? ["review"] : [],
      classFeedback: sessionId === "s1" ? "contacted" : "missing", communication: "pending",
    })), error: null });
});

describe("teaching matrix reads", () => {
  it("keeps all teachers and empty classes in one matrix, excludes cancelled sessions and preserves source statuses", async () => {
    const data = await getTeachingProgressMatrix(options);
    expect(data.classrooms.map(row => row.id)).toEqual(["a", "b", "c"]);
    expect(data.sessions.map(row => row.id)).not.toContain("cancelled");
    const lesson = data.sessions.find(row => row.id === "s1")!;
    expect(lesson.progress.solution.state).toBe("archived");
    expect(lesson.progress.lesson_plan.state).toBe("review");
    expect(lesson.progress.learning.state).toBe("review");
    expect(lesson.progress.homework.state).toBe("archived");
    expect(lesson.progress.class_feedback.state).toBe("archived");
    expect(lesson.progress.communication.state).toBe("incomplete");
  });

  it("applies the actual teacher scope, including substitution without exposing another teacher's sessions", async () => {
    const data = await getTeachingProgressMatrix({ ...options, canViewTeam: false });
    expect(data.classrooms.map(row => row.id)).toEqual(["a", "b"]);
    expect(data.sessions.map(row => row.id)).toEqual(["s1", "s4"]);
    expect(data.sessions[1].teacherOverride).toEqual({ id: "teacher-a", name: "A" });
    expect(client.rpc).toHaveBeenCalledWith("get_teaching_progress_facts", { p_session_ids: ["s1", "s4"] });
  });

  it("does not read restricted class-group records or represent missing access as incomplete", async () => {
    const data = await getTeachingProgressMatrix({ ...options, canReadCommunication: false });
    expect(client.from.mock.calls.map(call => call[0])).not.toContain("session_class_communications");
    expect(data.sessions[0].progress.class_feedback).toEqual({ state: "unavailable", reason: "forbidden" });
    expect(data.sessions[0].progress.communication).toEqual({ state: "unavailable", reason: "forbidden" });
  });

  it("keeps failed progress reads unknown while retaining available records", async () => {
    failures.add("session_preparation_reviews"); failures.add("lesson_plans");
    const data = await getTeachingProgressMatrix(options);
    expect(data.sessions[0].progress.solution.state).toBe("unavailable");
    expect(data.sessions[0].progress.reflection.state).toBe("unavailable");
    expect(data.sessions[0].progress.class_feedback.state).toBe("archived");
    expect(data.sessions[0].progress.homework.state).toBe("archived");
  });

  it("does not infer completion when facts are failed, malformed or absent", async () => {
    for (const result of [{ data: null, error: { message: "failed" } }, { data: [{}], error: null }, { data: [], error: null }]) {
      client.rpc.mockResolvedValue(result);
      const data = await getTeachingProgressMatrix(options);
      for (const key of ["learning", "homework", "class_feedback", "communication"] as const) expect(data.sessions[0].progress[key].state).toBe("unavailable");
    }
  });

  it("shows a failed lesson-plan fallback as unavailable while retaining an explicit review", async () => {
    failures.add("lesson_plans");
    const data = await getTeachingProgressMatrix(options);
    expect(data.sessions[0].progress.lesson_plan.state).toBe("review");
    expect(data.sessions[1].progress.lesson_plan.state).toBe("unavailable");
  });

  it("fails the page instead of silently dropping classes when the authorized session read fails", async () => {
    failures.add("class_sessions");
    await expect(getTeachingProgressMatrix(options)).rejects.toThrow("TEACHING_MATRIX_UNAVAILABLE");
  });
});
