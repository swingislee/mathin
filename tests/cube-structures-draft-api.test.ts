import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRedirectError } from "next/dist/client/components/redirect";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { GET, POST } from "@/app/api/tools/cube-structures/drafts/route";

const owner = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
const endpoint = "http://example.test/api/tools/cube-structures/drafts";
const snapshot = cubeDraftSnapshot(createCubeSession([]), 0);
const row = { id, owner_id: owner, name: "备课", revision: 1, created_at: "2026-09-07T01:00:00Z", updated_at: "2026-09-07T01:00:00Z", snapshot };
function post(body: unknown = { id, name: row.name, expectedRevision: 0, snapshot }, extras: Record<string, string> = {}) {
  return new Request(endpoint, { method: "POST", headers: { "content-type": "application/json", origin: "http://example.test", "x-cube-account": owner, ...extras }, body: JSON.stringify(body) });
}
let query: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; order: ReturnType<typeof vi.fn>; limit: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };
let rpc: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({ id: owner });
  query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn().mockResolvedValue({ data: [row], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  for (const key of ["select", "eq", "order"] as const) query[key].mockReturnValue(query);
  rpc = vi.fn().mockResolvedValue({ data: row, error: null });
  mocks.createClient.mockResolvedValue({ from: vi.fn().mockReturnValue(query), rpc });
});
describe("cube account draft API", () => {
  it("uses the shared authenticated guard and owner-scoped metadata-only, no-store reads", async () => {
    const response = await GET(new Request(endpoint, { headers: { "x-cube-locale": "en" } }));
    expect(mocks.requireUser).toHaveBeenCalledWith("en");
    expect(query.select).toHaveBeenCalledWith("id,name,revision,created_at,updated_at");
    expect(query.eq).toHaveBeenCalledWith("owner_id", owner);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = await response.json(); expect(result.accountId).toBe(owner); expect(result.data[0]).not.toHaveProperty("snapshot"); expect(result.data[0]).not.toHaveProperty("owner_id");
  });
  it.each([["/zh/login", 401, "auth-required"], ["/zh/dashboard/account-security?required=mfa", 403, "account-security"]] as const)("converts %s into a non-navigation error", async (url, status, code) => {
    mocks.requireUser.mockRejectedValueOnce(getRedirectError(url, "replace"));
    const response = await POST(post()); expect(response.status).toBe(status); expect(await response.json()).toEqual({ code }); expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects account switches before accessing any data", async () => {
    const response = await GET(new Request(endpoint, { headers: { "x-cube-account": "other" } }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: "account-changed" }); expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("returns not-found for foreign/missing drafts and validates loaded content", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await GET(new Request(`${endpoint}?id=${id}`))).status).toBe(404);
    query.maybeSingle.mockResolvedValueOnce({ data: { ...row, snapshot: {} }, error: null });
    expect((await GET(new Request(`${endpoint}?id=${id}`))).status).toBe(400);
  });
  it("validates snapshots, sends server-derived ownership through the RPC, and returns metadata", async () => {
    const response = await POST(post()); expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("save_cube_structure_draft", { p_id: id, p_name: row.name, p_snapshot: snapshot, p_expected_revision: 0 });
    expect((await response.json()).data).toMatchObject({ id, revision: 1, snapshot });
  });
  it.each(["CUBE_DRAFT_CONFLICT", "CUBE_DRAFT_MISSING", "CUBE_DRAFT_LIMIT"])("preserves the database's %s failure", async (message) => {
    rpc.mockResolvedValueOnce({ data: null, error: { message, code: "P0001" } });
    const response = await POST(post()); expect(response.status).toBe(message.endsWith("CONFLICT") ? 409 : message.endsWith("MISSING") ? 404 : 422);
  });
  it("rejects cross-origin and owner-forged writes before the save RPC", async () => {
    expect((await POST(post(undefined, { origin: "https://foreign.test" }))).status).toBe(400);
    expect((await POST(post(undefined, { "x-cube-account": "other" }))).status).toBe(409);
    expect((await POST(post({ id, name: row.name, expectedRevision: 0, snapshot, owner_id: owner }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("checks the browser-facing Host when the dev server uses an internal request URL", async () => {
    const response = await POST(post(undefined, { host: "device.test:3130", origin: "http://device.test:3130" }));
    expect(response.status).toBe(200);
    expect((await POST(post(undefined, { host: "device.test:3130", origin: "http://foreign.test:3130" }))).status).toBe(400);
    expect((await POST(post(undefined, { host: "device.test:3130", origin: "https://device.test:3130" }))).status).toBe(400);
  });
  it("limits actual request bytes even without Content-Length and rejects incompatible snapshots", async () => {
    expect((await POST(post({ extra: "x".repeat(4_003_000) }))).status).toBe(413);
    expect((await POST(post({ id, name: row.name, expectedRevision: 0, snapshot: { ...snapshot, version: "future" } }))).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
