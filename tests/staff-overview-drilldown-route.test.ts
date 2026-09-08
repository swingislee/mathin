import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/features/school/home/staff-overview-drilldown-actions", () => ({ readOverviewDetail: read }));
import { POST } from "@/app/[locale]/dashboard/overview-detail/route";

const request = (body: string) => new Request("http://example.test/zh/dashboard/overview-detail", {
  method: "POST", headers: { "Content-Type": "application/json" }, body,
});

describe("overview detail transport", () => {
  beforeEach(() => { read.mockReset(); });

  it("returns the existing authorized result without caching and includes read timing", async () => {
    const input = { query: { kind: "business", metric: "arrivals" } };
    const result = { available: true, records: [{ id: "record" }], total: 1 };
    read.mockResolvedValue(result);
    const response = await POST(request(JSON.stringify(input)));
    expect(read).toHaveBeenCalledWith(input);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Server-Timing")).toMatch(/^detail;dur=\d+\.\d$/);
  });

  it("rejects malformed JSON before querying", async () => {
    const response = await POST(request("{"));
    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves input validation and hides internal query failures", async () => {
    const invalid = z.string().safeParse(1);
    read.mockRejectedValueOnce(invalid.error);
    expect((await POST(request("{}"))).status).toBe(400);
    read.mockRejectedValueOnce(new Error("private database diagnostic"));
    const response = await POST(request("{}"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "UNAVAILABLE" });
  });

  it("preserves the staff authorization rejection", async () => {
    read.mockRejectedValue(new Error("Overview access required"));
    const response = await POST(request("{}"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
