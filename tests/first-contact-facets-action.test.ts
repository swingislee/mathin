import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFirstContactFacetsAction } from "@/features/school/first-contact-facets-action";
import { POST } from "@/app/[locale]/dashboard/communication/filter-options/route";

const deps = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/actions/guards", () => ({ staffRpcClient: deps.guard }));
vi.mock("@/features/school/organization-locations", () => ({ getOrganizationTimezoneV2: async () => "Asia/Shanghai" }));
vi.mock("@/features/school/student-stage-table-data", () => ({ loadStudentStageFieldPage: deps.load }));
const fields = JSON.stringify({ version: 2, filters: { scope: { kind: "enum", values: ["group"] }, grade: { kind: "enum", values: ["3"] } }, sort: null });
const facets = { owner: { options: [{ value: "outside-page", label: "Another support member" }], days: [] } };
beforeEach(() => {
  vi.clearAllMocks();
  deps.guard.mockResolvedValue({ user: { id: "authenticated-actor" } });
  deps.load.mockResolvedValue({ rows: [{ privateStudent: "not returned" }], count: 5000, fieldView: { facets } });
});

describe("deferred first-contact facets", () => {
  it("uses a private uncached read endpoint and rejects malformed JSON", async () => {
    const request = (body: string) => new Request("http://example.test/zh/dashboard/communication/filter-options", { method: "POST", body });
    const invalid = await POST(request("{"));
    expect(invalid.status).toBe(400);
    expect(deps.guard).not.toHaveBeenCalled();
    const response = await POST(request(JSON.stringify({ locale: "zh", fields })));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, data: facets });
  });
  it("returns only authorized options through one bounded list RPC, with current conditions and no duplicate hints", async () => {
    expect(await getFirstContactFacetsAction({ locale: "en", fields })).toEqual({ ok: true, data: facets });
    expect(deps.guard).toHaveBeenCalledTimes(1);
    expect(deps.load).toHaveBeenCalledTimes(1);
    expect(deps.load).toHaveBeenCalledWith({ stage: "awaiting_first_contact", population: "records", scope: "all", q: "", detail: "", page: 1, pageSize: 20, fields },
      { locale: "en", timeZone: "Asia/Shanghai", now: expect.any(Number) }, "authenticated-actor", { includeRecordHints: false });
  });
  it("validates input and preserves authorization failures without returning data", async () => {
    expect(await getFirstContactFacetsAction({ locale: "zh", fields: "x".repeat(16_385) })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(deps.guard).not.toHaveBeenCalled();
    for (const code of ["UNAUTHENTICATED", "FORBIDDEN"]) {
      deps.guard.mockRejectedValueOnce(new Error(code));
      expect(await getFirstContactFacetsAction({ locale: "zh", fields })).toEqual({ ok: false, code });
    }
    expect(deps.load).not.toHaveBeenCalled();
    deps.load.mockRejectedValueOnce(new Error("FORBIDDEN_SCOPE"));
    expect(await getFirstContactFacetsAction({ locale: "zh", fields })).toEqual({ ok: false, code: "FORBIDDEN_SCOPE" });
  });
});
