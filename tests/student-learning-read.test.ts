import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { getStudentLearning, listStudents } from "@/features/school/students";

type Row = Record<string, unknown>;
function clientFor(data: Record<string, Row[]>, options: { gate?: Promise<void>; account?: boolean; failure?: string; failureOffset?: number } = {}) {
  const started: string[] = [];
  const filters: Array<[string, string, unknown]> = [];
  const selections = new Map<string, string>();
  const ranges: Array<[string, number, number]> = [];
  const orders: Array<[string, string]> = [];
  const query = (table: string) => {
    let single = false;
    let start = 0, end = 999, limit = 1000;
    const nullFilters: string[] = [];
    const api = {
      select: (columns: string) => { selections.set(table, columns); return api; },
      eq: (column: string, value: unknown) => { filters.push([table, column, value]); return api; },
      in: (column: string, value: unknown) => { filters.push([table, column, value]); return api; },
      is: (column: string, value: unknown) => { filters.push([table, column, value]); if (value === null) nullFilters.push(column); return api; },
      gte: () => api,
      order: (column: string) => { orders.push([table, column]); return api; },
      limit: (value: number) => { limit = value; return api; },
      range: (from: number, to: number) => { start = from; end = to; ranges.push([table, from, to]); return api; },
      returns: () => api,
      maybeSingle: () => { single = true; return api; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
        started.push(table);
        if (!["class_sessions", "submissions"].includes(table)) await options.gate;
        if (options.failure === table && start >= (options.failureOffset ?? 0)) return { data: null, error: { message: "read denied" } };
        const rows = (data[table] ?? []).filter(row => nullFilters.every(column => row[column] == null));
        return { data: table === "get_student_star_total" ? 7
          : table === "students" && single ? { user_id: options.account === false ? null : "account-a" }
            : rows.slice(start, Math.min(end + 1, start + limit)), error: null, count: data[table]?.length ?? null };
      })().then(resolve, reject),
    };
    return api;
  };
  return { client: { from: query, rpc: (name: string, args: unknown) => { filters.push([name, "arguments", args]); return query(name); } }, started, filters, selections, ranges, orders };
}

beforeEach(() => vi.clearAllMocks());

describe("student learning read", () => {
  it("starts independent reads together, then reads account/classroom dependents with the same scope", async () => {
    let release!: () => void;
    const state = clientFor({
      enrollments: [{ classroom_id: "class-a", status: "active", joined_at: "2026-09-01", left_at: null, classrooms: { name: "A", courses: { title: "Math" } } }],
      session_attendance: [{ status: "present" }],
      class_sessions: [{ id: "session-a", title: "Lesson", scheduled_at: "2099-09-01", classrooms: { name: "A" } }],
      submissions: [{ assignment_id: "assignment-a", score: 9, feedback: "ok", submitted_at: "2026-09-01", graded_at: null, assignments: { title: "Practice" } }],
      session_reviews: [{ session_id: "session-a", comment: "review", class_sessions: { title: "Lesson", scheduled_at: "2026-09-01" } }],
      session_videos: [{ id: "video-a", session_id: "session-a", review_comment: "video", class_sessions: { title: "Lesson" } }],
    }, { gate: new Promise<void>(resolve => { release = resolve; }) });
    mocks.createClient.mockResolvedValue(state.client);
    const pending = getStudentLearning("student-a");
    await vi.waitFor(() => expect(new Set(state.started)).toEqual(new Set([
      "students", "enrollments", "session_attendance", "get_student_star_total", "session_reviews", "session_videos",
    ])));
    release();
    const result = await pending;
    expect(result).toMatchObject({ hasAccount: true, starTotal: 7,
      enrollments: [{ classroomId: "class-a", classroomName: "A", courseTitle: "Math" }],
      upcomingSessions: [{ sessionId: "session-a", classroomName: "A", lectureName: "Lesson" }],
      submissions: [{ assignmentId: "assignment-a", score: 9, feedback: "ok" }],
      reviews: [{ sessionId: "session-a", comment: "review" }], videos: [{ id: "video-a", reviewComment: "video" }],
    });
    expect(state.filters).toContainEqual(["submissions", "user_id", "account-a"]);
    expect(state.filters).toContainEqual(["class_sessions", "classroom_id", ["class-a"]]);
    for (const table of ["enrollments", "session_attendance", "session_reviews", "session_videos"]) {
      expect(state.filters).toContainEqual([table, "student_id", "student-a"]);
    }
  });

  it("skips account-only and empty classroom reads, and propagates permission errors", async () => {
    const state = clientFor({}, { account: false });
    mocks.createClient.mockResolvedValue(state.client);
    expect(await getStudentLearning("student-a")).toMatchObject({ hasAccount: false, submissions: [], upcomingSessions: [] });
    expect(state.started).not.toContain("submissions");
    expect(state.started).not.toContain("class_sessions");
    mocks.createClient.mockResolvedValue(clientFor({}, { failure: "session_reviews" }).client);
    await expect(getStudentLearning("student-a")).rejects.toThrow("read denied");
  });

  it("reads only summary fields for the student list", async () => {
    const state = clientFor({ students: [{ id: "student-a", name: "A", grade: 3, status: "enrolled", follow_up_status: "following", profiles: { display_name: "Teacher" }, deleted_at: null, last_follow_up_at: null, next_follow_up_at: null }] });
    mocks.createClient.mockResolvedValue(state.client);
    const result = await listStudents({ recycle: false, page: 1 });
    expect(result.students[0]).toMatchObject({ id: "student-a", name: "A", assignedName: "Teacher", grade: 3 });
    expect(state.selections.get("students")).not.toMatch(/bind_code|parent_phone|remark|birthday/);
  });

  it("counts attendance beyond the REST row limit and rejects partial reads", async () => {
    const source = { session_attendance: Array.from({ length: 1250 }, (_, index) => ({ status: index < 1000 ? "present" : "absent" })) };
    const state = clientFor(source, { account: false });
    mocks.createClient.mockResolvedValue(state.client);
    expect((await getStudentLearning("student-a")).attendance).toEqual({ present: 1000, absent: 250, late: 0, leave: 0, total: 1250, rate: 0.8 });
    expect(state.ranges.filter(([table]) => table === "session_attendance")).toEqual([
      ["session_attendance", 0, 999], ["session_attendance", 1000, 1999],
    ]);
    expect(state.orders.filter(([table]) => table === "session_attendance")).toEqual([
      ["session_attendance", "session_id"], ["session_attendance", "session_id"],
    ]);
    mocks.createClient.mockResolvedValue(clientFor(source, { failure: "session_attendance", failureOffset: 1000 }).client);
    await expect(getStudentLearning("student-a")).rejects.toThrow("read denied");
  });

  it("excludes cancelled, voided and deleted lessons before limiting upcoming sessions", async () => {
    const session = { title: "Lesson", scheduled_at: "2099-09-01", classrooms: { name: "A" } };
    const state = clientFor({
      enrollments: [{ classroom_id: "class-a", status: "active" }],
      class_sessions: [
        ...Array.from({ length: 12 }, (_, index) => ({ ...session, id: `cancelled-${index}`, cancelled_by: "staff-a" })),
        { ...session, id: "voided", voided_at: "2026-09-01" },
        { ...session, id: "deleted", deleted_at: "2026-09-01" },
        { ...session, id: "scheduled" },
      ],
    }, { account: false });
    mocks.createClient.mockResolvedValue(state.client);
    expect((await getStudentLearning("student-a")).upcomingSessions.map(row => row.sessionId)).toEqual(["scheduled"]);
  });
});
