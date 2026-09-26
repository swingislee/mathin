import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: deps.authorize }));
vi.mock("@/features/school/session-materials-read", () => ({ getSessionMaterials: deps.read }));
import { POST } from "@/app/[locale]/dashboard/classes/session-materials/route";

const input = { sessionId: "12345678-1234-4234-9234-123456789abc", classroomId: "12345678-1234-4234-9234-123456789def", kind: "summary" };
const request = (body: unknown) => new Request("http://example.test/zh/dashboard/classes/session-materials", { method: "POST", body: JSON.stringify(body) });
const context = { params: Promise.resolve({ locale: "zh" }) };
beforeEach(() => { vi.resetAllMocks(); deps.authorize.mockResolvedValue({ id: "user" }); });

describe("课次材料接口", () => {
  it("身份校验后传递班级与课次，不接受客户端能力", async () => {
    deps.read.mockResolvedValue({ kind: "summary" });
    const response = await POST(request({ ...input, canWrite: true }), context);
    expect(deps.authorize).toHaveBeenCalledExactlyOnceWith("zh");
    expect(deps.read).toHaveBeenCalledExactlyOnceWith(input);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("身份或参数失败时不读取材料", async () => {
    expect((await POST(request({ ...input, sessionId: "bad" }), context)).status).toBe(400);
    expect(deps.read).not.toHaveBeenCalled();
    deps.authorize.mockRejectedValueOnce(new Error("redirect"));
    await expect(POST(request(input), context)).rejects.toThrow("redirect");
    expect(deps.read).not.toHaveBeenCalled();
  });
  it.each([["FORBIDDEN", 403, "FORBIDDEN"], ["private database context", 503, "UNAVAILABLE"]])("读取失败使用安全状态 %s", async (message, status, code) => {
    deps.read.mockRejectedValueOnce(new Error(String(message)));
    const response = await POST(request(input), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
