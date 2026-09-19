import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { getStudentLearning, listStudents } from "@/features/school/students";

type Row = Record<string, unknown>;
function clientFor(data: Record<string, Row[]>, options: { gate?: Promise<void>; account?: boolean; failure?: string } = {}) {
  const started: string[] = [];
  const filters: Array<[string, string, unknown]> = [];
  const selections = new Map<string, string>();
  const query = (table: string) => {
    let single = false;
    const api = {
      select: (columns: string) => { selections.set(table, columns); return api; },
      eq: (column: string, value: unknown) => { filters.push([table, column, value]); return api; },
      in: (column: string, value: unknown) => { filters.push([table, column, value]); return api; },
      is: () => api, gte: () => api, order: () => api, limit: () => api, range: () => api,
      returns: () => api,
      maybeSingle: () => { single = true; return api; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (async () => {
        started.push(table);
        if (!["class_sessions", "submissions"].includes(table)) await options.gate;
        if (options.failure === table) return { data: null, error: { message: "read denied" } };
        return { data: table === "get_student_star_total" ? 7
          : table === "students" && single ? { user_id: options.account === false ? null : "account-a" }
            : data[table] ?? [], error: null, count: data[table]?.length ?? null };
      })().then(resolve, reject),
    };
    return api;
  };
  return { client: { from: query, rpc: (name: string, args: unknown) => { filters.push([name, "arguments", args]); return query(name); } }, started, filters, selections };
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
});
