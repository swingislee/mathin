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
  return { supabase: { from } as unknown as Parameters<typeof readOverviewAcquisitions>[0], reads };
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
