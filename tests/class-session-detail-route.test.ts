import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ authorize: vi.fn(), permissions: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAnyPerm: deps.authorize, getMyPerms: deps.permissions }));
vi.mock("@/features/school/class-roster-session-read", () => ({ getClassSessionDetail: deps.read }));
import { POST } from "@/app/[locale]/dashboard/classes/session-detail/route";
const id = "12345678-1234-4234-9234-123456789abc", classroomId = "12345678-1234-4234-9234-123456789def";
const request = (input: unknown) => new Request("http://example.test/zh/dashboard/classes/session-detail", { method: "POST", body: JSON.stringify(input) });
const context = { params: Promise.resolve({ locale: "zh" }) };
beforeEach(() => { vi.resetAllMocks(); deps.authorize.mockResolvedValue({ id: "user" }); deps.permissions.mockResolvedValue(new Set()); });
describe("班级行下课次详情", () => {
  it("校验真实课次和班级身份，读权不变成课评写权", async () => {
    expect((await POST(request({ sessionId: "bad", classroomId }), context)).status).toBe(400);
    expect(deps.read).not.toHaveBeenCalled();
    deps.read.mockResolvedValue({ records: { session: { id } }, canWriteReview: false });
    const response = await POST(request({ sessionId: id, classroomId, canWriteReview: true }), context);
    expect(deps.authorize).toHaveBeenCalledWith("zh", ["class.view.mine", "class.view.all"]);
    expect(deps.read).toHaveBeenCalledExactlyOnceWith(id, classroomId, "user", false);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await response.json()).canWriteReview).toBe(false);
  });
  it("身份失败不读取；班级不匹配或越权不暴露数据库详情", async () => {
    deps.authorize.mockRejectedValueOnce(new Error("redirect"));
    await expect(POST(request({ sessionId: id, classroomId }), context)).rejects.toThrow("redirect");
    expect(deps.read).not.toHaveBeenCalled();
    deps.read.mockRejectedValueOnce(new Error("private context"));
    const response = await POST(request({ sessionId: id, classroomId }), context);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "UNAVAILABLE" });
  });
});
