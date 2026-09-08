import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readOverviewAcquisitions } from "@/features/school/home/staff-overview-acquisition-read";
import { OVERVIEW_ACQUISITION_FIELDS, type OverviewAcquisitionSource } from "@/features/school/home/staff-overview-acquisition-contract";

function client(rows: OverviewAcquisitionSource[]) {
  const reads: Array<{ projection: boolean; count: number }> = [];
  const from = () => {
    let selection = "", start = 0, end = Infinity, ids: string[] | null = null;
    const execute = async () => {
      const selected = rows.filter(row => !ids || ids.includes(row.id)).slice(start, end + 1);
      const projection = selection.includes("field0:");
      reads.push({ projection, count: selected.length });
      return { error: null, data: !projection ? selected : selected.map(row => ({ id: row.id, lead_id: row.lead_id,
        ...Object.fromEntries([...selection.matchAll(/(field\d+|text\d+):record_data->cells->(\d+)->>(fieldName|text)/g)]
          .map(match => [match[1], row.record_data.cells?.[Number(match[2])]?.[match[3] as "fieldName" | "text"] ?? null])),
      })) };
    };
    const query = {
      select: (value: string) => { selection = value; return query; },
      eq: () => query, order: () => query,
      in: (_: string, values: string[]) => { ids = values; return query; },
      limit: (limit: number) => { end = limit - 1; return query; },
      range: (from: number, to: number) => { start = from; end = to; return query; },
      then: (...args: Parameters<ReturnType<typeof execute>["then"]>) => execute().then(...args),
    };
    return query;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: { code: "PGRST202" } }) } as unknown as Parameters<typeof readOverviewAcquisitions>[0], reads };
}
const source = (id: string): OverviewAcquisitionSource => ({ id, lead_id: null, record_data: {
  cells: [...OVERVIEW_ACQUISITION_FIELDS.map((fieldName, i) => ({ fieldName, text: `${id}-${i}` })), { fieldName: "metadata", text: "large unused payload" }],
} });

describe("acquisition field projection", () => {
  it("reads one layout sample, then required date, identity and staff text fields", async () => {
    const input = [source("a"), source("b")];
    const mock = client(input);
    const result = await readOverviewAcquisitions(mock.supabase);
    expect(result.data?.map(row => row.record_data.cells)).toEqual(input.map(row => row.record_data.cells?.slice(0, OVERVIEW_ACQUISITION_FIELDS.length)));
    expect(mock.reads).toEqual([{ projection: false, count: 1 }, { projection: true, count: 2 }]);
  });
  it("falls back per row when the source column order changes", async () => {
    const reordered = source("b");
    reordered.record_data.cells?.reverse();
    const mock = client([source("a"), reordered]);
    const result = await readOverviewAcquisitions(mock.supabase);
    expect(result.data?.[1]).toEqual(reordered);
    expect(mock.reads).toEqual([{ projection: false, count: 1 }, { projection: true, count: 2 }, { projection: false, count: 1 }]);
  });
  it("uses complete records when the sampled layout lacks a required field", async () => {
    const incomplete = source("a");
    incomplete.record_data.cells?.shift();
    const mock = client([incomplete, source("b")]);
    expect((await readOverviewAcquisitions(mock.supabase)).data).toEqual([incomplete, source("b")]);
    expect(mock.reads.every(read => !read.projection)).toBe(true);
  });
});

describe("acquisition cursor reads", () => {
  function cursorClient(rows: OverviewAcquisitionSource[]) {
    const from = vi.fn(() => { throw new Error("Unexpected legacy read"); });
    const rpc = vi.fn(async (_: string, args: { p_after: string | null; p_limit: number }) => {
      const start = args.p_after ? rows.findIndex(row => row.id === args.p_after) + 1 : 0;
      return { data: { records: rows.slice(start, start + args.p_limit), hasMore: start + args.p_limit < rows.length }, error: null };
    });
    return { from, rpc, supabase: { from, rpc } as unknown as Parameters<typeof readOverviewAcquisitions>[0] };
  }

  it("reads all pages once in source order, independent of the REST row cap", async () => {
    const rows = Array.from({ length: 2001 }, (_, index) => source(String(index)));
    const mock = cursorClient(rows);
    expect((await readOverviewAcquisitions(mock.supabase)).data).toEqual(rows);
    expect(mock.rpc.mock.calls.map(([, args]) => args.p_after)).toEqual([undefined, "999", "1999"]);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("retains the completeness ceiling and rejects pages that repeat records", async () => {
    const rows = Array.from({ length: 10_001 }, (_, index) => source(String(index)));
    const mock = cursorClient(rows);
    expect((await readOverviewAcquisitions(mock.supabase)).data).toHaveLength(10_000);
    expect(mock.rpc).toHaveBeenCalledTimes(10);
    const repeated = cursorClient([source("a"), source("a")]);
    expect((await readOverviewAcquisitions(repeated.supabase)).error?.message).toBe("OVERVIEW_REPEATED_ACQUISITION_PAGE");
  });

  it("keeps query failures and malformed pages unavailable without a legacy retry", async () => {
    for (const response of [
      { data: null, error: { code: "42501", message: "Denied" } },
      { data: { records: [], hasMore: true }, error: null },
      { data: { records: [{ id: "a", lead_id: null, record_data: null }], hasMore: false }, error: null },
    ]) {
      const from = vi.fn();
      const supabase = { rpc: async () => response, from } as unknown as Parameters<typeof readOverviewAcquisitions>[0];
      expect((await readOverviewAcquisitions(supabase)).error).not.toBeNull();
      expect(from).not.toHaveBeenCalled();
    }
  });
});
