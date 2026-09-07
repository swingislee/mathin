import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionH5, addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { classroomToolInstanceKey, cubeCoursewareOriginHash, createClassroomToolState, cubeCoursewareInitialSession, parseClassroomToolState, type CubeClassroomSnapshot } from "@/features/tools/courseware/cube-structures-classroom";
import { createCubeSession, cubeSessionScene, operateCubeSession, previewCubeSession, startCubeRecording, pauseCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { cubeDraftIdentity, cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { CUBE_COLORS } from "@/features/tools/spatial-lab/cube-structures-contract";
import { reduceEvent, type LiveState } from "@/features/classroom/live/liveState";
import { emptyStarLedger } from "@/features/classroom/stars";
import { resolveClassroomInteractionAudit } from "@/features/classroom/sync/interaction-audit";
import { resolveClassroomRendererInputProfile } from "@/features/classroom/input/capabilities";
import { SessionEventLog } from "@/features/classroom/sync/eventlog";
import { createLocalTransport } from "@/features/classroom/sync/transports";
import { sessionEventBatches } from "@/features/classroom/sync/flush";
import { idbListByIndex, STORE_OUTBOX } from "@/features/classroom/sync/idb";
import * as storage from "@/features/classroom/sync/idb";
import type { SessionEvent } from "@/features/classroom/types";

const snapshot = (): CubeClassroomSnapshot => ({ session: createCubeSession([{ x: 0, y: 0, z: 0 }]), view: null, cameraRevision: 0 });
const originHash = "a".repeat(64);
const key = (instanceId = "cube-1", hash = originHash) => classroomToolInstanceKey("doc-1", instanceId, hash);
const payload = () => createClassroomToolState("page-1", "doc-1", "cube-1", snapshot(), originHash);
const event = (seq = 1, state = payload()): SessionEvent => ({ id: `event-${seq}`, sessionId: "session-1", userId: "teacher-1", deviceId: "writer-1", seq,
  type: "tool_state", payload: state, at: "2026-09-08T00:00:00Z" });
function initial(): LiveState {
  return { pages: [{ id: "page-1", type: "doc", docId: "doc-1", title: "One" }, { id: "page-2", type: "doc", docId: "doc-2", title: "Two" }],
    currentPage: 0, starLedger: emptyStarLedger(), started: true, ended: false, hands: {}, boards: {}, games: {},
    video: {}, docSteps: {}, openTool: null, quiz: null, answers: {} };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("versioned cube classroom state", () => {
  it("round trips model edits, recording, undo history, playback cursor and preset camera", () => {
    let session = startCubeRecording(snapshot().session);
    session = operateCubeSession(session, { kind: "build", id: "added-41", position: { x: 1, y: 0, z: 0 }, color: CUBE_COLORS[0] });
    session = operateCubeSession(session, { kind: "opacity", ids: ["added-41"], opacity: 0.3 });
    const active = createClassroomToolState("page-1", "doc-1", "cube-1", { session, view: "left", cameraRevision: 3 }, originHash);
    const restored = parseClassroomToolState(JSON.parse(JSON.stringify(active)))!;
    expect(restored.state).toEqual(active.state);
    expect(cubeDraftIdentity(restored.state.session)).toBe(41);
    expect(cubeSessionScene(undoCubeSession(restored.state.session, -1)).cubes[1].opacity).toBeUndefined();
    const playing = previewCubeSession(pauseCubeRecording(session), 1);
    expect(parseClassroomToolState({ ...active, state: { ...active.state, session: playing } })?.state.session.preview).toBe(1);
    expect(cubeSessionScene(playing).cubes).toHaveLength(2);
  });

  it("rejects malformed versions, private pointers, invalid references, impossible cursors and oversized states", () => {
    const good = payload();
    expect(parseClassroomToolState({ ...good, version: 2 })).toBeNull();
    expect(parseClassroomToolState({ ...good, draftId: "private-account-draft" })).toBeNull();
    expect(parseClassroomToolState({ ...good, instanceId: "__proto__" })).toBeNull();
    expect(parseClassroomToolState({ ...good, state: { ...good.state, cameraRevision: -1 } })).toBeNull();
    for (const invalid of [{ preview: 1 }, { recording: "recording" }]) {
      expect(parseClassroomToolState({ ...good, state: { ...good.state, session: { ...good.state.session, ...invalid } } })).toBeNull();
    }
    const corrupt = structuredClone(good);
    corrupt.state.session.work.initial.hiddenCubeIds.push("missing");
    expect(parseClassroomToolState(corrupt)).toBeNull();
    expect(parseClassroomToolState({ ...good, padding: "中".repeat(180_000) })).toBeNull();
    expect(() => createClassroomToolState("bad/id", "doc-1", "cube-1", snapshot(), originHash)).toThrow();
  });

  it("isolates pages and instances, ignores stale writers and validates the frozen document identity", () => {
    const last = payload(); last.state.cameraRevision = 4;
    const start = reduceEvent(initial(), event(4, last));
    expect(reduceEvent(start, event(2))).toBe(start);
    expect(reduceEvent(start, event(4))).toBe(start);
    expect(reduceEvent(start, event(5, { ...last, docId: "another-revision" }))).toBe(start);
    expect(reduceEvent(start, event(5, { ...last, pageId: "missing-page" }))).toBe(start);
    const next = reduceEvent(start, event(5, { ...last, instanceId: "cube-2" }));
    const otherPage = reduceEvent(next, event(6, { ...last, pageId: "page-2", docId: "doc-2" }));
    expect(Object.keys(otherPage.tools!)).toEqual(["page-1", "page-2"]);
    expect(Object.keys(otherPage.tools!["page-1"])).toEqual([key(), key("cube-2")]);
    const newWriter = reduceEvent(otherPage, { ...event(1), deviceId: "writer-2" });
    expect(reduceEvent(newWriter, event(3))).toBe(newWriter);
  });

  it("restores the same final frame from reordered durable snapshots and original courseware stays fixed", () => {
    const initialSnapshot = snapshot();
    const edited = { ...initialSnapshot, session: operateCubeSession(initialSnapshot.session, { kind: "axes", visible: false }) };
    const events = [event(1), event(2, createClassroomToolState("page-1", "doc-1", "cube-1", edited, originHash))];
    expect([...events].reverse().reduce(reduceEvent, initial()).tools).toEqual(events.reduce(reduceEvent, initial()).tools);
    expect(cubeSessionScene(initialSnapshot.session).axesVisible).toBe(true);
  });

  it("enables only v2 cube instances alongside read-only H5 and legacy tools", () => {
    const tool = createCubeCoursewareTool({ name: "Cube", snapshot: cubeDraftSnapshot(snapshot().session, 0) }, "current");
    let doc = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), { toolId: "fraction-line", contentVersion: "tool-embed-v1" });
    doc = addCoursewareCompositionH5(doc, { artifactId: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64), byteCount: 1, entryPath: "index.html" });
    doc = addCoursewareCompositionTool(doc, tool);
    expect(resolveClassroomInteractionAudit(doc)).toMatchObject({ status: "synchronized", provider: { protocol: "tool-state-v1", eventType: "tool_state" } });
    expect(resolveClassroomRendererInputProfile(initial().pages[0], null, doc)).toMatchObject({ renderer: "document:composition:tools" });
    expect(cubeCoursewareInitialSession(tool.payload).work.initial).toEqual(tool.payload.history.initial);
    expect(cubeCoursewareInitialSession(tool.payload).preview).toBeNull();
  });

  it("uses a canonical source digest so old classroom states cannot replace a changed courseware copy", () => {
    const tool = createCubeCoursewareTool({ name: "Cube", snapshot: cubeDraftSnapshot(snapshot().session, 0) }, "current");
    const firstHash = cubeCoursewareOriginHash(tool.payload);
    const reordered = Object.fromEntries(Object.entries(tool.payload).reverse()) as typeof tool.payload;
    expect(cubeCoursewareOriginHash(reordered)).toBe(firstHash);
    const nextHash = cubeCoursewareOriginHash({ ...tool.payload, toolbar: [] });
    expect(nextHash).not.toBe(firstHash);
    let state = reduceEvent(initial(), event(1, { ...payload(), originHash: nextHash }));
    state = reduceEvent(state, event(2, { ...payload(), originHash: firstHash }));
    expect(state.tools!["page-1"][key("cube-1", nextHash)].payload.originHash).toBe(nextHash);
    expect(Object.keys(state.tools!["page-1"])).toHaveLength(2);
  });
});

describe("durable cube delivery", () => {
  it("writes before echo, recovers the current account outbox, and replays to a late same-device window without duplicating records", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const sessionId = crypto.randomUUID(), userId = crypto.randomUUID();
    const log = await SessionEventLog.create(sessionId, userId);
    const echoes: SessionEvent[] = [];
    log.subscribe((ev) => echoes.push(ev));
    const one = await log.append("tool_state", payload());
    const two = await log.append("tool_state", { ...payload(), state: { ...snapshot(), view: "top", cameraRevision: 2 } });
    expect(echoes).toEqual([one, two]);
    expect(await idbListByIndex(STORE_OUTBOX, "sessionId", sessionId)).toHaveLength(2);
    const restored = await SessionEventLog.create(sessionId, userId);
    expect(restored.recoveredToolEvents).toEqual([one, two]);
    expect((await SessionEventLog.create(sessionId, crypto.randomUUID())).recoveredToolEvents).toEqual([]);
    const rehearsal = await SessionEventLog.create(sessionId, userId, { ephemeral: true });
    await rehearsal.append("tool_state", payload());
    expect(rehearsal.recoveredToolEvents).toEqual([]);
    expect(await idbListByIndex(STORE_OUTBOX, "sessionId", sessionId)).toHaveLength(2);

    restored.rememberToolStates([two, one]);
    let resolve!: (value: SessionEvent) => void;
    const received = new Promise<SessionEvent>((done) => { resolve = done; });
    const receiver = createLocalTransport(sessionId, resolve);
    restored.attach(createLocalTransport(sessionId, () => {}));
    restored.rebroadcastToolStates();
    await expect(received).resolves.toEqual(two);
    expect(await idbListByIndex(STORE_OUTBOX, "sessionId", sessionId)).toHaveLength(2);
    const foreign = { ...two, id: "foreign", sessionId: "wrong-session" };
    restored.subscribe((ev) => echoes.push(ev)); restored.ingest(foreign);
    expect(echoes).toHaveLength(2);
    receiver?.close(); restored.close(); log.close(); rehearsal.close();
  });

  it("splits persistence batches by bytes as well as row count, retaining event identities", () => {
    const large = new Array(5).fill(null).map((_, index) => ({ ...event(index + 1), payload: { data: "中".repeat(150_000) } }));
    const batches = sessionEventBatches(large);
    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(batches.flat()).toEqual(large);
    expect(sessionEventBatches(new Array(201).fill(event())).map((batch) => batch.length)).toEqual([100, 100, 1]);
  });

  it("reapplies a snapshot received before student pages arrive and retains saved state if one transport or metadata write fails", async () => {
    const sessionId = crypto.randomUUID();
    const log = await SessionEventLog.create(sessionId, crypto.randomUUID());
    let state = { ...initial(), pages: [] } as LiveState;
    log.subscribe((ev) => { state = reduceEvent(state, ev); });
    const send = vi.fn();
    log.attach({ kind: "local", send: () => { throw new Error("channel closed"); }, sendFx() {}, close() {} });
    log.attach({ kind: "p2p", send, sendFx() {}, close() {} });
    const realPut = storage.idbPut;
    vi.spyOn(storage, "idbPut").mockImplementation((store, key, value) => store === storage.STORE_META
      ? Promise.reject(new Error("metadata quota")) : realPut(store, key, value));
    await expect(log.append("tool_state", payload())).resolves.toMatchObject({ type: "tool_state" });
    expect(state.tools).toBeUndefined();
    state = log.latestToolEvents.reduce(reduceEvent, { ...state, pages: initial().pages });
    expect(state.tools?.["page-1"]?.[key()].payload).toEqual(payload());
    expect(send).toHaveBeenCalledTimes(1);
    log.close();
  });
});
