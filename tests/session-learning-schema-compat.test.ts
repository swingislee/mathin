import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const { getSessionCoursewareLearningCheckPages } = await import("@/features/school/session-learning");

function maybeSingleQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe("session learning schema compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps using the scoped RPC when the production schema contract is available", async () => {
    const pageDocId = crypto.randomUUID();
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        page_doc_id: pageDocId,
        page_no: 1,
        title: "例题一",
        learning_check_enabled: true,
      }],
      error: null,
    });
    const from = vi.fn();
    mocks.createClient.mockResolvedValue({ rpc, from });

    await expect(getSessionCoursewareLearningCheckPages(crypto.randomUUID())).resolves.toEqual([{
      pageDocId,
      pageNo: 1,
      title: "例题一",
      learningCheckEnabled: true,
    }]);
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to the immutable formal-course release when only the RPC is missing", async () => {
    const sessionId = crypto.randomUUID();
    const lectureId = crypto.randomUUID();
    const releaseId = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const pageDocId = crypto.randomUUID();
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.get_session_courseware_learning_check_pages(p_session_id) in the schema cache",
      },
    });
    const queries = {
      class_sessions: maybeSingleQuery({
        data: {
          lecture_id: lectureId,
          courseware_track_override: null,
          courseware_resolved: { releaseId },
          classrooms: { courseware_track: "native-16x9" },
        },
        error: null,
      }),
      cw_lecture_releases: maybeSingleQuery({
        data: {
          snapshot: [{ pageDocId, learningCheckEnabled: true }],
          courseware_pages: [{ id: pageId, type: "doc", docId: pageDocId, title: "正式课例题" }],
        },
        error: null,
      }),
    };
    const from = vi.fn((table: keyof typeof queries) => queries[table]);
    mocks.createClient.mockResolvedValue({ rpc, from });

    await expect(getSessionCoursewareLearningCheckPages(sessionId)).resolves.toEqual([{
      pageDocId,
      pageNo: 1,
      title: "正式课例题",
      learningCheckEnabled: true,
    }]);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["class_sessions", "cw_lecture_releases"]);
  });

  it("keeps authorization and other database failures fail-closed", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "FORBIDDEN" },
    });
    const from = vi.fn();
    mocks.createClient.mockResolvedValue({ rpc, from });

    await expect(getSessionCoursewareLearningCheckPages(crypto.randomUUID())).rejects.toThrow("FORBIDDEN");
    expect(from).not.toHaveBeenCalled();
  });
});
