import { describe, expect, it } from "vitest";
import { rectangleUnion } from "../src/features/tools/plane-geometry/model";
import { polygonUnionBoundary, distance, type BoundaryMaterial } from "../src/features/tools/plane-perimeter-boundary/geometry";
import { constructionObject, constructionObjects, removeConstruction } from "../src/features/tools/plane-construction/model";
import { isValidPerimeterState } from "../src/features/tools/plane-perimeter/validation";
import { PERIMETER_UNIT, syncPerimeterGeometry } from "../src/features/tools/plane-perimeter/model";
import { addStaircaseMaterial, changePerimeterBase, collectEdgeCopies, createBoundaryGeometry, createPerimeterBoundaryState, dragEdgeCopy, edgeCopies, extractEdgeCopies, interpolateEdgeCopies, isValidPerimeterBoundaryState, orthogonalEdgeFrame, perimeterBaseState, restoreEdgeCopies, setAllUnionMembers, setPerimeterBoundaryField } from "../src/features/tools/plane-perimeter-boundary/model";
import { planePerimeterBoundaryCases } from "./fixtures/plane-perimeter-boundary-cases";

const rectangle = (x: number, y: number, width: number, height: number) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
const materials = (...polygons: ReturnType<typeof rectangle>[]): BoundaryMaterial[] => polygons.map((points, id) => ({ id, points }));
const total = (edges: { a: { x: number; y: number }; b: { x: number; y: number } }[]) => edges.reduce((sum, edge) => sum + distance(edge.a, edge.b), 0);

describe("actual polygon union boundaries, holes and material seams", () => {
  it("distinguishes separate pieces, complete and partial seams, and point-only contact", () => {
    for (const [x, y, perimeter, seam, components, outer] of [[20, 0, 60, 0, 2, 2], [10, 0, 50, 5, 1, 1], [10, 2, 54, 3, 1, 1], [10, 5, 60, 0, 1, 2]]) {
      const result = polygonUnionBoundary(materials(rectangle(0, 0, 10, 5), rectangle(x, y, 10, 5)));
      expect(result.valid).toBe(true); expect(result.perimeter).toBeCloseTo(perimeter, 10); expect(total(result.seams)).toBeCloseTo(seam, 10); expect(result.components).toBe(components); expect(result.outer).toHaveLength(outer); expect(result.holes).toHaveLength(0);
    }
  });
  it("removes covered original edges without inventing shared seams or double-counting identical outlines", () => {
    const overlap = polygonUnionBoundary(materials(rectangle(0, 0, 10, 5), rectangle(5, 2, 10, 5)));
    expect(overlap.valid).toBe(true); expect(overlap.perimeter).toBe(44); expect(overlap.area).toBe(85); expect(overlap.seams).toHaveLength(0); expect(total(overlap.covered)).toBe(16);
    const identical = polygonUnionBoundary(materials(rectangle(0, 0, 10, 5), rectangle(0, 0, 10, 5).reverse()));
    expect(identical.perimeter).toBe(30); expect(identical.originalPerimeter).toBe(60); expect(identical.seams).toHaveLength(0);
    const contained = polygonUnionBoundary(materials(rectangle(0, 0, 10, 10), rectangle(2, 2, 2, 2)));
    expect(contained.perimeter).toBe(40); expect(contained.area).toBe(100); expect(total(contained.covered)).toBe(8); expect(contained.components).toBe(1);
  });
  it("keeps outer rings, hole rings and an island inside a hole as distinct real boundaries", () => {
    const bars = materials(rectangle(0, 0, 10, 2), rectangle(0, 8, 10, 2), rectangle(0, 2, 2, 6), rectangle(8, 2, 2, 6));
    const ring = polygonUnionBoundary(bars);
    expect(ring.valid).toBe(true); expect(ring.outerPerimeter).toBe(40); expect(ring.holePerimeter).toBe(24); expect(ring.perimeter).toBe(64); expect(ring.area).toBe(64); expect(ring.outer).toHaveLength(1); expect(ring.holes).toHaveLength(1); expect(total(ring.seams)).toBe(8);
    const island = polygonUnionBoundary([...bars, { id: 4, points: rectangle(4, 4, 2, 2) }]);
    expect(island.valid).toBe(true); expect(island.components).toBe(2); expect(island.outer).toHaveLength(2); expect(island.holes).toHaveLength(1); expect(island.perimeter).toBe(72); expect(island.area).toBe(68);
  });
  it("accepts concave outlines and rotated/mirrored shared edges without taking convex hulls", () => {
    const l = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }], source = materials(l, rectangle(4, 4, 6, 6));
    for (const flip of [-1, 1]) for (const angle of [0, 0.001, 37, 89.99, 180]) {
      const rad = angle * Math.PI / 180, rotated = source.map((material) => ({ ...material, points: material.points.map((p) => ({ x: 1300 + flip * p.x * Math.cos(rad) - p.y * Math.sin(rad), y: 530 + flip * p.x * Math.sin(rad) + p.y * Math.cos(rad) })) }));
      const result = polygonUnionBoundary(rotated);
      expect(result.valid, `${flip}/${angle}`).toBe(true); expect(result.perimeter).toBeCloseTo(40, 8); expect(total(result.seams)).toBeCloseTo(12, 8); expect(result.area).toBeCloseTo(100, 8);
    }
    const alone = polygonUnionBoundary(materials(l)); expect(alone.area).toBe(64); expect(alone.perimeter).toBe(40); expect(alone.outer[0].points).toHaveLength(6);
  });
  it("preserves narrow positive gaps and overlaps instead of applying screen-space tolerances", () => {
    const gap = polygonUnionBoundary(materials(rectangle(0, 0, 10, 5), rectangle(10 + 1e-8, 0, 10, 5)));
    expect(gap.valid).toBe(true); expect(gap.components).toBe(2); expect(gap.perimeter).toBeCloseTo(60, 10); expect(gap.seams).toHaveLength(0);
    const overlap = polygonUnionBoundary(materials(rectangle(0, 0, 10, 5), rectangle(10 - 1e-8, 0, 10, 5)));
    expect(overlap.valid).toBe(true); expect(overlap.components).toBe(1); expect(overlap.perimeter).toBeCloseTo(50 - 2e-8, 10); expect(overlap.seams).toHaveLength(0);
  });
  it("matches the independent axis-grid oracle across finite arrangements and input order", () => {
    let seed = 120319; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let sample = 0; sample < 30; sample++) {
      const rectangles = Array.from({ length: 8 }, () => ({ x: Math.floor(random() * 20), y: Math.floor(random() * 20), width: 2 + Math.floor(random() * 10), height: 2 + Math.floor(random() * 10) }));
      const source = rectangles.map((r, id) => ({ id, points: rectangle(r.x, r.y, r.width, r.height) })), oracle = rectangleUnion(rectangles);
      const angle = 37.25 * Math.PI / 180, rotated = source.map((material) => ({ ...material, points: material.points.map((p) => ({ x: 1300 - p.x * Math.cos(angle) - p.y * Math.sin(angle), y: 500 - p.x * Math.sin(angle) + p.y * Math.cos(angle) })) }));
      for (const input of [source, source.toReversed(), rotated]) { const result = polygonUnionBoundary(input); expect(result.valid, `arrangement ${sample}`).toBe(true); expect(result.perimeter).toBeCloseTo(oracle.perimeter, 8); expect(result.area).toBeCloseTo(oracle.area, 8); expect(result.outerPerimeter + result.holePerimeter).toBeCloseTo(result.perimeter, 8); }
    }
  });
  it("splits proper slanted intersections and retains every concave outside corner", () => {
    const side = Math.SQRT2, square = rectangle(-1, -1, 2, 2), diamond = [{ x: 0, y: -side }, { x: side, y: 0 }, { x: 0, y: side }, { x: -side, y: 0 }];
    const result = polygonUnionBoundary(materials(square, diamond));
    expect(result.valid).toBe(true); expect(result.outer).toHaveLength(1); expect(result.outer[0].points).toHaveLength(16); expect(result.holes).toHaveLength(0);
    expect(result.area).toBeCloseTo(16 - 8 * side, 10); expect(result.perimeter).toBeCloseTo(32 - 16 * side, 10); expect(result.seams).toHaveLength(0);
  });
});

describe("reconstructible union membership and rigid edge translations", () => {
  it("validates all title, version, reference, discrete value and key-budget fixtures", () => {
    for (const entry of planePerimeterBoundaryCases()) {
      const { contentVersion, payload } = entry.scene, title = payload.title.trim();
      const valid = title.length > 0 && title.length <= 80 && (contentVersion === "plane-perimeter-lesson-v3" ? isValidPerimeterBoundaryState(payload.initial) : isValidPerimeterState(payload.initial));
      expect(valid, entry.label).toBe(entry.accepted);
      if (entry.accepted) expect(JSON.parse(JSON.stringify(entry.scene))).toEqual(entry.scene);
    }
  });
  it("keeps both endpoints at the same displacement at every collection and return frame", () => {
    const initial = extractEdgeCopies(addStaircaseMaterial(createPerimeterBoundaryState(), true));
    for (const angle of [0, 37.25, -142]) for (const flip of [-1, 1]) {
      const from = { ...setPerimeterBoundaryField(initial, "angle", angle), params: { ...setPerimeterBoundaryField(initial, "angle", angle).params, [`flip.${initial.params.edgeSource}`]: flip } }, to = collectEdgeCopies(from);
      for (const [start, finish] of [[from, to], [to, restoreEdgeCopies(to)]]) for (const progress of [0, 0.15, 0.5, 0.8, 1]) {
        const frame = interpolateEdgeCopies(start, finish, progress); expect(isValidPerimeterBoundaryState(frame)).toBe(true);
        expect(perimeterBaseState(frame)).toEqual(perimeterBaseState(from));
        for (const edge of edgeCopies(frame)) {
          expect(edge.a.x - edge.originalA.x).toBeCloseTo(edge.b.x - edge.originalB.x, 10);
          expect(edge.a.y - edge.originalA.y).toBeCloseTo(edge.b.y - edge.originalB.y, 10);
          expect(edge.b.x - edge.a.x).toBeCloseTo(edge.originalB.x - edge.originalA.x, 10);
          expect(edge.b.y - edge.a.y).toBeCloseTo(edge.originalB.y - edge.originalA.y, 10);
          expect(distance(edge.a, edge.b)).toBeCloseTo(edge.length, 10);
        }
      }
    }
  });
  it("counts actual notched edge length instead of substituting a bounding rectangle", () => {
    const source = extractEdgeCopies(addStaircaseMaterial(createPerimeterBoundaryState(), true)), frame = orthogonalEdgeFrame(source)!;
    expect(frame.horizontal).toBe(492); expect(frame.vertical).toBe(300); expect(frame.perimeter).toBe(792); expect(frame.referencePerimeter).toBe(720);
    const collected = collectEdgeCopies(source), copies = edgeCopies(collected), h = frame.edges.filter((edge) => edge.group === 0).map((edge) => copies[edge.index]), v = frame.edges.filter((edge) => edge.group === 1).map((edge) => copies[edge.index]);
    expect(new Set(h.flatMap((edge) => [edge.a.y, edge.b.y])).size).toBe(1); expect(new Set(v.flatMap((edge) => [edge.a.x, edge.b.x])).size).toBe(1);
    expect(total(copies)).toBe(792); expect(constructionObjects(collected)).toEqual(constructionObjects(source));
  });
  it("drags one copy in world coordinates and preserves exact decimal numeric offsets", () => {
    const source = extractEdgeCopies(setPerimeterBoundaryField(addStaircaseMaterial(createPerimeterBoundaryState(), true), "angle", 37.25)), before = edgeCopies(source);
    const moved = dragEdgeCopy(source, "edge-copy.3", { x: 27.125, y: -52.875 }), copies = edgeCopies(moved);
    expect(copies[3].offset.x).toBeCloseTo(27.125, 10); expect(copies[3].offset.y).toBeCloseTo(-52.875, 10);
    copies.forEach((edge, i) => { if (i !== 3) expect(edge).toEqual(before[i]); }); expect(constructionObjects(moved)).toEqual(constructionObjects(source));
    const precise = setPerimeterBoundaryField(setPerimeterBoundaryField(moved, "edgeDx", 12.3456), "edgeDy", -7.6543), selected = edgeCopies(precise)[3];
    expect(selected.offset.x / PERIMETER_UNIT).toBeCloseTo(12.3456, 10); expect(selected.offset.y / PERIMETER_UNIT).toBeCloseTo(-7.6543, 10);
    expect(setPerimeterBoundaryField(precise, "edgeActive", 1.2)).toBe(precise); expect(setPerimeterBoundaryField(precise, "unionMember", 0.5)).toBe(precise);
    expect(dragEdgeCopy(precise, "edge-copy.03", { x: 1, y: 1 })).toBe(precise); expect(dragEdgeCopy(precise, "edge-copy.3", { x: Infinity, y: 1 })).toBe(precise);
    expect(restoreEdgeCopies(precise)).toEqual(source.params.edgeActive === 3 ? source : { ...source, params: { ...source.params, edgeActive: 3 } });
  });
  it("retains copies across rigid poses and unrelated edits, and resets only when their source geometry changes", () => {
    const source = collectEdgeCopies(extractEdgeCopies(addStaircaseMaterial(createPerimeterBoundaryState(), true))), offsets = Object.fromEntries(Object.entries(source.points).filter(([key]) => key.startsWith("edgeMove.")));
    const rotated = setPerimeterBoundaryField(source, "angle", 93.2);
    expect(Object.fromEntries(Object.entries(rotated.points).filter(([key]) => key.startsWith("edgeMove.")))).toEqual(offsets);
    const other = setPerimeterBoundaryField({ ...rotated, params: { ...rotated.params, active: 0 } }, "width", 7.125);
    expect(edgeCopies(other)).toEqual(edgeCopies(rotated)); expect(constructionObject(other, source.params.edgeSource)).toEqual(constructionObject(rotated, source.params.edgeSource));
    const edited = setPerimeterBoundaryField({ ...other, params: { ...other.params, active: source.params.edgeSource } }, "width", 8.125);
    expect(edgeCopies(edited).every((edge) => edge.offset.x === 0 && edge.offset.y === 0)).toBe(true); expect(constructionObject(edited, 0)).toEqual(constructionObject(other, 0));
    const removed = changePerimeterBase(edited, (state) => syncPerimeterGeometry(state, removeConstruction(state))); expect(removed.params.edgeSource).toBe(-1); expect(removed.params.edgeActive).toBe(-1); expect(edgeCopies(removed)).toEqual([]); expect(isValidPerimeterBoundaryState(removed)).toBe(true);
  });
  it("allows manual translation on nonorthogonal polygons while two-direction collection stays unavailable", () => {
    const source = extractEdgeCopies(createBoundaryGeometry(createPerimeterBoundaryState(), "polygon", [{ x: 100, y: 100 }, { x: 260, y: 140 }, { x: 200, y: 270 }])!);
    expect(orthogonalEdgeFrame(source)).toBeNull(); expect(collectEdgeCopies(source)).toBe(source);
    const moved = dragEdgeCopy(source, "edge-copy.1", { x: 22, y: 30 }); expect(moved).not.toBe(source); expect(edgeCopies(moved)[1].length).toBe(edgeCopies(source)[1].length);
    expect(constructionObjects(setAllUnionMembers(moved, false))).toEqual(constructionObjects(source));
  });
});
