import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHomeworkGame, createHomeworkH5, loadHomeworkH5, uploadHomeworkImage } from "@/features/school/homework-interactive-actions";
import { saveHomeworkDocument } from "@/features/school/homework-document-actions";
import { createHomeworkQuestions } from "@/features/school/homework-document-contract";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), admin: vi.fn(), upload: vi.fn(), upsert: vi.fn(), sign: vi.fn(), single: vi.fn(), download: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: mocks.authorize, staffRpcClient: mocks.authorize }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const id = "12345678-1234-4234-9234-123456789abc", target = { scope: "lecture" as const, targetId: id };
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: () => query, eq: () => query, single: mocks.single };
  mocks.authorize.mockResolvedValue({ user: { id }, supabase: { rpc: mocks.rpc, from: () => query } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.admin.mockReturnValue({ from: () => ({ upsert: mocks.upsert }), storage: { from: () => ({ upload: mocks.upload, createSignedUrl: mocks.sign, download: mocks.download }) } });
  mocks.upload.mockResolvedValue({ error: null }); mocks.upsert.mockResolvedValue({ error: null }); mocks.sign.mockResolvedValue({ data: { signedUrl: "https://example.invalid/private-preview" }, error: null });
});
describe("homework interactive action boundaries", () => {
  it("checks target write scope before accessing privileged storage or creating games", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await createHomeworkH5({ ...target, html: "<p>Test</p>" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await createHomeworkGame({ ...target, gameId: "sudoku", contentVersion: "sudoku-authored-v2" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rejects a fake image before any storage write", async () => {
    expect(await uploadHomeworkImage({ ...target, file: new File(["not an image"], "example.png", { type: "image/png" }) })).toEqual({ ok: false, code: "VALIDATION" });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("stores normalized private H5 and persists stable resource identity without a signed URL", async () => {
    const result = await createHomeworkH5({ ...target, html: "<p>Test</p>\r\n" });
    expect(result.ok).toBe(true);
    expect(mocks.upload.mock.calls[0][0]).toMatch(/^homework\/[a-f0-9]{64}\/index.html$/);
    expect(new TextDecoder().decode(mocks.upload.mock.calls[0][1])).toBe("<p>Test</p>\n");
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ scope: "lecture", target_id: id, kind: "h5" });
    expect(JSON.stringify(mocks.upsert.mock.calls[0][0])).not.toContain("private-preview");
  });
  it("does not download an H5 asset hidden by RLS", async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: "not visible" } });
    await expect(loadHomeworkH5("a".repeat(64))).rejects.toThrow("FORBIDDEN");
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("returns a committed document version without depending on resource signing", async () => {
    const document = { topic: "Homework", instructions: "", lessonPlan: "", dueAt: null, questions: createHomeworkQuestions(1), overrides: [] };
    mocks.rpc.mockResolvedValue({ data: { version: 2, revision: "new", canWrite: true, document, classTemplate: null, lectureTemplate: null, students: [] }, error: null });
    const result = await saveHomeworkDocument({ ...target, revision: "old", document });
    expect(result).toMatchObject({ ok: true, data: { version: 2, revision: "new" } });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
