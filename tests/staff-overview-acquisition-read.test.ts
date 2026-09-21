import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readOverviewAcquisitions } from "@/features/school/home/staff-overview-acquisition-read";
import type { OverviewAcquisitionSource } from "@/features/school/home/staff-overview-acquisition-contract";

const source = (id: string): OverviewAcquisitionSource => ({ id, lead_id: null, source_alias_ids: [id], record_data: { cells: [] } });
function client(rows: OverviewAcquisitionSource[]) {
  const from = vi.fn(() => { throw new Error("Unexpected archive fallback"); });
  const rpc = vi.fn(async (_: string, args: { p_after?: string; p_limit: number }) => {
    const start = args.p_after ? rows.findIndex(row => row.id === args.p_after) + 1 : 0;
    return { data: { records: rows.slice(start, start + args.p_limit), hasMore: start + args.p_limit < rows.length, revision: "stable" }, error: null };
  });
  return { from, rpc, supabase: { from, rpc } as unknown as Parameters<typeof readOverviewAcquisitions>[0] };
}

describe("current acquisition snapshot reads", () => {
  it("reads all authorized sources in one database snapshot without a dated file argument", async () => {
    const rows = Array.from({ length: 2001 }, (_, index) => source(String(index)));
    const mock = client(rows);
    expect((await readOverviewAcquisitions(mock.supabase)).data).toEqual(rows);
    expect(mock.rpc.mock.calls).toEqual([["list_current_staff_overview_acquisition_sources", { p_limit: 10_000 }]]);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("retains the completeness ceiling and rejects repeated records", async () => {
    const mock = client(Array.from({ length: 10_001 }, (_, index) => source(String(index))));
    expect((await readOverviewAcquisitions(mock.supabase)).data).toHaveLength(10_000);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect((await readOverviewAcquisitions(client([source("a"), source("a")]).supabase)).error?.message)
      .toBe("OVERVIEW_REPEATED_ACQUISITION_PAGE");
  });

  it("rejects a server with the old page ceiling rather than silently truncating the snapshot", async () => {
    const mock = client(Array.from({ length: 1001 }, (_, index) => source(String(index))));
    mock.rpc.mockResolvedValue({ data: { records: Array.from({ length: 1000 }, (_, index) => source(String(index))), hasMore: true, revision: "r" }, error: null });
    expect((await readOverviewAcquisitions(mock.supabase)).error?.message).toBe("OVERVIEW_INVALID_ACQUISITION_PAGE");
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps missing migrations, denied queries and malformed pages unavailable without an old-file fallback", async () => {
    for (const response of [
      { data: null, error: { code: "PGRST202", message: "Migration required" } },
      { data: null, error: { code: "42501", message: "Denied" } },
      { data: { records: [], hasMore: true, revision: "r" }, error: null },
      { data: { records: [source("a")], hasMore: false }, error: null },
      { data: { records: [{ ...source("a"), source_alias_ids: [] }], hasMore: false, revision: "r" }, error: null },
      { data: { records: [{ id: "a", lead_id: null, record_data: null }], hasMore: false, revision: "r" }, error: null },
    ]) {
      const from = vi.fn();
      const supabase = { rpc: async () => response, from } as unknown as Parameters<typeof readOverviewAcquisitions>[0];
      expect((await readOverviewAcquisitions(supabase)).error).not.toBeNull();
      expect(from).not.toHaveBeenCalled();
    }
  });
});
