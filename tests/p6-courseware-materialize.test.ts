import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const { materializeSessionResolved } = await import("@/features/courseware-studio/data");

describe("P6 courseware release materialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("batches large revision filters so PostgREST request URIs stay bounded", async () => {
    const releaseId = crypto.randomUUID();
    const snapshot = Array.from({ length: 198 }, (_, index) => ({
      pageDocId: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      bindings: [{
        bindingKey: `background-${index}`,
        assetRevisionId: crypto.randomUUID(),
      }],
      learningCheckEnabled: false,
    }));
    const hashByRevisionId = new Map(
      snapshot.map((entry, index) => [
        entry.bindings[0]!.assetRevisionId,
        index.toString(16).padStart(64, "0"),
      ]),
    );
    const revisionBatches: string[][] = [];
    const from = vi.fn((table: string) => {
      if (table === "cw_lecture_releases") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: releaseId, snapshot },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "cw_asset_revisions") {
        return {
          select: vi.fn(() => ({
            in: vi.fn((_column: string, revisionIds: string[]) => {
              revisionBatches.push(revisionIds);
              return Promise.resolve({
                data: revisionIds.map((id) => ({
                  id,
                  object: { sha256: hashByRevisionId.get(id) },
                })),
                error: null,
              });
            }),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    mocks.createClient.mockResolvedValue({ from });

    const result = await materializeSessionResolved(releaseId, "adapted-4x3");

    expect(revisionBatches).toHaveLength(5);
    expect(revisionBatches.every((batch) => batch.length <= 40)).toBe(true);
    expect(revisionBatches.flat()).toEqual([...hashByRevisionId.keys()]);
    expect(result.bindings).toHaveLength(198);
    expect(result.releaseId).toBe(releaseId);
    expect(result.track).toBe("adapted-4x3");
  });
});
