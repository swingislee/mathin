import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAnyPerm: deps.authorize }));
vi.mock("@/features/school/teaching-workbench/teaching-records-read", () => ({ getTeachingRecords: deps.read }));
import { POST } from "@/app/[locale]/dashboard/teaching/records-detail/route";
const id = "12345678-1234-4234-9234-123456789abc";
const request = (input: unknown) => new Request("http://example.test/zh/dashboard/teaching/records-detail", { method: "POST", body: JSON.stringify(input) });
const context = { params: Promise.resolve({ locale: "zh" }) };
beforeEach(() => { vi.resetAllMocks(); deps.authorize.mockResolvedValue({ id: "user" }); });

describe("teaching inline record endpoint", () => {
  it("validates input before reading and reuses the teaching identity gate", async () => {
    for (const input of [{ sessionId: "bad" }, { sessionId: id, contactPage: -1 }, { sessionId: id, pageSize: 1000 }]) {
      expect((await POST(request(input), context)).status).toBe(400);
    }
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.authorize).toHaveBeenCalledWith("zh", ["class.view.mine", "class.view.all"]);
  });
  it("returns only the requested lesson and contact page with private no-store", async () => {
    deps.read.mockResolvedValue({ session: { id } });
    const response = await POST(request({ sessionId: id, contactPage: 3, pageSize: 10 }), context);
    expect(deps.read).toHaveBeenCalledExactlyOnceWith(id, 3, 10);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Server-Timing")).toMatch(/^records;dur=/);
    expect(await response.json()).toEqual({ session: { id } });
  });
  it("preserves identity redirects and conceals denied RPC details", async () => {
    deps.authorize.mockRejectedValueOnce(new Error("identity redirect"));
    await expect(POST(request({ sessionId: id }), context)).rejects.toThrow("identity redirect");
    expect(deps.read).not.toHaveBeenCalled();
    deps.read.mockRejectedValueOnce(new Error("private database reason"));
    const response = await POST(request({ sessionId: id }), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "UNAVAILABLE" });
  });
});
