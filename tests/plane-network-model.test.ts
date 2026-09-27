import { describe, expect, it } from "vitest";
import type { PlanarState } from "../src/features/tools/planar-kit/contract";
import { addNetworkMaterial, addNetworkPoint, addNetworkSegment, appendNetworkVisit, clearNetworkRecords, createNetworkState, dragNetworkTarget, liftNetworkPen, moveNetworkTarget, networkCoveredNodes, networkFigureValid, networkGraph, networkPicks, networkRecords, recordNetworkFigure, removeNetworkTarget, setNetworkField, setNetworkFlag, tapNetworkTarget } from "../src/features/tools/plane-network/model";
import { isValidPlaneNetworkState } from "../src/features/tools/plane-network/validation";
import { planeNetworkScenes } from "../src/features/tools/plane-network/scenes";

const blank = (scene: "47-create" | "52-create" = "47-create"): PlanarState => {
  const state = createNetworkState(scene);
  return { ...state, params: Object.fromEntries(Object.entries(state.params).filter(([key]) => !/^[ab]\./.test(key))), points: {} };
};
const nodeAt = (state: PlanarState, x: number, y: number) => networkGraph(state).nodes.find((point) => Math.abs(point.x - x) < 1e-5 && Math.abs(point.y - y) < 1e-5)!.id;
const segment = (state: PlanarState, ax: number, ay: number, bx: number, by: number) => addNetworkSegment(state, { x: ax, y: ay }, { x: bx, y: by });
const square = (scene: "47-create" | "52-create" = "47-create") => [[100, 100, 300, 100], [300, 100, 300, 300], [300, 300, 100, 300], [100, 300, 100, 100]].reduce((state, [ax, ay, bx, by]) => segment(state, ax, ay, bx, by), blank(scene));

describe("editable planar network geometry", () => {
  it.each(["47-create", "52-create"] as const)("starts with only one real segment for %s", (scene) => {
    const state = createNetworkState(scene);
    expect(isValidPlaneNetworkState(state)).toBe(true);
    expect(networkGraph(state).nodes).toHaveLength(2);
    expect(networkGraph(state).edges).toHaveLength(1);
    expect(state.flags.names).toBe(false); expect(state.flags.degrees).toBe(false);
  });
  it("creates a selectable crossing and splits both edges", () => {
    const state = segment(createNetworkState("47-create"), 440, 200, 440, 500), graph = networkGraph(state);
    expect(graph.nodes).toHaveLength(5); expect(graph.edges).toHaveLength(4);
    const crossing = nodeAt(state, 440, 360);
    expect(graph.edges.filter((edge) => edge.a === crossing || edge.b === crossing)).toHaveLength(4);
    expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("splits an existing edge when a point is added to its interior", () => {
    const state = addNetworkPoint(createNetworkState("47-create"), { x: 400, y: 360 });
    expect(networkGraph(state).edges).toHaveLength(2); expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("normalizes collinear overlap without duplicate lines", () => {
    const state = segment(createNetworkState("47-create"), 400, 360, 700, 360), graph = networkGraph(state);
    expect(graph.nodes).toHaveLength(4); expect(graph.edges).toHaveLength(3);
    expect(networkCoveredNodes(graph, 0, nodeAt(state, 700, 360))).toHaveLength(4);
    expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("welds a moved node to an existing node and keeps stable surviving ids", () => {
    let state = addNetworkPoint(createNetworkState("47-create"), { x: 280, y: 100 });
    const id = nodeAt(state, 280, 100);
    state = setNetworkFlag(state, "edit", true);
    state = moveNetworkTarget(state, `node.${id}`, { x: 0, y: 260 });
    expect(state.points[`node.${id}`]).toBeUndefined(); expect(state.points["node.0"]).toEqual({ x: 280, y: 360 });
    expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("moving an edge moves both endpoints and preserves connected edges", () => {
    let state = square();
    state = setNetworkFlag(state, "edit", true);
    const edge = networkGraph(state).edges[0], a = state.points[`node.${edge.a}`];
    state = moveNetworkTarget(state, `edge.${edge.id}`, { x: 20, y: -30 });
    expect(state.points[`node.${edge.a}`]).toEqual({ x: a.x + 20, y: a.y - 30 });
    expect(networkGraph(state).edges).toHaveLength(4); expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it.each(["segment", "rays", "triangle", "grid"] as const)("%s material appends without replacing the first segment", (material) => {
    const before = createNetworkState("47-create"), after = addNetworkMaterial(before, material);
    expect(after.points["node.0"]).toEqual(before.points["node.0"]);
    expect(networkGraph(after).nodes.length).toBeGreaterThan(2);
    expect(networkCoveredNodes(networkGraph(after), 0, 1)).not.toBeNull();
    expect(isValidPlaneNetworkState(after)).toBe(true);
  });
  it("honors the 96-node budget atomically", () => {
    let state = blank();
    for (let i = 0; i < 96; i++) state = addNetworkPoint(state, { x: 10 + i * 10, y: 50 });
    expect(networkGraph(state).nodes).toHaveLength(96);
    expect(addNetworkPoint(state, { x: 90, y: 200 })).toBe(state);
    expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("rejects an edge-budget overflow without leaving a dangling active id", () => {
    let state = blank();
    for (let row = 0; row < 12; row++) {
      const y = 30 + row * 40;
      state = segment(state, 30, y, 120, y); state = segment(state, 120, y, 210, y); state = segment(state, 210, y, 30, y + 15);
    }
    let seed = 12345;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let index = 0; index < 100; index++) {
      const next = segment(state, 20 + random() * 780, 20 + random() * 600, 20 + random() * 780, 20 + random() * 600);
      expect(isValidPlaneNetworkState(next), `operation ${index}`).toBe(true);
      expect(networkGraph(next).edges.length).toBeLessThanOrEqual(96); state = next;
    }
  });
  it("does not move nodes during normal observation", () => {
    const state = createNetworkState("47-create");
    expect(moveNetworkTarget(state, "node.0", { x: 100, y: 100 })).toBe(state);
  });
  it("deleting every node leaves a valid reusable empty stage", () => {
    let state = createNetworkState("47-create");
    state = removeNetworkTarget(state, "node.0"); state = removeNetworkTarget(state, "node.1");
    expect(networkGraph(state).nodes).toHaveLength(0); expect(isValidPlaneNetworkState(state)).toBe(true);
    expect(isValidPlaneNetworkState(addNetworkMaterial(state, "grid"))).toBe(true);
  });
});

describe("teacher-selected counting records", () => {
  it("records a whole segment across intermediate nodes", () => {
    let state = addNetworkPoint(createNetworkState("47-create"), { x: 400, y: 360 });
    state = tapNetworkTarget(tapNetworkTarget(state, "node.0"), "node.1");
    state = recordNetworkFigure(state);
    expect(networkRecords(state)).toEqual([{ kind: "segment", id: 1, nodes: [0, 1] }]);
    expect(networkPicks(state)).toEqual([]); expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("distinguishes a two-arm angle from a three-vertex polygon", () => {
    let state = segment(createNetworkState("47-create"), 280, 360, 300, 160);
    state = setNetworkField(state, "figureMode", 1);
    for (const id of [1, 0, nodeAt(state, 300, 160)]) state = tapNetworkTarget(state, `node.${id}`);
    state = recordNetworkFigure(state);
    expect(networkRecords(state)[0].kind).toBe("angle"); expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("treats near and far endpoints on the same directed rays as one angle", () => {
    let state = addNetworkPoint(createNetworkState("47-create"), { x: 440, y: 360 });
    state = segment(state, 280, 360, 280, 160); state = setNetworkField(state, "figureMode", 1);
    for (const id of [3, 0, 2]) state = tapNetworkTarget(state, `node.${id}`);
    state = recordNetworkFigure(state);
    for (const id of [1, 0, 3]) state = tapNetworkTarget(state, `node.${id}`);
    state = recordNetworkFigure(state);
    expect(networkRecords(state)).toHaveLength(1); expect(isValidPlaneNetworkState(state)).toBe(true);
    const forged = { ...state, params: { ...state.params, nextRecord: 3 }, marks: [...state.marks, "angle.2.0.3", "angle.2.1.0", "angle.2.2.1"] };
    expect(isValidPlaneNetworkState(forged)).toBe(false);
    expect(networkFigureValid(networkGraph(state), "angle", [1, 0, 2])).toBe(false);
    expect(networkFigureValid(networkGraph(state), "angle", [0, 2, 1])).toBe(true);
  });
  it("records arbitrary simple closed polygons, not only preset triangles", () => {
    let state = square(); state = setNetworkField(state, "figureMode", 2);
    for (const point of [[100, 100], [300, 100], [300, 300], [100, 300]]) state = tapNetworkTarget(state, `node.${nodeAt(state, ...point as [number, number])}`);
    state = recordNetworkFigure(state);
    expect(networkRecords(state)[0].nodes).toHaveLength(4); expect(isValidPlaneNetworkState(state)).toBe(true);
    const before = state;
    for (const node of [...networkRecords(state)[0].nodes].reverse()) state = tapNetworkTarget(state, `node.${node}`);
    state = recordNetworkFigure(state);
    expect(networkRecords(state)).toEqual(networkRecords(before));
  });
  it("rejects missing boundary edges and clears records after a required edge is deleted", () => {
    let state = createNetworkState("47-create"); state = recordNetworkFigure(tapNetworkTarget(tapNetworkTarget(state, "node.0"), "node.1"));
    state = removeNetworkTarget(state, "edge.0");
    expect(networkRecords(state)).toEqual([]); expect(networkFigureValid(networkGraph(state), "segment", [0, 1])).toBe(false);
    expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("preserves completed records when new intersections keep the whole boundary", () => {
    let state = createNetworkState("47-create"); state = recordNetworkFigure(tapNetworkTarget(tapNetworkTarget(state, "node.0"), "node.1"));
    state = segment(state, 440, 200, 440, 500);
    expect(networkRecords(state)).toHaveLength(1); expect(isValidPlaneNetworkState(state)).toBe(true);
  });
});

describe("real network paths and replay", () => {
  it("walks only connected nodes, can lift and begin elsewhere", () => {
    let state = createNetworkState("52-create"); state = addNetworkPoint(state, { x: 200, y: 200 });
    state = appendNetworkVisit(appendNetworkVisit(state, 0), 1);
    expect(appendNetworkVisit(state, nodeAt(state, 200, 200))).toBe(state);
    state = appendNetworkVisit(liftNetworkPen(state), nodeAt(state, 200, 200));
    expect(networkRecords(state)).toHaveLength(2); expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("does not repeat an edge unless enabled and cleans repeated traces on disabling", () => {
    let state = appendNetworkVisit(appendNetworkVisit(createNetworkState("52-create"), 0), 1);
    expect(appendNetworkVisit(state, 0)).toBe(state);
    state = appendNetworkVisit(setNetworkFlag(state, "repeat", true), 0);
    expect(networkRecords(state)[0].nodes).toEqual([0, 1, 0]);
    state = setNetworkFlag(state, "repeat", false);
    expect(networkRecords(state)[0].nodes).toEqual([0, 1]); expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("rewrites previous direct visits into real split edges at new crossings", () => {
    let state = appendNetworkVisit(appendNetworkVisit(createNetworkState("52-create"), 0), 1);
    state = segment(state, 440, 200, 440, 500);
    expect(networkRecords(state)[0].nodes).toEqual([0, nodeAt(state, 440, 360), 1]);
    expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("a single drag traverses all real intermediate nodes on the same straight line", () => {
    const start = addNetworkPoint(createNetworkState("52-create"), { x: 440, y: 360 });
    const traced = dragNetworkTarget(start, "node.0", { x: 600, y: 360 }, { x: 320, y: 0 });
    expect(networkRecords(traced)[0].nodes).toEqual([0, 2, 1]); expect(isValidPlaneNetworkState(traced)).toBe(true);
    expect(appendNetworkVisit(traced, 0)).toBe(traced);
    const bent = setNetworkFlag(square("52-create"), "edit", false), a = nodeAt(bent, 100, 100), diagonal = nodeAt(bent, 300, 300);
    const begun = appendNetworkVisit(bent, a);
    expect(appendNetworkVisit(begun, diagonal)).toBe(begun);
  });
  it("trims a disconnected path without inventing a route", () => {
    let state = appendNetworkVisit(appendNetworkVisit(createNetworkState("52-create"), 0), 1);
    state = removeNetworkTarget(state, "edge.0");
    expect(networkRecords(state)[0].nodes).toEqual([0]); expect(isValidPlaneNetworkState(state)).toBe(true);
  });
  it("supports direct tracing and produces visible intermediate replay frames", () => {
    const start = createNetworkState("52-create");
    const traced = dragNetworkTarget(start, "node.0", { x: 600, y: 360 }, { x: 320, y: 0 });
    expect(networkRecords(traced)[0].nodes).toEqual([0, 1]);
    const action = planeNetworkScenes[1].actions!.find((item) => item.id === "network-replay")!;
    const end = action.run(traced, { selected: null });
    expect(action.interpolate!(traced, end, 0.5).phase).toBe(0.5);
    expect(isValidPlaneNetworkState(end)).toBe(true);
    expect(clearNetworkRecords(end).points).toEqual(end.points);
  });
});

describe("strict persisted network contract", () => {
  const reject = (mutate: (state: PlanarState) => void) => { const state = structuredClone(createNetworkState("47-create")); mutate(state); expect(isValidPlaneNetworkState(state)).toBe(false); };
  it("rejects unknown keys and missing required parameters", () => {
    reject((state) => { state.params.surprise = 1; }); reject((state) => { delete state.params.nextNode; }); reject((state) => { state.flags.surprise = true; }); reject((state) => { state.points["node.00"] = { x: 1, y: 2 }; });
  });
  it("rejects duplicate, zero-length, dangling and stale-id edges", () => {
    reject((state) => { state.params["a.1"] = 0; state.params["b.1"] = 1; state.params.nextEdge = 2; });
    reject((state) => { state.params["b.0"] = 0; }); reject((state) => { state.params["b.0"] = 90; }); reject((state) => { state.params.nextNode = 1; });
  });
  it("rejects unrepresented crossings and nodes hidden inside edges", () => {
    reject((state) => { state.points["node.2"] = { x: 440, y: 200 }; state.points["node.3"] = { x: 440, y: 500 }; state.params.nextNode = 4; state.params["a.1"] = 2; state.params["b.1"] = 3; state.params.nextEdge = 2; });
    reject((state) => { state.points["node.2"] = { x: 440, y: 360 }; state.params.nextNode = 3; });
  });
  it("rejects forged records, step gaps, repeated picks and stale current strokes", () => {
    reject((state) => { state.marks = ["figure.1.0.0", "figure.1.1.1"]; state.params.nextRecord = 2; });
    reject((state) => { state.marks = ["pick.1.0"]; }); reject((state) => { state.marks = ["pick.0.0", "pick.1.0"]; });
    const path = createNetworkState("52-create"); path.params.currentStroke = 1; expect(isValidPlaneNetworkState(path)).toBe(false);
  });
  it("uses shared construction/material/action declarations without a replacement scene picker", () => {
    expect(planeNetworkScenes.map((scene) => scene.id)).toEqual(["47-create", "52-create"]);
    for (const scene of planeNetworkScenes) { expect(scene.construction!.tools.map((tool) => tool.kind)).toEqual(["point", "drag"]); expect(scene.materials).toHaveLength(4); }
  });
  it("rejects malformed states and non-finite direct input safely", () => {
    for (const state of [null, undefined, [], {}, { ...createNetworkState("47-create"), marks: [null] }, { ...createNetworkState("47-create"), points: null }, { ...createNetworkState("47-create"), phase: NaN }]) expect(isValidPlaneNetworkState(state as PlanarState)).toBe(false);
    const state = createNetworkState("47-create");
    expect(addNetworkPoint(state, { x: Infinity, y: 0 })).toBe(state);
    expect(addNetworkSegment(state, { x: 0, y: 0 }, { x: NaN, y: 1 })).toBe(state);
  });
  it("all shortcut and selection-field extremes produce legal states", () => {
    const values: Record<string, number[]> = { rays: [2, 8], columns: [1, 5], rows: [1, 4], levels: [1, 4], figureMode: [0, 1, 2] };
    for (const [key, candidates] of Object.entries(values)) for (const value of candidates) {
      const state = setNetworkField(createNetworkState("47-create"), key, value);
      for (const material of ["grid", "rays", "triangle", "segment"] as const) expect(isValidPlaneNetworkState(addNetworkMaterial(state, material)), `${key}=${value}/${material}`).toBe(true);
    }
  });
});
