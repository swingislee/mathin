import { describe, expect, it } from "vitest";
import { CUBE_COLORS, cubeCutOperation, cubeFrame, cubeLayerOperation, type CubeOperation } from "@/features/tools/spatial-lab/cube-structures-contract";
import { createCubeSession, cubeSessionScene, operateCubeSession, pauseCubeRecording, previewCubeSession, startCubeRecording, undoCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { CUBE_SAVED_DRAFT_MAX_BYTES, CubeDraftError, cubeDraftContentKey, cubeDraftSnapshot, parseCubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";

const initial = () => createCubeSession([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
const roundtrip = (value: unknown) => parseCubeDraftSnapshot(JSON.stringify(value));

describe("versioned account draft snapshots", () => {
  it("round-trips empty and default workspaces without changing their source", () => {
    for (const session of [createCubeSession([]), initial()]) {
      const before = JSON.stringify(session);
      expect(roundtrip(cubeDraftSnapshot(session, 0)).session).toEqual(session);
      expect(JSON.stringify(session)).toBe(before);
    }
  });

  it("preserves accepted tools, groups, logical geometry, undo/redo and independent recording", () => {
    let session = startCubeRecording(initial());
    const operate = (operation: CubeOperation) => { session = operateCubeSession(session, operation); };
    operate({ kind: "group", id: "group-7", name: "第一组", ids: ["cube-1"], color: CUBE_COLORS[1] });
    operate({ kind: "color", ids: ["cube-1"], color: CUBE_COLORS[2] });
    operate({ kind: "paint", faces: [{ id: "cube-2", direction: "y+" }], color: CUBE_COLORS[3] });
    operate({ kind: "mark", ids: ["cube-1"], shape: "circle", placement: "face", direction: "y+", color: CUBE_COLORS[1] });
    operate({ kind: "number", id: "cube-2", placement: "side", direction: "z+", color: CUBE_COLORS[2] });
    operate({ kind: "opacity", ids: ["cube-1"], opacity: 0.3 });
    operate({ kind: "hidden-edges", visible: false });
    operate(cubeLayerOperation(cubeSessionScene(session), "y", 0, false, ["cube-1", "cube-2"]));
    operate({ kind: "show-all" });
    const cut = cubeCutOperation(cubeSessionScene(session), ["cube-1", "cube-2"], "x", 0, 1, 2, "cut-9", "切块");
    expect(cut).not.toBeNull(); operate(cut!);
    operate({ kind: "display-move", ids: ["cube-2"], axis: "y", distance: 0.5 });
    operate({ kind: "view", view: "left", frame: cubeFrame(cubeSessionScene(session).cubes) });
    const recorded = session;
    session = operateCubeSession(pauseCubeRecording(session), { kind: "build", id: "added-12", position: { x: 0, y: 1, z: 0 }, color: CUBE_COLORS[0] });
    const undone = undoCubeSession(session, -1);
    const saved = roundtrip(cubeDraftSnapshot(previewCubeSession(undone, 0), 0));
    expect(saved.session.preview).toBeNull();
    expect(saved.session.recording).toBe("paused");
    expect(saved.identity).toBe(12);
    expect(saved.session.work).toEqual(undone.work);
    expect(saved.session.lesson).toEqual(recorded.lesson);
    expect(cubeSessionScene(undoCubeSession(saved.session, 1))).toEqual(cubeSessionScene(session));
  });

  it("reopens active recording paused and keeps preview/playback out of the dirty key", () => {
    const session = operateCubeSession(startCubeRecording(initial()), { kind: "axes", visible: false });
    const snapshot = cubeDraftSnapshot(session, 4);
    expect(roundtrip(snapshot).session.recording).toBe("paused");
    expect(cubeDraftContentKey(session)).toBe(cubeDraftContentKey(previewCubeSession(session, 0)));
    expect(session.recording).toBe("recording");
  });

  it("rejects unknown versions, oversize data, invalid JSON and extra fields", () => {
    const snapshot = cubeDraftSnapshot(initial(), 0);
    expect(() => roundtrip({ ...snapshot, version: "future" })).toThrow(new CubeDraftError("version"));
    expect(() => parseCubeDraftSnapshot("x".repeat(CUBE_SAVED_DRAFT_MAX_BYTES + 1))).toThrow(new CubeDraftError("too-large"));
    expect(() => parseCubeDraftSnapshot("{" )).toThrow(new CubeDraftError("invalid"));
    expect(() => roundtrip({ ...snapshot, secret: true })).toThrow(new CubeDraftError("invalid"));
  });

  it("rejects broken references, colliding geometry and invalid redo sequences", () => {
    const snapshot = cubeDraftSnapshot(initial(), 0);
    const corrupt = { ...snapshot, session: { ...snapshot.session, work: { ...snapshot.session.work,
      initial: { ...snapshot.session.work.initial, hiddenCubeIds: ["missing"] } } } };
    expect(() => roundtrip(corrupt)).toThrow(new CubeDraftError("invalid"));
    const collision = { ...snapshot, session: { ...snapshot.session, work: { ...snapshot.session.work,
      initial: { ...snapshot.session.work.initial, cubes: snapshot.session.work.initial.cubes.map((cube) => ({ ...cube, position: { x: 0, y: 0, z: 0 } })) } } } };
    expect(() => roundtrip(collision)).toThrow(new CubeDraftError("invalid"));
    const future = { ...snapshot, session: { ...snapshot.session, work: { ...snapshot.session.work, cursor: 0,
      operations: [{ kind: "remove", ids: ["missing"] }] } } };
    expect(() => roundtrip(future)).toThrow(new CubeDraftError("invalid"));
  });

  it("recovers removed and future IDs, rejecting unsafe numeric identities", () => {
    let session = operateCubeSession(initial(), { kind: "build", id: "added-99", position: { x: 0, y: 1, z: 0 }, color: CUBE_COLORS[0] });
    session = operateCubeSession(session, { kind: "remove", ids: ["added-99"] });
    expect(roundtrip(cubeDraftSnapshot(session, 1)).identity).toBe(99);
    const unsafe = operateCubeSession(initial(), { kind: "build", id: "added-99999999999999999999999", position: { x: 0, y: 1, z: 0 }, color: CUBE_COLORS[0] });
    expect(() => roundtrip({ version: "cube-structures-saved-draft-v1", identity: 0, session: unsafe })).toThrow(new CubeDraftError("invalid"));
  });
});
