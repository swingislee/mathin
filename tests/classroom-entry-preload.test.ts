import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPageDoc } from "@/features/classroom/courseware/session-assets";
import type { PageDoc } from "@/features/courseware-doc/schema";

const mocks = vi.hoisted(() => ({
  pageDocs: vi.fn(),
  assetUrls: vi.fn(),
  downloadMedia: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock("@/features/classroom/courseware/session-assets", () => ({
  getSessionPageDocs: mocks.pageDocs,
  getSessionAssetUrls: mocks.assetUrls,
}));
vi.mock("@/features/classroom/courseware/upload", () => ({ downloadCoursewareAsset: mocks.downloadMedia }));
vi.mock("@/features/classroom/sync/idb", () => ({
  STORE_ASSETS: "assets",
  idbGet: async (_store: string, key: string) => mocks.cache.get(key),
  idbPut: async (_store: string, key: string, value: unknown) => { mocks.cache.set(key, value); },
}));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "https://assets.example.test" }) }));

const { preloadSessionAssets } = await import("@/features/classroom/courseware/preload-session-assets");
const doc: PageDoc = {
  docVersion: "page-doc-v1", sourceCoursewareId: "lesson", sourcePageId: null,
  sourcePageDatabaseId: 1, sourceSnapshotId: 1, sourceContentHash: "a".repeat(64),
  canvas: { width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: null },
  nodes: [], interactions: [],
};
function page(id: string, hash: string, kind = "image"): SessionPageDoc {
  return { pageDocId: id, pageNo: 1, doc, bindings: [{ bindingKey: id, objectHash: hash, kind, launchQuery: null }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(active = "current") {
  const controller = new AbortController();
  const options = {
    sessionId: "session", loadDocs: true, mediaPaths: [] as string[],
    activeDocId: () => active, activeMediaPath: (): string | null => null,
    signal: controller.signal, isCurrent: () => true,
    onDocs: vi.fn(), onDocUrls: vi.fn(), onMediaUrl: vi.fn(),
    onObjectUrl: vi.fn(), onProgress: vi.fn(),
  };
  return { options, controller };
}
const manifest = () => new Response(JSON.stringify({ entryPath: "index.html", files: [] }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.clear();
  mocks.pageDocs.mockResolvedValue([]);
  mocks.assetUrls.mockResolvedValue([]);
  let serial = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:loaded-${++serial}`);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("classroom entry resource scheduling", () => {
  it("shows the cached current page while an unrelated video and H5 manifest are still downloading", async () => {
    const video = deferred<Blob>(), slowManifest = deferred<Response>();
    mocks.pageDocs.mockResolvedValue([page("current", "image"), page("later", "package", "h5")]);
    mocks.cache.set("cw:image", new Blob(["image"]));
    mocks.downloadMedia.mockReturnValue(video.promise);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(slowManifest.promise));
    const { options } = setup();
    options.mediaPaths = ["later-video.mp4"];
    const run = preloadSessionAssets(options);

    await vi.waitFor(() => expect(options.onDocUrls).toHaveBeenCalledWith({ current: "blob:loaded-1" }));
    expect(options.onProgress).toHaveBeenLastCalledWith({ done: 1, total: 2, failed: 0 });
    expect(mocks.assetUrls).not.toHaveBeenCalled();
    expect(options.onMediaUrl).not.toHaveBeenCalled();
    video.resolve(new Blob(["video"]));
    slowManifest.resolve(manifest());
    await run;
    expect(options.onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2, failed: 0 });
  });

  it("publishes the active H5 entry before a different package and image finish", async () => {
    const image = deferred<Response>(), later = deferred<Response>();
    mocks.pageDocs.mockResolvedValue([page("later", "later-package", "h5"), page("current", "active-package", "h5"), page("image", "image")]);
    mocks.assetUrls.mockResolvedValue([{ objectHash: "image", signedUrl: "https://signed.example.test/image" }]);
    const fetcher = vi.fn((url: string) => url.includes("active-package") ? Promise.resolve(manifest())
      : url.includes("later-package") ? later.promise : image.promise);
    vi.stubGlobal("fetch", fetcher);
    const { options } = setup();
    const run = preloadSessionAssets(options);
    await vi.waitFor(() => expect(options.onDocUrls).toHaveBeenCalledWith(expect.objectContaining({ current: expect.stringContaining("/active-package/index.html") })));
    expect(options.onDocUrls.mock.lastCall?.[0]).not.toHaveProperty("image");
    const manifestRequests = fetcher.mock.calls.filter(([url]) => url.includes("__mathin_manifest"));
    expect(manifestRequests[0][0]).toContain("active-package");
    image.resolve(new Response("image")); later.resolve(manifest());
    await run;
    expect(options.onDocUrls.mock.lastCall?.[0]).toEqual(expect.objectContaining({ current: expect.stringContaining("active-package"), image: expect.stringContaining("blob:") }));
  });

  it("shares one authorized signing request across missing objects and deduplicates reused assets", async () => {
    mocks.pageDocs.mockResolvedValue([page("current", "one"), page("second", "two"), page("reused", "one")]);
    mocks.assetUrls.mockResolvedValue(["one", "two"].map((objectHash) => ({ objectHash, signedUrl: `https://signed.example.test/${objectHash}` })));
    const fetcher = vi.fn().mockImplementation(async () => new Response("asset"));
    vi.stubGlobal("fetch", fetcher);
    const { options } = setup();
    await preloadSessionAssets(options);
    expect(mocks.assetUrls).toHaveBeenCalledTimes(1);
    expect(mocks.assetUrls).toHaveBeenCalledWith("session");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const urls = options.onDocUrls.mock.lastCall?.[0];
    expect(urls.current).toBe(urls.reused);
    expect(options.onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2, failed: 0 });
  });

  it("reprioritizes the next free object slot when the teacher changes pages", async () => {
    mocks.pageDocs.mockResolvedValue(Array.from({ length: 7 }, (_, index) => page(`page-${index}`, `image-${index}`)));
    mocks.assetUrls.mockResolvedValue(Array.from({ length: 7 }, (_, index) => ({ objectHash: `image-${index}`, signedUrl: `https://signed.example.test/${index}` })));
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    const fetcher = vi.fn((url: string) => { const read = deferred<Response>(); pending.set(url, read); return read.promise; });
    vi.stubGlobal("fetch", fetcher);
    let active = "page-5";
    const { options } = setup(); options.activeDocId = () => active;
    const run = preloadSessionAssets(options);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(fetcher.mock.calls[0][0]).toBe("https://signed.example.test/5");
    active = "page-6";
    pending.get("https://signed.example.test/0")!.resolve(new Response("zero"));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
    expect(fetcher.mock.calls[4][0]).toBe("https://signed.example.test/6");
    for (const value of pending.values()) value.resolve(new Response("asset"));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(7));
    for (const value of pending.values()) value.resolve(new Response("asset"));
    await run;
  });

  it("keeps cached offline pages usable and reports individual failures without blocking other pages", async () => {
    const pages = [page("current", "cached"), page("missing", "missing")];
    mocks.pageDocs.mockRejectedValue(new Error("offline"));
    mocks.cache.set("cwdocs:session", pages);
    mocks.cache.set("cw:cached", new Blob(["cached"]));
    mocks.assetUrls.mockRejectedValue(new Error("offline"));
    const { options } = setup();
    await preloadSessionAssets(options);
    expect(options.onDocs).toHaveBeenCalledWith(pages);
    expect(options.onDocUrls.mock.lastCall?.[0]).toHaveProperty("current");
    expect(options.onDocUrls.mock.lastCall?.[0]).not.toHaveProperty("missing");
    expect(options.onProgress).toHaveBeenLastCalledWith({ done: 1, total: 2, failed: 1 });
  });

  it("discards a late response after the classroom has been left", async () => {
    const docs = deferred<SessionPageDoc[]>();
    mocks.pageDocs.mockReturnValue(docs.promise);
    const { options, controller } = setup();
    const run = preloadSessionAssets(options);
    controller.abort(); docs.resolve([page("current", "cached")]);
    await run;
    expect(options.onDocUrls).not.toHaveBeenCalled();
    expect(options.onObjectUrl).not.toHaveBeenCalled();
    expect(options.onProgress).not.toHaveBeenCalled();
  });

  it("limits all H5 packages to two unfinished response bodies, including when headers arrive immediately", async () => {
    mocks.pageDocs.mockResolvedValue(Array.from({ length: 5 }, (_, index) => page(`page-${index}`, `package-${index}`, "h5")));
    const bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
    let active = 0, maximum = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("__mathin_manifest")) return new Response(JSON.stringify({ entryPath: "index.html", files: [{ packagePath: "a.bin" }, { packagePath: "b.bin" }] }));
      active += 1; maximum = Math.max(maximum, active);
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { bodies.push(controller); } }));
    });
    vi.stubGlobal("fetch", fetcher);
    const { options } = setup("page-4");
    const run = preloadSessionAssets(options);
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(fetcher.mock.calls.filter(([url]) => url.includes("/api/cw-h5/"))).toHaveLength(2);
    expect(fetcher.mock.calls.find(([url]) => url.includes("/api/cw-h5/"))?.[0]).toContain("package-4");
    for (let index = 0; index < 10; index += 1) {
      await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(index));
      active -= 1; bodies[index].close();
    }
    await run;
    expect(maximum).toBe(2);
    expect(options.onProgress).toHaveBeenLastCalledWith({ done: 0, total: 0, failed: 0 });
  });
});
