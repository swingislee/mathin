import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readSchoolQueryBatches, readSchoolQueryPages } from "@/features/school/school-query-pages";

describe("school query pagination", () => {
  it("reads every row beyond the REST ceiling with five times fewer page requests", async () => {
    const source = Array.from({ length: 4501 }, (_, id) => ({ id }));
    const read = vi.fn(async (start: number, end: number) => ({ data: source.slice(start, end + 1), error: null }));
    expect(await readSchoolQueryPages(read)).toEqual({ data: source, error: null });
    expect(read).toHaveBeenCalledTimes(5);
    expect(read.mock.calls.every(([start, end]) => end - start + 1 === 1000)).toBe(true);
  });

  it("probes the end of an exact full page and discards partial results on errors", async () => {
    const failure = { message: "permission changed", code: "42501" };
    const read = vi.fn(async (start: number) => start === 0
      ? { data: Array.from({ length: 1000 }, (_, id) => id), error: null }
      : { data: null, error: failure });
    expect(await readSchoolQueryPages(read)).toEqual({ data: null, error: failure });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("bounds concurrency, deduplicates IDs and preserves batch/page order", async () => {
    const ids = Array.from({ length: 405 }, (_, id) => String(id));
    let active = 0; let peak = 0;
    const batches: string[][] = [];
    const result = await readSchoolQueryBatches([...ids, ...ids.slice(0, 3)], async (batch, start, end) => {
      active++; peak = Math.max(peak, active); batches.push(batch);
      await new Promise(resolve => setTimeout(resolve, batch[0] === "0" ? 8 : 1));
      active--;
      return { data: batch.slice(start, end + 1), error: null };
    });
    expect(result).toEqual({ data: ids, error: null });
    expect(peak).toBe(4);
    expect(batches.every(batch => batch.length <= 80)).toBe(true);
    expect(await readSchoolQueryBatches([], () => { throw new Error("unused"); })).toEqual({ data: [], error: null });
  });

  it("does not hide errors or rejected requests in later parallel batches", async () => {
    const ids = Array.from({ length: 321 }, (_, id) => String(id));
    const failure = { message: "failed second batch" };
    const read = vi.fn(async (batch: string[]) => batch[0] === "80"
      ? { data: null, error: failure } : { data: batch, error: null });
    expect(await readSchoolQueryBatches(ids, read)).toEqual({ data: null, error: failure });
    expect(read).toHaveBeenCalledTimes(4);
    await expect(readSchoolQueryBatches(ids, async batch => {
      if (batch[0] === "80") throw new Error("network failure");
      return { data: batch, error: null };
    })).rejects.toThrow("network failure");
  });
});
