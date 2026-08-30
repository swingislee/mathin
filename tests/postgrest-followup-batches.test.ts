import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getOrganizationTimezoneV2: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/features/school/organization-locations", () => ({
  getOrganizationTimezoneV2: mocks.getOrganizationTimezoneV2,
}));

const { listFollowUpBoard } = await import("@/features/school/followups");

describe("follow-up board PostgREST hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T08:00:00.000Z"));
    mocks.getOrganizationTimezoneV2.mockResolvedValue("Asia/Shanghai");
  });

  it("keeps all follow-up and enrollment filters in bounded batches", async () => {
    const students = Array.from({ length: 500 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `Student ${index}`,
      grade: null,
      status: index === 0 ? "trialing" : "enrolled",
      follow_up_status: "following",
      last_follow_up_at: null,
      next_follow_up_at: null,
    }));
    const studentQuery = {
      select: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      returns: vi.fn(),
    };
    studentQuery.select.mockReturnValue(studentQuery);
    studentQuery.is.mockReturnValue(studentQuery);
    studentQuery.order.mockReturnValue(studentQuery);
    studentQuery.limit.mockReturnValue(studentQuery);
    studentQuery.returns.mockResolvedValue({ data: students, error: null });

    const followUpBatches: string[][] = [];
    const enrollmentBatches: string[][] = [];
    const batchQuery = (table: "student_follow_ups" | "enrollments") => {
      let currentBatch: string[] = [];
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
        limit: vi.fn(),
        returns: vi.fn(),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.in.mockImplementation((_column: string, batch: string[]) => {
        currentBatch = batch;
        (table === "student_follow_ups" ? followUpBatches : enrollmentBatches).push(batch);
        return query;
      });
      query.order.mockReturnValue(query);
      query.limit.mockReturnValue(query);
      query.returns.mockImplementation(async () => ({
        data: table === "student_follow_ups"
          ? currentBatch.map((studentId, index) => ({
              student_id: studentId,
              content: followUpBatches.length === 1 && index === 0 ? "called guardian" : "",
            }))
          : [],
        error: null,
      }));
      return query;
    };
    mocks.createClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "students") return studentQuery;
        if (table === "student_follow_ups" || table === "enrollments") return batchQuery(table);
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const board = await listFollowUpBoard(crypto.randomUUID(), "all");

    expect(followUpBatches).toHaveLength(13);
    expect(enrollmentBatches).toHaveLength(13);
    expect(followUpBatches.every((batch) => batch.length <= 40)).toBe(true);
    expect(enrollmentBatches.flat()).toEqual(students.map((student) => student.id));
    expect(board.groups.flatMap((group) => group.rows).find((row) => row.id === students[0]!.id)?.latestNote)
      .toBe("called guardian");
  });
});
