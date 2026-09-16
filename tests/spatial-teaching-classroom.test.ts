import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { createClassroomToolState, coursewareToolOriginHash, parseClassroomToolState, hasClassroomToolAdapter, classroomToolInstanceKey, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { cubeCoursewareOriginHash, createClassroomToolState as legacyState } from "@/features/tools/courseware/cube-structures-classroom";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { diceLiveSnapshotSchema, netLiveSnapshotSchema, teachingRandom } from "@/features/tools/courseware/workbench-classroom-contract";
import { reduceEvent, type LiveState } from "@/features/classroom/live/liveState";
import { SessionEventLog } from "@/features/classroom/sync/eventlog";
import { createLocalTransport } from "@/features/classroom/sync/transports";
import { emptyStarLedger } from "@/features/classroom/stars";
import type { SessionEvent } from "@/features/classroom/types";
import { buildNet, netTool, diceTool } from "./fixtures/spatial-teaching-content";
import { newId } from "@/lib/uuid";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";

const origin = "a".repeat(64);
const diceSnapshot = () => diceLiveSnapshotSchema.parse({ ...diceTool().payload.initial, xrayTarget: null, observation: { panel: null, face: "y+", pair: "y+" } });
const netSnapshot = async () => netLiveSnapshotSchema.parse({ ...netTool(await buildNet()).payload.initial, judgment: null, galleryOpen: false });
const packet = (update: ClassroomToolUpdate, instance = update.contentVersion) => createClassroomToolState("page", "doc", instance, update, origin);
const event = (seq: number, payload: ReturnType<typeof packet>): SessionEvent => ({ id: `event-${seq}`, sessionId: "session", userId: "teacher", deviceId: "teacher-device", seq, type: "tool_state", payload, at: new Date(0).toISOString() });
function initial(): LiveState {
  return { pages: [{ id: "page", type: "doc", docId: "doc", title: "Lesson" }], currentPage: 0, starLedger: emptyStarLedger(), started: true, ended: false,
    hands: {}, boards: {}, games: {}, video: {}, docSteps: {}, openTool: null, quiz: null, answers: {} };
}

describe("generic classroom tool registry and durable state", () => {
  it("keeps legacy wire/hash compatibility and rejects unregistered versions", () => {
    const snapshot = { session: createCubeSession([{ x: 0, y: 0, z: 0 }]), view: null, cameraRevision: 0 };
    const old = legacyState("page", "doc", "cube", snapshot, origin);
    expect(parseClassroomToolState(old)).toEqual(old);
    const frozen = createCubeCoursewareTool({ name: "Cube", snapshot: cubeDraftSnapshot(snapshot.session, 0) }, "current").payload;
    expect(coursewareToolOriginHash(Object.fromEntries(Object.entries(frozen).reverse()))).toBe(cubeCoursewareOriginHash(frozen));
    expect(hasClassroomToolAdapter(old)).toBe(true);
    expect(hasClassroomToolAdapter({ toolId: "spatial-lab", contentVersion: "future" })).toBe(false);
    expect(parseClassroomToolState({ ...old, contentVersion: "future" })).toBeNull();
  });

  it("validates bounded versioned commands against their saved scene, without physics or render dependencies", async () => {
    const dice = packet({ toolId: "spatial-lab", contentVersion: "dice-lesson-v1", state: { id: "dice-start", snapshot: diceSnapshot(), settles: null,
      motion: { command: { kind: "roll", id: "dice-1", direction: "x+", trail: true }, startedAt: 1000 } } });
    const net = packet({ toolId: "spatial-lab", contentVersion: "cube-net-lesson-v1", state: { id: "net-start", snapshot: await netSnapshot(), settles: null,
      motion: { command: { kind: "unfold" }, startedAt: 1000 } } });
    for (const value of [net, dice]) {
      expect(parseClassroomToolState(JSON.parse(JSON.stringify(value)))).toEqual(value);
      expect(hasClassroomToolAdapter(value)).toBe(true);
      expect(parseClassroomToolState({ ...value, privateDraft: "private" })).toBeNull();
      expect(parseClassroomToolState({ ...value, padding: "中".repeat(180_000) })).toBeNull();
      expect(parseClassroomToolState({ ...value, state: { ...value.state, frames: [] } })).toBeNull();
      expect(parseClassroomToolState({ ...value, state: { ...value.state, settles: "earlier" } })).toBeNull();
    }
    expect(parseClassroomToolState({ ...dice, state: { ...dice.state, motion: { startedAt: 1000, command: { kind: "roll", id: "dice-99", direction: "x+", trail: true } } } })).toBeNull();
    expect(parseClassroomToolState({ ...net, state: { ...net.state, motion: { startedAt: 1000, command: { kind: "fold", edgeId: "foreign", degrees: 30, anchor: null } } } })).toBeNull();
    expect(parseClassroomToolState({ ...net, state: { ...net.state, motion: { startedAt: 1000, command: { kind: "unfold-cuts" } } } })).toBeNull();
    const randomA = teachingRandom(42), randomB = teachingRandom(42);
    expect(Array.from({ length: 100 }, () => randomA())).toEqual(Array.from({ length: 100 }, () => randomB()));
  });

  it("isolates net and dice instances and changed frozen origins, with monotonic replay after reconnect", async () => {
    const one = packet({ toolId: "spatial-lab", contentVersion: "dice-lesson-v1", state: { id: "dice-final", snapshot: diceSnapshot(), settles: "dice-start", motion: null } });
    const two = packet({ toolId: "spatial-lab", contentVersion: "cube-net-lesson-v1", state: { id: "net-final", snapshot: await netSnapshot(), settles: "net-start", motion: null } });
    const changes = [event(3, one), event(4, two), event(5, { ...one, originHash: "b".repeat(64) })];
    const state = changes.reduce(reduceEvent, initial());
    expect(Object.keys(state.tools!.page)).toHaveLength(3);
    expect([...changes].reverse().reduce(reduceEvent, initial()).tools).toEqual(state.tools);
    expect(reduceEvent(state, changes[0])).toBe(state);
    expect(reduceEvent(state, event(8, { ...one, docId: "other-doc" }))).toBe(state);
    expect(state.tools!.page[classroomToolInstanceKey("doc", one.instanceId, origin)].payload).toEqual(one);
  });

  it("recovers each tool's latest command or final state through the same account outbox and late-window resync", async () => {
    const dice = packet({ toolId: "spatial-lab", contentVersion: "dice-lesson-v1", state: { id: "dice-start", snapshot: diceSnapshot(), settles: null,
      motion: { startedAt: 1000, command: { kind: "xray", target: { id: "dice-1", face: "y+" } } } } });
    const net = packet({ toolId: "spatial-lab", contentVersion: "cube-net-lesson-v1", state: { id: "net-start", snapshot: await netSnapshot(), settles: null,
      motion: { startedAt: 1000, command: { kind: "unfold" } } } });
    const sessionId = newId(), userId = newId(), first = await SessionEventLog.create(sessionId, userId);
    const received: SessionEvent[] = [];
    const receiver = createLocalTransport(sessionId, (value) => received.push(value));
    let restored: SessionEventLog | undefined;
    try {
      const a = await first.append("tool_state", dice), b = await first.append("tool_state", net);
      restored = await SessionEventLog.create(sessionId, userId);
      expect(restored.recoveredToolEvents).toEqual([a, b]);
      restored.rememberToolStates([b, a]);
      restored.attach(createLocalTransport(sessionId, () => {})); restored.rebroadcastToolStates();
      await vi.waitFor(() => expect(received).toHaveLength(2));
      expect(received.map((value) => value.payload.contentVersion).sort()).toEqual(["cube-net-lesson-v1", "dice-lesson-v1"]);
      expect(restored.latestToolEvents).toHaveLength(2);
    } finally { receiver?.close(); first.close(); restored?.close(); }
  });
});
