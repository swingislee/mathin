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
const options = { userId: "teacher-a", canViewTeam: true, canReadCommunication: true, termId: "term", now: Date.parse("2026-10-02T00:00:00Z") };
const fact = (sessionId: string) => ({ sessionId,
  tasks: sessionId === "s1" ? [{ kind: "reviews", status: "done" }, { kind: "assignment", status: "done" }] : [],
  taskTiming: ["reviews", "summary", "assignment", "followup"].map(kind => ({ kind, dueAt: "2026-10-03T00:00:00Z", completedAt: "2026-10-01T02:00:00Z" })),
  learningResults: sessionId === "s1" ? [{ status: "review", completedAt: "2026-10-01T02:00:00Z", reviewedAt: null, requiresReview: true }] : [],
  classFeedback: sessionId === "s1" ? "contacted" : "missing", classFeedbackCompletedAt: sessionId === "s1" ? "2026-10-01T02:00:00Z" : null,
  communication: "pending", communicationCompletedAt: null,
});

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
    session_preparation_reviews: [
      { session_id: "s1", artifact_kind: "solution", status: "approved", submitted_at: "2026-09-23T00:00:00Z", reviewed_at: "2026-09-24T00:00:00Z" },
      { session_id: "s1", artifact_kind: "lesson_plan", status: "pending", submitted_at: "2026-09-23T00:00:00Z", reviewed_at: null },
    ],
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
    : { data: args.p_session_ids.map(fact), error: null });
});

describe("teaching matrix reads", () => {
  it("uses manager-recorded completion for lateness while old records keep submission timing", async () => {
    tables.session_preparation_reviews[0].submitted_at = "2026-10-05T00:00:00Z";
    tables.session_preparation_reviews[0].completed_at = "2026-09-23T00:00:00Z";
    tables.session_preparation_reviews[1].submitted_at = "2026-10-05T00:00:00Z";
    const result = await getTeachingProgressMatrix(options);
    const lesson = result.sessions.find(row => row.id === "s1")!;
    expect(lesson.progress.solution).toMatchObject({ state: "archived", completedAt: "2026-09-23T00:00:00Z" });
    expect(lesson.progress.lesson_plan).toMatchObject({ state: "overdue_review", completedAt: "2026-10-05T00:00:00Z" });
    tables.session_preparation_reviews[0].completed_at = "2026-09-25T00:00:00Z";
    expect((await getTeachingProgressMatrix(options)).sessions.find(row => row.id === "s1")!.progress.solution.state).toBe("overdue_archived");
  });

  it("keeps all teachers and empty classes in one matrix, excludes cancelled sessions and preserves source statuses", async () => {
    const data = await getTeachingProgressMatrix(options);
    expect(data.classrooms.map(row => row.id)).toEqual(["a", "b", "c"]);
    expect(data.sessions.map(row => row.id)).not.toContain("cancelled");
    const lesson = data.sessions.find(row => row.id === "s1")!;
    expect(lesson.progress.solution.state).toBe("archived");
    expect(lesson.progress.lesson_plan.state).toBe("review");
    expect(lesson.progress.learning.state).toBe("review");
    expect(lesson.progress.homework.state).toBe("review");
    expect(lesson.progress.class_feedback.state).toBe("review");
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
    failures.add("session_preparation_reviews");
    tables.lesson_plans.push({ session_id: "s1", status: "approved", updated_at: "2026-10-01T02:00:00Z",
      content: [{ type: "heading", props: { level: 1 }, content: "课后反思" }, { type: "paragraph", content: "下次增加实物演示" }] });
    const data = await getTeachingProgressMatrix(options);
    expect(data.sessions[0].progress.solution.state).toBe("unavailable");
    expect(data.sessions[0].progress.reflection.state).toBe("unavailable");
    expect(data.sessions[0].progress.class_feedback.state).toBe("review");
    expect(data.sessions[0].progress.homework.state).toBe("review");
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

  it("uses the actual material submission and task completion times for late colors", async () => {
    tables.session_preparation_reviews[0].submitted_at = "2026-09-25T00:00:00Z";
    tables.session_preparation_reviews[1].submitted_at = "2026-09-25T00:00:00Z";
    const source = fact("s1");
    source.taskTiming.forEach(row => { row.dueAt = "2026-10-01T01:30:00Z"; });
    client.rpc.mockResolvedValue({ data: [source], error: null });
    const progress = (await getTeachingProgressMatrix(options)).sessions[0].progress;
    expect(progress.solution.state).toBe("overdue_archived");
    expect(progress.lesson_plan.state).toBe("overdue_review");
    expect(progress.rehearsal_video.state).toBe("overdue");
    for (const key of ["homework", "learning", "class_feedback"] as const) expect(progress[key].state).toBe("overdue_review");
    expect(progress.communication.state).toBe("overdue");
  });

  it("does not use a pre-class plan approval as approval of the post-class reflection", async () => {
    tables.session_preparation_reviews[1].status = "approved";
    tables.session_preparation_reviews[1].reviewed_at = "2026-09-24T00:00:00Z";
    tables.lesson_plans.push({ session_id: "s1", status: "approved", updated_at: "2026-10-01T02:00:00Z",
      content: [{ type: "heading", props: { level: 1 }, content: "课后反思" }, { type: "paragraph", content: "下次增加实物演示" }] });
    expect((await getTeachingProgressMatrix(options)).sessions[0].progress.reflection).toMatchObject({ state: "review", reason: "reflection_unreviewed" });
  });

  it("keeps directly published learning pending review until an actual approval is recorded", async () => {
    const source = { ...fact("s1"), learningResults: [{ status: "published", completedAt: "2026-10-01T02:00:00Z", reviewedAt: null as string | null, requiresReview: false }] };
    client.rpc.mockResolvedValue({ data: [source], error: null });
    expect((await getTeachingProgressMatrix(options)).sessions[0].progress.learning).toMatchObject({ state: "review", reason: "published" });
    source.taskTiming.find(row => row.kind === "reviews")!.dueAt = "2026-10-01T01:30:00Z";
    expect((await getTeachingProgressMatrix(options)).sessions[0].progress.learning.state).toBe("overdue_review");
    source.learningResults[0].reviewedAt = "2026-10-02T00:00:00Z";
    expect((await getTeachingProgressMatrix(options)).sessions[0].progress.learning.state).toBe("overdue_archived");
  });
});
