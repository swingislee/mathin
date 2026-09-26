import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ rpc: vi.fn(), sign: vi.fn(), admin: vi.fn(), pages: vi.fn(), assets: vi.fn(), h5: vi.fn(), template: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: deps.rpc, storage: { from: () => ({ createSignedUrls: deps.sign }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: deps.admin }));
vi.mock("@/features/classroom/courseware/session-assets", () => ({ getSessionPageDocs: deps.pages, getSessionAssetUrls: deps.assets, getSessionH5BindingUrls: deps.h5 }));
vi.mock("@/features/school/courses", () => ({ getSessionCoursewareTemplate: deps.template }));
import { getSessionMaterials } from "@/features/school/session-materials-read";

const sessionId = "12345678-1234-4234-9234-123456789abc", classroomId = "12345678-1234-4234-9234-123456789def";
const base = { sessionId, classroomId };
const file = { path: `${sessionId}/lesson-plan/file.pdf`, name: "file.pdf", size: 128, type: "application/pdf" };
beforeEach(() => {
  vi.resetAllMocks();
  deps.pages.mockResolvedValue([]); deps.assets.mockResolvedValue([]); deps.h5.mockResolvedValue({});
});

describe("教学材料按权限与选择读取", () => {
  it("权限失败时不请求 Storage 和课件内容", async () => {
    deps.rpc.mockResolvedValue({ error: { message: "FORBIDDEN" } });
    await expect(getSessionMaterials({ ...base, kind: "lesson_plan" })).rejects.toThrow("FORBIDDEN");
    expect(deps.sign).not.toHaveBeenCalled(); expect(deps.pages).not.toHaveBeenCalled(); expect(deps.admin).not.toHaveBeenCalled();
  });
  it("摘要不请求正文或签名", async () => {
    const summary = { kind: "summary", title: "Test", classroomName: "Test class", scheduledAt: null, lessonPlanCount: 0, solutionCount: 0, hasSolutionNotes: false, hasVideo: false };
    deps.rpc.mockResolvedValue({ data: summary });
    expect(await getSessionMaterials({ ...base, kind: "summary" })).toEqual(summary);
    expect(deps.sign).not.toHaveBeenCalled(); expect(deps.pages).not.toHaveBeenCalled(); expect(deps.template).not.toHaveBeenCalled();
  });
  it("签名只发送当前课次对应类型的去重附件", async () => {
    const foreign = { ...file, path: `${classroomId}/lesson-plan/file.pdf` };
    deps.rpc.mockResolvedValue({ data: { kind: "lesson_plan", plan: null, files: [file, file, foreign] } });
    deps.sign.mockResolvedValue({ data: [{ path: file.path, signedUrl: "https://example.test/file" }] });
    const result = await getSessionMaterials({ ...base, kind: "lesson_plan" });
    expect(deps.rpc).toHaveBeenCalledWith("get_session_materials", { p_session_id: sessionId, p_classroom_id: classroomId, p_kind: "lesson_plan" });
    expect(deps.sign).toHaveBeenCalledExactlyOnceWith([file.path], 900);
    expect(result).toMatchObject({ plan: null, files: [{ ...file, url: "https://example.test/file" }, { ...foreign, url: null }] });
    expect(deps.admin).not.toHaveBeenCalled();
  });
  it("签名失败保留文件记录，区分读取失败与未提交", async () => {
    deps.rpc.mockResolvedValue({ data: { kind: "lesson_plan", plan: null, files: [file] } });
    deps.sign.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });
    expect(await getSessionMaterials({ ...base, kind: "lesson_plan" })).toMatchObject({ plan: null, files: [{ ...file, url: null }] });
  });
  it("原课件读取失败保留解析成品与明确错误状态", async () => {
    const record = { id: classroomId, pageDocId: classroomId, revision: 1, content: { items: [] }, updatedAt: "2026-09-27T00:00:00Z" };
    deps.rpc.mockResolvedValue({ data: { kind: "solution", notes: "", files: [], records: [record] } });
    deps.pages.mockRejectedValueOnce(new Error("unavailable"));
    expect(await getSessionMaterials({ ...base, kind: "solution" })).toMatchObject({ records: [record], pages: [], previewFailed: true });
  });
  it("已冻结课件从课次读取，不替换为最新课程模板", async () => {
    deps.rpc.mockResolvedValue({ data: { frozenAt: "2026-09-27T00:00:00Z", pages: [], overlay: [] } });
    expect(await getSessionMaterials({ ...base, kind: "courseware" })).toMatchObject({ kind: "courseware", pages: [], docs: [] });
    expect(deps.template).not.toHaveBeenCalled(); expect(deps.admin).not.toHaveBeenCalled();
  });
});
