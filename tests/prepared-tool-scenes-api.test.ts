import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRedirectError } from "next/dist/client/components/redirect";
import { fractionCoursewareSchema, initialFractionScene } from "@/features/tools/scenes/numeric-teaching-content";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { GET, POST } from "@/app/api/tools/scenes/route";

const owner = "10000000-0000-4000-8000-000000000001", id = "20000000-0000-4000-8000-000000000001";
const endpoint = "http://example.test/api/tools/scenes";
const scene = fractionCoursewareSchema.parse({ toolId: "fraction-line", contentVersion: "fraction-line-lesson-v1", payload: { title: "Fractions", initial: initialFractionScene() } });
const row = { id, owner_id: owner, name: "Fractions", catalog_id: "fraction-line", revision: 1, created_at: "2026-09-18T01:00:00Z", updated_at: "2026-09-18T01:00:00Z", scene };
function post(body: unknown = { id, expectedRevision: 0, scene }, extras: Record<string, string> = {}) {
  return new Request(endpoint, { method: "POST", headers: { "content-type": "application/json", origin: "http://example.test", "x-tool-account": owner, ...extras }, body: JSON.stringify(body) });
}
let query: Record<"select" | "eq" | "order" | "limit" | "maybeSingle", ReturnType<typeof vi.fn>>;
let rpc: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({ id: owner });
  query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [row], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  for (const key of ["select", "eq", "order"] as const) query[key].mockReturnValue(query);
  rpc = vi.fn().mockResolvedValue({ data: row, error: null });
  mocks.createClient.mockResolvedValue({ from: vi.fn().mockReturnValue(query), rpc });
});

describe("Tools scene API", () => {
  it("uses one shared account boundary and returns only private metadata in lists", async () => {
    const response = await GET(new Request(endpoint, { headers: { "x-tool-locale": "en" } }));
    expect(mocks.requireUser).toHaveBeenCalledWith("en"); expect(query.eq).toHaveBeenCalledWith("owner_id", owner);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = await response.json();
    expect(result.data[0]).toMatchObject({ catalogId: "fraction-line", id });
    expect(result.data[0]).not.toHaveProperty("scene"); expect(result.data[0]).not.toHaveProperty("owner_id");
  });
  it.each([["/zh/login", 401], ["/zh/dashboard/account-security?required=mfa", 403]] as const)("keeps %s protected", async (url, status) => {
    mocks.requireUser.mockRejectedValueOnce(getRedirectError(url, "replace"));
    expect((await POST(post())).status).toBe(status); expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects account switches and never falls back to another owner's scene", async () => {
    expect((await GET(new Request(endpoint, { headers: { "x-tool-account": "other" } }))).status).toBe(409);
    expect(mocks.createClient).not.toHaveBeenCalled();
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await GET(new Request(`${endpoint}?id=${id}`))).status).toBe(404);
    query.maybeSingle.mockResolvedValueOnce({ data: { ...row, scene: {} }, error: null });
    expect((await GET(new Request(`${endpoint}?id=${id}`))).status).toBe(400);
  });
  it("saves strict scene parameters through the common optimistic RPC without accepting ownership", async () => {
    const response = await POST(post()); expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("save_tool_scene_draft", { p_id: id, p_scene: scene, p_expected_revision: 0 });
    expect((await response.json()).data.scene).toEqual(scene);
  });
  it("rejects unknown versions, extra fields, unsafe images and oversized request streams", async () => {
    for (const input of [
      { id, expectedRevision: 0, scene, owner_id: owner },
      { id, expectedRevision: 0, scene: { ...scene, contentVersion: "unknown" } },
      { id, expectedRevision: 0, scene: { ...scene, payload: { ...scene.payload, answer: 7 } } },
    ]) expect((await POST(post(input))).status).toBe(400);
    expect((await POST(post({ large: "x".repeat(515000) }))).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("validates origin against the browser Host on LAN HTTP and rejects cross-site writes", async () => {
    expect((await POST(post(undefined, { host: "device.test:3130", origin: "http://device.test:3130" }))).status).toBe(200);
    expect((await POST(post(undefined, { host: "device.test:3130", origin: "http://foreign.test:3130" }))).status).toBe(400);
    expect((await POST(post(undefined, { "sec-fetch-site": "cross-site" }))).status).toBe(400);
    expect((await POST(post(undefined, { "x-tool-account": "" }))).status).toBe(409);
  });
  it.each(["TOOL_DRAFT_CONFLICT", "TOOL_DRAFT_MISSING", "TOOL_DRAFT_LIMIT"])("preserves %s and leaves client content intact", async (message) => {
    rpc.mockResolvedValueOnce({ data: null, error: { message, code: "P0001" } });
    const response = await POST(post()); expect(response.status).toBe(message.endsWith("CONFLICT") ? 409 : message.endsWith("MISSING") ? 404 : 422);
  });
});
