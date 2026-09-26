import { describe, expect, it } from "vitest";
import { planarStateSchema } from "@/features/tools/planar-kit/contract";
import { polygonArea } from "@/features/tools/planar-interaction/geometry";
import { AREA_SCENES, AREA_SCALE, applyPose, buildAreaModel, createAreaState, cutNextAreaPaper, dot, dragAreaState, intersectConvex, movableAreaPiece, parallelogramFrame, piecePoints, point, requiredAreaCuts, snapAreaState, toScreen, triangleSquares, triangleStripSquares } from "@/features/tools/plane-area/model";
import { interpolateAreaArrangement, planeAreaScenes, setAreaField } from "@/features/tools/plane-area/scenes";
import { isValidPlaneAreaState } from "@/features/tools/plane-area/validation";

describe("plane area teaching scenes", () => {
  it("registers the 18 approved scenes with restorable mathematical state", () => {
    expect(planeAreaScenes.map((scene) => scene.id)).toEqual([...AREA_SCENES]);
    expect(planeAreaScenes.find((scene) => scene.id === "19")).toBeUndefined();
    for (const scene of planeAreaScenes) {
      const state = scene.create();
      expect(planarStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
      expect(buildAreaModel(state).pieces.length).toBeGreaterThan(0);
      expect(Object.values(buildAreaModel(state).values).every(Number.isFinite)).toBe(true);
      expect(scene.title.en).toBeTruthy();
      expect(scene.description.en).toBeTruthy();
      expect(isValidPlaneAreaState(state), scene.id).toBe(true);
    }
  });
  it("supports successive cuts and either base without losing area or overlapping at the rectangle", () => {
    for (const alternate of [false, true]) for (const slant of [1.5, 5.5, 7.7]) {
      const state = createAreaState("14"); state.params.base = 3.5; state.params.slant = slant; state.flags.alternate = alternate;
      const required = requiredAreaCuts(state), frame = parallelogramFrame(state);
      for (let cuts = 0; cuts <= required; cuts += 1) {
        const partial = { ...state, params: { ...state.params, cuts }, phase: 0.4 };
        expect(buildAreaModel(partial).pieces.reduce((sum, piece) => sum + piece.area, 0)).toBeCloseTo(frame.base * frame.height, 8);
      }
      const model = buildAreaModel({ ...state, params: { ...state.params, cuts: required }, phase: 1 });
      const polygons = model.pieces.map(piecePoints);
      for (const polygon of polygons) for (const p of polygon) {
        expect(dot(p, frame.u)).toBeGreaterThanOrEqual(-1e-8); expect(dot(p, frame.u)).toBeLessThanOrEqual(frame.base + 1e-8);
        expect(dot(p, frame.v)).toBeGreaterThanOrEqual(-1e-8); expect(dot(p, frame.v)).toBeLessThanOrEqual(frame.height + 1e-8);
      }
      for (let i = 0; i < polygons.length; i += 1) for (let j = i + 1; j < polygons.length; j += 1) expect(polygonArea(intersectConvex(polygons[i], polygons[j]))).toBeLessThan(1e-7);
    }
    const special = createAreaState("14"); special.params.base = 3.5; special.params.slant = 5.5;
    expect(requiredAreaCuts(special)).toBe(2);
  });
  it("duplicates triangles and trapezoids as congruent rigid paper", () => {
    for (const id of ["15", "16"] as const) {
      const state = createAreaState(id); state.flags.duplicate = true;
      const final = buildAreaModel({ ...state, phase: 1 });
      expect(final.pieces).toHaveLength(2);
      expect(final.pieces[0].area).toBeCloseTo(final.pieces[1].area);
      expect(polygonArea(intersectConvex(piecePoints(final.pieces[0]), piecePoints(final.pieces[1])))).toBeLessThan(1e-7);
      for (const phase of [0, 0.2, 0.5, 0.8, 1]) {
        const piece = buildAreaModel({ ...state, phase }).pieces[1];
        expect(polygonArea(piecePoints(piece))).toBeCloseTo(piece.area, 8);
      }
    }
  });
  it("moves every triangle vertex and distinguishes parallel motion from a change of height", () => {
    const initial = createAreaState("18"), area = buildAreaModel(initial).values.area;
    const parallel = dragAreaState(initial, "handle.C", toScreen(point(4.8, 6)), point(100, -100));
    expect(parallel.points.C.y).toBe(initial.points.C.y);
    expect(buildAreaModel(parallel).values.area).toBeCloseTo(area);
    const free = dragAreaState({ ...initial, flags: { ...initial.flags, constraint: false } }, "handle.C", toScreen(point(4.8, 6)), point(100, -100));
    expect(buildAreaModel(free).values.area).not.toBeCloseTo(area);
    for (const key of ["A", "B"] as const) {
      const moved = dragAreaState(initial, `handle.${key}`, toScreen(point(initial.points[key].x + 0.5, 2)), point(25, 0));
      expect(moved.points[key].x).toBeCloseTo(initial.points[key].x + 0.5);
      expect(moved.points[key].y).toBeCloseTo(initial.points[key].y);
    }
  });
  it("bounds triangle area with true square cells and converges when subdivided", () => {
    const triangle = [point(0, 0), point(6, 0), point(1.8, 3.5)], exact = polygonArea(triangle);
    let previousGap = Infinity;
    for (const divisions of [4, 8, 16, 32]) {
      const result = triangleSquares(triangle, divisions);
      expect(result.lower).toBeLessThanOrEqual(exact + 1e-7); expect(result.upper).toBeGreaterThanOrEqual(exact - 1e-7);
      expect(result.upper - result.lower).toBeLessThan(previousGap); previousGap = result.upper - result.lower;
      for (const cell of result.cells) expect(Math.abs(cell.points[1].x - cell.points[0].x)).toBeCloseTo(Math.abs(cell.points[2].y - cell.points[1].y));
    }
  });
  it("slides whole equal-height square strips without adding cells and refines toward the triangle", () => {
    const before = [point(0, 0), point(6, 0), point(1.8, 3.5)], after = [point(0, 0), point(6, 0), point(5.8, 3.5)];
    let gap = Infinity;
    for (const count of [4, 8, 16, 32, 48]) {
      const original = triangleStripSquares(before, count), moved = triangleStripSquares(after, count);
      expect(moved.area).toBeCloseTo(original.area); expect(moved.cells).toHaveLength(original.cells.length);
      expect(Math.abs(polygonArea(before) - original.area)).toBeLessThanOrEqual(gap + 1e-8); gap = Math.abs(polygonArea(before) - original.area);
      original.cells.forEach((cell, i) => {
        const next = moved.cells[i], dx = next.points[0].x - cell.points[0].x;
        expect(next.row).toBe(cell.row); expect(dx).toBeGreaterThan(0);
        cell.points.forEach((p, j) => { expect(next.points[j].x - p.x).toBeCloseTo(dx); expect(next.points[j].y).toBeCloseTo(p.y); });
        expect(Math.hypot(cell.points[1].x - cell.points[0].x, cell.points[1].y - cell.points[0].y)).toBeCloseTo(Math.hypot(cell.points[2].x - cell.points[1].x, cell.points[2].y - cell.points[1].y));
      });
    }
  });
  it("computes overlap from the rotated polygons, not bounding boxes", () => {
    const state = createAreaState("33"), model = buildAreaModel(state);
    expect(model.values.intersection).toBeCloseTo(1.5 * 2.25);
    const turned = buildAreaModel({ ...state, params: { ...state.params, angle: 38 } });
    expect(turned.values.intersection).not.toBeCloseTo(model.values.intersection);
    expect(turned.values.union + turned.values.intersection).toBeCloseTo(2 * state.params.base ** 2);
    const moved = dragAreaState(state, "piece.B", point(0, 0), point(AREA_SCALE, -AREA_SCALE));
    expect(moved.points.P).toEqual({ x: 3, y: 2.25 });
  });
  it("keeps explicit area relations only while their geometric constraints hold", () => {
    const commonAngle = createAreaState("38"), a = buildAreaModel(commonAngle);
    expect(a.values.small / a.values.area).toBeCloseTo(commonAngle.params.fraction * commonAngle.params.secondary);
    const swallow = createAreaState("39"), wings = buildAreaModel(swallow);
    expect(wings.values.S1 / wings.values.S2).toBeCloseTo(swallow.params.fraction / (1 - swallow.params.fraction));
    expect(wings.pieces.reduce((sum, piece) => sum + piece.area, 0)).toBeCloseTo(wings.values.area);
    const butterfly = createAreaState("40"), symmetrical = buildAreaModel(butterfly);
    expect(symmetrical.values.S2).toBeCloseTo(symmetrical.values.S4);
    const released = { ...butterfly, flags: { ...butterfly.flags, constraint: false } };
    const changed = dragAreaState(released, "handle.A", toScreen(point(1, 5)), point(0, -60));
    const asymmetric = buildAreaModel(changed);
    expect(asymmetric.values.S2).not.toBeCloseTo(asymmetric.values.S4);
  });
  it("preserves midpoints through arbitrary parent triangle movement", () => {
    const state = createAreaState("42"); state.params.layers = 5;
    const moved = dragAreaState(state, "handle.C", toScreen(point(5, 5)), point(0, 0)), model = buildAreaModel(moved);
    for (let layer = 1; layer <= 5; layer += 1) expect(model.values[`S${layer}`]).toBeCloseTo(model.values.area / 4 ** layer);
  });
  it("copies only an explicitly selected midpoint layer and keeps the full paper rigid throughout extraction", () => {
    const scene = planeAreaScenes.find((entry) => entry.id === "42")!, start = scene.create(), action = scene.actions!.find((entry) => entry.id === "duplicate")!, context = { selected: "piece.level1" };
    expect(action.disabled!(start, { selected: null })).toBe(true);
    expect(action.disabled!(start, { selected: "piece.ABC" })).toBe(true);
    expect(action.disabled!(start, { selected: "piece.level5" })).toBe(true);
    expect(buildAreaModel(start).pieces.some((piece) => piece.id.startsWith("copy."))).toBe(false);
    expect(action.run(start, { selected: null })).toBe(start);
    expect(action.disabled!(start, context)).toBe(false);
    const original = buildAreaModel(start).pieces.find((piece) => piece.id === "level1")!, end = action.run(start, context);
    expect(action.disabled!(end, context)).toBe(true); expect(action.run(end, context)).toBe(end);
    expect(end.flags["detached.level1"]).toBe(true);
    for (const t of [0, 0.15, 0.5, 0.85, 1]) {
      const frame = action.interpolate!(start, end, t), model = buildAreaModel(frame), copy = model.pieces.find((piece) => piece.id === "copy.level1")!, polygon = piecePoints(copy);
      expect(isValidPlaneAreaState(frame)).toBe(true);
      expect(copy.points).toEqual(original.points);
      expect(copy.area).toBeCloseTo(original.area, 10); expect(polygonArea(polygon)).toBeCloseTo(original.area, 10);
      for (let i = 0; i < 3; i += 1) expect(Math.hypot(polygon[i].x - polygon[(i + 1) % 3].x, polygon[i].y - polygon[(i + 1) % 3].y)).toBeCloseTo(Math.hypot(original.points![i].x - original.points![(i + 1) % 3].x, original.points![i].y - original.points![(i + 1) % 3].y), 10);
      expect(model.pieces.find((piece) => piece.id === "level1")).toEqual(original);
      expect(frame.points["piece.copy.level1"].x).toBeCloseTo(end.points["piece.copy.level1"].x * t);
    }
    expect(start.points["piece.copy.level1.A"]).toBeUndefined();
  });
  it("moves and rotates frozen midpoint copies independently and keeps them when the source or layer count changes", () => {
    const scene = planeAreaScenes.find((entry) => entry.id === "42")!, duplicate = scene.actions!.find((entry) => entry.id === "duplicate")!, turn = scene.actions!.find((entry) => entry.id === "turn-positive")!;
    const initial = setAreaField(scene.create(), "layers", 5), copied = duplicate.run(initial, { selected: "piece.level2" });
    const before = buildAreaModel(copied).pieces.find((piece) => piece.id === "copy.level2")!;
    const changed = dragAreaState(copied, "handle.C", toScreen(point(5, 6)), point(0, 0)), reduced = setAreaField(changed, "layers", 1);
    expect(buildAreaModel(changed).values.S2).not.toBeCloseTo(before.area);
    expect(buildAreaModel(reduced).pieces.find((piece) => piece.id === "copy.level2")).toEqual(before);
    expect(buildAreaModel(reduced).pieces.some((piece) => piece.id === "level2")).toBe(false);
    expect(movableAreaPiece(reduced, "copy.level2")).toBe(true); expect(movableAreaPiece(reduced, "level1")).toBe(false);
    const moved = dragAreaState(reduced, "piece.copy.level2", point(0, 0), point(40, -35));
    expect(moved.points["piece.copy.level2"].x).toBeCloseTo(reduced.points["piece.copy.level2"].x + 0.8);
    expect(moved.points["piece.copy.level2"].y).toBeCloseTo(reduced.points["piece.copy.level2"].y + 0.7);
    expect(dragAreaState(moved, "piece.copy.level2.A", point(0, 0), point(100, 100))).toBe(moved);
    const end = turn.run(moved, { selected: "piece.copy.level2" }), middle = turn.interpolate!(moved, end, 0.5);
    expect(turn.disabled!(moved, { selected: "piece.level1" })).toBe(true);
    expect(middle.params["turn.copy.level2"]).toBe(45); expect(end.params["turn.copy.level2"]).toBe(90);
    const polygons = [moved, middle, end].map((state) => piecePoints(buildAreaModel(state).pieces.find((piece) => piece.id === "copy.level2")!));
    for (const polygon of polygons) {
      expect(polygonArea(polygon)).toBeCloseTo(before.area, 10);
      for (const axis of ["x", "y"] as const) expect(polygon.reduce((sum, p) => sum + p[axis] / 3, 0)).toBeCloseTo(polygons[0].reduce((sum, p) => sum + p[axis] / 3, 0), 10);
    }
    expect(planarStateSchema.parse(JSON.parse(JSON.stringify(end)))).toEqual(end);
    expect(buildAreaModel(planarStateSchema.parse(JSON.parse(JSON.stringify(end))))).toEqual(buildAreaModel(end));
  });
  it("bounds midpoint copies to five fixed identities and safely ignores incomplete optional copies without changing v1", () => {
    const scene = planeAreaScenes.find((entry) => entry.id === "42")!, action = scene.actions!.find((entry) => entry.id === "duplicate")!;
    let state = setAreaField(scene.create(), "layers", 5);
    for (let layer = 1; layer <= 5; layer += 1) state = action.run(state, { selected: `piece.level${layer}` });
    expect(buildAreaModel(state).pieces.filter((piece) => piece.id.startsWith("copy."))).toHaveLength(5);
    expect(Object.keys(state.points)).toHaveLength(25); expect(Object.keys(state.params)).toHaveLength(Object.keys(scene.create().params).length + 5);
    expect(isValidPlaneAreaState(state)).toBe(true); expect(planarStateSchema.safeParse(state).success).toBe(true);
    const missing = structuredClone(state); delete missing.points["piece.copy.level1.B"];
    expect(isValidPlaneAreaState(missing)).toBe(true);
    expect(buildAreaModel(missing).pieces.some((piece) => piece.id === "copy.level1")).toBe(false);
    expect(action.disabled!(missing, { selected: "piece.level1" })).toBe(false);
    expect(buildAreaModel(action.run(missing, { selected: "piece.level1" })).pieces.some((piece) => piece.id === "copy.level1")).toBe(true);
    const degenerate = structuredClone(state); for (const key of ["A", "B", "C"]) degenerate.points[`piece.copy.level1.${key}`] = point(0, 0);
    expect(buildAreaModel(degenerate).pieces.some((piece) => piece.id === "copy.level1")).toBe(false);
    const hidden = { ...state, flags: { ...state.flags, "detached.level1": false } };
    expect(buildAreaModel(hidden).pieces.some((piece) => piece.id === "copy.level1")).toBe(false);
  });
  it("retains true arcs while moving all sectors and accounts for the complete circle", () => {
    for (const count of [8, 16, 32, 64]) {
      const state = createAreaState("27"); state.params.count = count;
      for (const phase of [0, 0.35, 1]) {
        const model = buildAreaModel({ ...state, phase });
        expect(model.pieces).toHaveLength(count);
        expect(model.pieces.every((piece) => piece.path?.includes(" A "))).toBe(true);
        expect(model.pieces.reduce((sum, piece) => sum + piece.area, 0)).toBeCloseTo(Math.PI * state.params.radius ** 2);
      }
    }
  });
  it("uses exact curved-region areas without claiming the two circle-square differences are equal", () => {
    const leaf = buildAreaModel(createAreaState("44"));
    expect(leaf.values.leaf).toBeCloseTo(2 * leaf.values.segment);
    const state = createAreaState("45"), model = buildAreaModel(state), r2 = state.params.radius ** 2;
    expect(model.values.outerDifference).toBeCloseTo((4 - Math.PI) * r2);
    expect(model.values.innerDifference).toBeCloseTo((Math.PI - 2) * r2);
    expect(model.values.outerDifference).not.toBeCloseTo(model.values.innerDifference);
    expect(model.pieces.filter((p) => p.id === "squareRight" || p.id.startsWith("arc")).reduce((sum, p) => sum + p.area, 0)).toBeCloseTo(Math.PI * r2);
    expect(model.pieces.filter((p) => p.id === "circleLeft" || p.id.startsWith("corner")).reduce((sum, p) => sum + p.area, 0)).toBeCloseTo(4 * r2);
  });
  it("splits a rectangle into three equal but noncongruent regions and supports releasing the constraint", () => {
    const initial = createAreaState("46"), model = buildAreaModel(initial);
    expect(model.pieces[0].points).toHaveLength(4); expect(model.pieces[1].points).toHaveLength(3);
    expect(model.values.S1).toBeCloseTo(model.values.S2); expect(model.values.S2).toBeCloseTo(model.values.S3);
    expect(dragAreaState(initial, "handle.cut", toScreen(point(4, 3.5)), point(0, 0))).toBe(initial);
    const moved = dragAreaState({ ...initial, flags: { ...initial.flags, constraint: false } }, "handle.cut", toScreen(point(4, 3.5)), point(0, 0));
    expect(buildAreaModel(moved).values.S1).not.toBeCloseTo(buildAreaModel(moved).values.S2);
  });
  it("rearranges the four right triangles without reflection, stretching or final overlaps", () => {
    const state = createAreaState("58"), area = state.params.base * state.params.height / 2;
    for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
      const model = buildAreaModel({ ...state, phase });
      model.pieces.forEach((piece) => {
        const p = piecePoints(piece);
        expect(polygonArea(p)).toBeCloseTo(area);
        expect(Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y)).toBeCloseTo(state.params.base);
        expect(Math.hypot(p[2].x - p[0].x, p[2].y - p[0].y)).toBeCloseTo(state.params.height);
        expect(dot({ x: p[1].x - p[0].x, y: p[1].y - p[0].y }, { x: p[2].x - p[0].x, y: p[2].y - p[0].y })).toBeCloseTo(0);
      });
      if (phase === 0 || phase === 1) for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) expect(polygonArea(intersectConvex(piecePoints(model.pieces[i]), piecePoints(model.pieces[j])))).toBeLessThan(1e-7);
      expect(model.values.remaining).toBeCloseTo(state.params.base ** 2 + state.params.height ** 2);
    }
  });
  it("connects similar length and area ratios while allowing a nonparallel contrast", () => {
    const state = createAreaState("59"), model = buildAreaModel(state);
    expect(model.values.areaRatio).toBeCloseTo(state.params.fraction ** 2);
    const free = buildAreaModel({ ...state, params: { ...state.params, secondary: 0.7 }, flags: { ...state.flags, constraint: false } });
    expect(free.values.areaRatio).toBeCloseTo(state.params.fraction * 0.7);
    expect(free.values.areaRatio).not.toBeCloseTo(model.values.areaRatio);
  });
  it("bases drag frames on their starting state and snaps only near known paper positions", () => {
    const state = createAreaState("14"); state.params.cuts = 1;
    const moved = dragAreaState(state, "piece.p1", point(0, 0), point(-4.9 * AREA_SCALE, 0.1 * AREA_SCALE));
    expect(dragAreaState(state, "piece.p1", point(0, 0), point(-4.9 * AREA_SCALE, 0.1 * AREA_SCALE))).toEqual(moved);
    const snapped = snapAreaState(moved, "piece.p1"); expect(snapped?.points["piece.p1"]).toEqual({ x: -5, y: 0 });
    expect(snapAreaState({ ...moved, flags: { ...moved.flags, snap: false } }, "piece.p1")).toBeNull();
    expect(state.points["piece.p1"]).toBeUndefined();
    const exact = setAreaField(createAreaState("18"), "height", 5);
    expect(buildAreaModel(exact).values.area).toBeCloseTo(15);
  });
  it("exposes explicit copy/cut and genuine intermediate rearrangement frames", () => {
    const context = { selected: null };
    for (const id of ["14", "15", "16", "27", "58"]) {
      const scene = planeAreaScenes.find((entry) => entry.id === id)!;
      let state = scene.create();
      for (const setup of scene.actions?.filter((entry) => entry.id === "cut" || entry.id === "duplicate") ?? []) state = setup.run(state, context);
      const action = scene.actions!.find((entry) => entry.id === "arrange")!;
      expect(action.disabled?.(state, context)).toBeFalsy();
      const end = action.run(state, context), middle = action.interpolate!(state, end, 0.5);
      expect(middle.phase).toBeCloseTo(0.5); expect(end.phase).toBe(1);
      expect(buildAreaModel(middle).pieces.some((piece) => applyPose(point(0, 0), piece.pose).x !== piece.original.x || piece.pose.angle !== piece.original.angle)).toBe(true);
    }
  });
  it("draws a progressive cut before committing the new paper boundary", () => {
    const scene = planeAreaScenes.find((entry) => entry.id === "14")!, start = scene.create(), cut = scene.actions!.find((entry) => entry.id === "cut")!, end = cut.run(start, { selected: null });
    const middle = cut.interpolate!(start, end, 0.5);
    expect(buildAreaModel(middle).guides.find((guide) => guide.kind === "cut")?.amount).toBe(0.5);
    expect(buildAreaModel(middle).pieces).toHaveLength(1);
    expect(isValidPlaneAreaState(middle)).toBe(false);
    expect(buildAreaModel(end).pieces).toHaveLength(2);
    expect(isValidPlaneAreaState(end)).toBe(true);
  });
  it("rotates the selected polygon around its own center through intermediate frames", () => {
    const scene = planeAreaScenes.find((entry) => entry.id === "58")!, start = scene.create(), action = scene.actions!.find((entry) => entry.id === "turn-positive")!, context = { selected: "piece.p1" };
    expect(action.disabled!(start, { selected: null })).toBe(true);
    const end = action.run(start, context), middle = action.interpolate!(start, end, 0.5);
    const centers = [start, middle, end].map((state) => {
      const polygon = piecePoints(buildAreaModel(state).pieces[1]);
      return polygon.reduce((sum, p) => ({ x: sum.x + p.x / 3, y: sum.y + p.y / 3 }), point(0, 0));
    });
    expect(middle.params["turn.p1"]).toBe(45);
    expect(centers[1].x).toBeCloseTo(centers[0].x); expect(centers[1].y).toBeCloseTo(centers[0].y);
    expect(centers[2].x).toBeCloseTo(centers[0].x); expect(centers[2].y).toBeCloseTo(centers[0].y);
    expect(isValidPlaneAreaState(end)).toBe(true);
  });
  it("does not jump a manually positioned paper when a rearrangement or another cut starts", () => {
    const scene = planeAreaScenes.find((entry) => entry.id === "58")!, from = scene.create();
    from.points["piece.p1"] = point(-1, 0.5); from.params["turn.p1"] = 45;
    const to = scene.actions!.find((entry) => entry.id === "arrange")!.run(from, { selected: null });
    const frame = interpolateAreaArrangement(from, to, 0);
    expect(piecePoints(buildAreaModel(frame).pieces[1])).toEqual(piecePoints(buildAreaModel(from).pieces[1]));
    const cutting = createAreaState("14"); cutting.params.base = 3.5; cutting.params.slant = 5.5; cutting.params.cuts = 1;
    cutting.points["piece.p1"] = point(1, 0.7); cutting.params["turn.p1"] = 35;
    const parent = buildAreaModel(cutting).pieces.find((piece) => piece.id === "p1")!, cut = cutNextAreaPaper(cutting), children = buildAreaModel(cut).pieces.filter((piece) => piece.id === "p1" || piece.id === "p2");
    expect(children).toHaveLength(2);
    for (const child of children) { expect(child.pose.x).toBeCloseTo(parent.pose.x); expect(child.pose.y).toBeCloseTo(parent.pose.y); expect(child.pose.angle).toBeCloseTo(parent.pose.angle); }
    expect(children.reduce((sum, piece) => sum + piece.area, 0)).toBeCloseTo(parent.area);
    expect(isValidPlaneAreaState(cut)).toBe(true);
  });
  it("rejects incomplete or mathematically invalid saved state and accepts every exposed parameter endpoint", () => {
    for (const scene of planeAreaScenes) {
      const start = scene.create();
      for (const field of scene.fields ?? []) for (const value of [field.min, field.max]) {
        const changed = scene.setField!(start, field.key, value);
        expect(isValidPlaneAreaState(changed), `${scene.id}/${field.key}/${value}`).toBe(true);
      }
    }
    const missing = createAreaState("18"); delete missing.points.C;
    expect(isValidPlaneAreaState(missing)).toBe(false);
    const degenerate = createAreaState("18"); degenerate.points.C = point(3, 0);
    expect(isValidPlaneAreaState(degenerate)).toBe(false);
    const excessive = createAreaState("27"); excessive.params.count = 100000;
    expect(isValidPlaneAreaState(excessive)).toBe(false);
    const crossed = createAreaState("40"); crossed.points.A = point(7, -1);
    expect(isValidPlaneAreaState(crossed)).toBe(false);
  });
});
