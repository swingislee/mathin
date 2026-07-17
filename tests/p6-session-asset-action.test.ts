import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

const { getSessionAssetUrls } = await import("@/features/classroom/courseware/session-assets");

describe("P6 session asset signing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed session ids before querying any service", async () => {
    await expect(getSessionAssetUrls("not-a-uuid")).rejects.toThrow("VALIDATION");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before requesting a signed URL", async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } });

    await expect(getSessionAssetUrls(crypto.randomUUID())).rejects.toThrow("UNAUTHENTICATED");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("signs only the object list scoped by the classroom-member RPC", async () => {
    const objectHash = "a".repeat(64);
    const storagePath = `sha256/aa/${objectHash}`;
    const returns = vi.fn().mockResolvedValue({
      data: [{ object_hash: objectHash, storage_path: storagePath, kind: "image" }],
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ returns });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: crypto.randomUUID() } } }) },
      rpc,
    });

    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ path: storagePath, signedUrl: "https://example.test/signed-object" }],
      error: null,
    });
    const from = vi.fn().mockReturnValue({ createSignedUrls });
    mocks.createAdminClient.mockReturnValue({ storage: { from } });

    const sessionId = crypto.randomUUID();
    await expect(getSessionAssetUrls(sessionId)).resolves.toEqual([
      { objectHash, signedUrl: "https://example.test/signed-object" },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_session_resolved_assets", { p_session_id: sessionId });
    expect(from).toHaveBeenCalledWith("cw-objects");
    expect(createSignedUrls).toHaveBeenCalledWith([storagePath], 21_600);
  });
});
