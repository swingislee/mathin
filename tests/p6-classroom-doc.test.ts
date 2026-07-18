import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInteractionRuntime } from "../src/features/courseware-doc/interactions";
import type { PageDoc } from "../src/features/courseware-doc/schema";
import { reduceEvent, type LiveState } from "../src/features/classroom/live/liveState";
import type { SessionEvent } from "../src/features/classroom/types";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

const { getSessionPageDocs } = await import("@/features/classroom/courseware/session-assets");
const { buildDocBindingUrls, collectDocObjectHashes, collectH5PackageHashes, countH5Pages } =
  await import("@/features/classroom/courseware/doc-preload");

const HASH_IMG = "a".repeat(64);
const HASH_AUDIO = "b".repeat(64);
const HASH_H5 = "c".repeat(64);

const minimalDoc: PageDoc = {
  docVersion: "page-doc-v1",
  sourceCoursewareId: "5518",
  sourcePageId: null,
  sourcePageDatabaseId: 1,
  sourceSnapshotId: 1,
  sourceContentHash: "d".repeat(64),
  canvas: { width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: null },
  nodes: [],
  interactions: [],
};

function sessionPage(bindings: Array<{ bindingKey: string; objectHash: string; kind: string; launchQuery?: { query: Record<string, string[]>; coursewareIdParam: string | null } | null }>) {
  return {
    pageDocId: crypto.randomUUID(),
    pageNo: 1,
    doc: minimalDoc,
    bindings: bindings.map((binding) => ({ launchQuery: null, ...binding })),
  };
}

describe("P6-5 doc preload assembly", () => {
  const pages = [
    sessionPage([
      { bindingKey: "1".repeat(64), objectHash: HASH_IMG, kind: "image" },
      { bindingKey: "2".repeat(64), objectHash: HASH_AUDIO, kind: "audio" },
    ]),
    sessionPage([
      {
        bindingKey: "3".repeat(64),
        objectHash: HASH_H5,
        kind: "h5",
        launchQuery: { query: { coursewareId: ["5518"] }, coursewareIdParam: "5518" },
      },
      // 同对象跨页复用：去重后只预载一次
      { bindingKey: "4".repeat(64), objectHash: HASH_IMG, kind: "image" },
    ]),
  ];

  it("deduplicates blob objects and splits H5 packages out of the preload list", () => {
    expect(collectDocObjectHashes(pages).sort()).toEqual([HASH_IMG, HASH_AUDIO].sort());
    expect(collectH5PackageHashes(pages)).toEqual([HASH_H5]);
    expect(countH5Pages(pages)).toBe(1);
  });

  it("maps non-H5 bindings to blob URLs and H5 bindings to shim entry URLs with launch query", () => {
    const urls = buildDocBindingUrls(
      pages,
      new Map([[HASH_IMG, "blob:img"], [HASH_AUDIO, "blob:audio"]]),
      new Map([[HASH_H5, "index.html"]]),
    );
    expect(urls["1".repeat(64)]).toBe("blob:img");
    expect(urls["2".repeat(64)]).toBe("blob:audio");
    expect(urls["4".repeat(64)]).toBe("blob:img");
    // 漏拼 launch query 会全部打开第一关(doc 16 P6-1 发现②)
    expect(urls["3".repeat(64)]).toBe(`/api/cw-h5/packages/${HASH_H5}/index.html?coursewareId=5518`);
  });

  it("omits bindings whose object blob or manifest is unavailable (renderer shows a visible fallback)", () => {
    const urls = buildDocBindingUrls(pages, new Map(), new Map());
    expect(Object.keys(urls)).toHaveLength(0);
  });
});

describe("P6-5 getSessionPageDocs action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed session ids before querying", async () => {
    await expect(getSessionPageDocs("not-a-uuid")).rejects.toThrow("VALIDATION");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } });
    await expect(getSessionPageDocs(crypto.randomUUID())).rejects.toThrow("UNAUTHENTICATED");
  });

  it("parses RPC rows through the frozen page-doc schema and binding schema", async () => {
    const pageDocId = crypto.randomUUID();
    const returns = vi.fn().mockResolvedValue({
      data: [{
        page_doc_id: pageDocId,
        page_no: 3,
        doc: minimalDoc,
        bindings: [{ bindingKey: "1".repeat(64), objectHash: HASH_IMG, kind: "image", launchQuery: null }],
      }],
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ returns });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: crypto.randomUUID() } } }) },
      rpc,
    });

    const result = await getSessionPageDocs(crypto.randomUUID());
    expect(rpc).toHaveBeenCalledWith("get_session_page_docs", expect.anything());
    expect(result).toHaveLength(1);
    expect(result[0].pageDocId).toBe(pageDocId);
    expect(result[0].doc.canvas.width).toBe(1280);
  });

  it("fails loudly when a doc does not match the frozen schema", async () => {
    const returns = vi.fn().mockResolvedValue({
      data: [{ page_doc_id: crypto.randomUUID(), page_no: 1, doc: { docVersion: "page-doc-v2" }, bindings: [] }],
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: crypto.randomUUID() } } }) },
      rpc: vi.fn().mockReturnValue({ returns }),
    });
    await expect(getSessionPageDocs(crypto.randomUUID())).rejects.toThrow();
  });
});

function docStepEvent(payload: Record<string, unknown>): SessionEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: "s",
    userId: "teacher",
    deviceId: "d",
    seq: 1,
    type: "doc_step",
    payload,
    at: new Date().toISOString(),
  };
}

const emptyState: LiveState = {
  pages: [],
  currentPage: 0,
  stars: {},
  started: true,
  ended: false,
  hands: {},
  boards: {},
  games: {},
  video: {},
  docSteps: {},
  openTool: null,
  quiz: null,
  answers: {},
};

describe("P6-5 doc_step event reduction", () => {
  it("appends ordered steps per page for both scopes", () => {
    let state = reduceEvent(emptyState, docStepEvent({ pageId: "p1", scope: "page", id: null }));
    state = reduceEvent(state, docStepEvent({ pageId: "p1", scope: "node", id: "r7" }));
    state = reduceEvent(state, docStepEvent({ pageId: "p2", scope: "page", id: null }));
    expect(state.docSteps["p1"]).toEqual([
      { scope: "page", id: null },
      { scope: "node", id: "r7" },
    ]);
    expect(state.docSteps["p2"]).toEqual([{ scope: "page", id: null }]);
  });

  it("drops malformed doc_step payloads", () => {
    expect(reduceEvent(emptyState, docStepEvent({ scope: "page" })).docSteps).toEqual({});
    expect(reduceEvent(emptyState, docStepEvent({ pageId: "p1", scope: "node" })).docSteps).toEqual({});
  });
});

describe("P6-5 interaction click relay", () => {
  interface StubNode {
    dataset: { sourceResourceId: string };
    style: { display: string; transform: string };
  }
  const stubStage = (nodes: StubNode[]) => ({ querySelectorAll: () => nodes }) as unknown as ParentNode;

  it("handleStageClick reports the executed trigger and runClick replays it remotely", async () => {
    const makeTarget = (): StubNode => ({ dataset: { sourceResourceId: "r2" }, style: { display: "none", transform: "" } });
    const interactions = [{
      trigger: "click" as const,
      triggerScope: "page" as const,
      triggerResourceId: null,
      targetResourceId: "r2",
      action: "enter" as const,
      animation: "fadeIn",
      delay: 0,
      duration: 0,
      loop: 0,
      path: null,
      audioBindingKey: null,
      audioName: null,
      step: 1,
    }];

    const teacherTarget = makeTarget();
    const teacher = createInteractionRuntime({ root: stubStage([teacherTarget]), interactions, resolveAudioUrl: () => null });
    const trigger = await teacher.handleStageClick(null);
    expect(trigger).toEqual({ scope: "page", id: null });
    expect(teacherTarget.style.display).toBe("block");

    // 学生端按教师广播的描述回放,收敛到同一舞台状态
    const studentTarget = makeTarget();
    const student = createInteractionRuntime({ root: stubStage([studentTarget]), interactions, resolveAudioUrl: () => null });
    await expect(student.runClick(trigger!.scope, trigger!.id)).resolves.toBe(true);
    expect(studentTarget.style.display).toBe("block");
  });

  it("returns null when a click triggers nothing", async () => {
    const runtime = createInteractionRuntime({ root: stubStage([]), interactions: [], resolveAudioUrl: () => null });
    await expect(runtime.handleStageClick(null)).resolves.toBeNull();
  });
});
