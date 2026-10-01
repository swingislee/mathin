import { afterEach, expect, it, vi } from "vitest";
import { readClassSessionResource } from "@/features/school/class-session-resource";

afterEach(() => vi.unstubAllGlobals());

it("does not send a lesson request cancelled during effect setup and cleanup", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const result = readClassSessionResource("/lesson", { sessionId: "example" }, controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([[403, "forbidden"], [503, "failed"]])("keeps a real %s response visible to the caller", async (status, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
  await expect(readClassSessionResource("/lesson", {}, new AbortController().signal)).rejects.toThrow(message);
});

it("keeps active requests cancellable when leaving a lesson", async () => {
  const fetch = vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")));
  }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const result = readClassSessionResource("/lesson", {}, controller.signal);
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledOnce();
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});
