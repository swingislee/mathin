import { describe, expect, it } from "vitest";
import {
  CUBE_NET_ANALYSIS_REASONS,
  analyzeCubeNet,
  canonicalizeFreeUnitSquareNet,
  enumerateFreePolyominoes,
  parseUnitSquareNet,
  unitSquareNet,
  unitSquareNetCanonicalKey,
  type SquareCell,
} from "@/features/spatial-math/domain";
import {
  CUBE_NET_GOLD_CANONICAL_KEYS,
  SPATIAL_CUBE_NET_GOLD_CANDIDATES,
  SPATIAL_GOLD_REVIEW_STATUS,
} from "@/features/spatial-math/gold";

const FREE_POLYOMINO_COUNTS = [1, 1, 2, 5, 12, 35] as const;

function cellsFromKey(key: string): SquareCell[] {
  return key.split(";").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x, y };
  });
}

function transform(cells: readonly SquareCell[], index: number): SquareCell[] {
  return cells.map(({ x, y }) => {
    let transformed: SquareCell;
    if (index === 0) transformed = { x, y };
    else if (index === 1) transformed = { x: -y, y: x };
    else if (index === 2) transformed = { x: -x, y: -y };
    else if (index === 3) transformed = { x: y, y: -x };
    else if (index === 4) transformed = { x: -x, y };
    else if (index === 5) transformed = { x: -y, y: -x };
    else if (index === 6) transformed = { x, y: -y };
    else transformed = { x: y, y: x };
    return { x: transformed.x + 17, y: transformed.y - 23 };
  });
}

describe("unit-square-net-v1", () => {
  it("requires strict, unique and stable-order integer cells", () => {
    const valid = unitSquareNet([
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(valid.cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(() => parseUnitSquareNet({ ...valid, unexpected: true })).toThrow();
    expect(() => parseUnitSquareNet({ ...valid, cells: [valid.cells[1], valid.cells[0]] })).toThrow();
    expect(() => parseUnitSquareNet({ ...valid, cells: [valid.cells[0], valid.cells[0]] })).toThrow();
    expect(() => unitSquareNet([{ x: 1.5, y: 0 }])).toThrow();
    expect(() =>
      unitSquareNet([
        { x: -1_024, y: 0 },
        { x: 1_024, y: 0 },
      ]),
    ).toThrow();
  });

  it("canonicalizes translation, quarter turns and reflections", () => {
    const original = unitSquareNet([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    const expectedKey = unitSquareNetCanonicalKey(original);

    for (let index = 0; index < 8; index += 1) {
      const transformed = unitSquareNet(transform(original.cells, index));
      expect(unitSquareNetCanonicalKey(transformed)).toBe(expectedKey);
      expect(canonicalizeFreeUnitSquareNet(transformed).cells[0]).toEqual({ x: 0, y: 0 });
    }
  });
});

describe("free polyomino enumeration", () => {
  it("matches the free polyomino counts through all 35 hexominoes", () => {
    FREE_POLYOMINO_COUNTS.forEach((expected, index) => {
      const nets = enumerateFreePolyominoes(index + 1);
      expect(nets).toHaveLength(expected);
      expect(new Set(nets.map(unitSquareNetCanonicalKey)).size).toBe(expected);
    });
  });

  it("is deterministic and rejects unbounded enumeration requests", () => {
    const first = enumerateFreePolyominoes(6).map(unitSquareNetCanonicalKey);
    const second = enumerateFreePolyominoes(6).map(unitSquareNetCanonicalKey);
    expect(second).toEqual(first);
    expect(() => enumerateFreePolyominoes(0)).toThrow(RangeError);
    expect(() => enumerateFreePolyominoes(9)).toThrow(RangeError);
    expect(() => enumerateFreePolyominoes(2.5)).toThrow(RangeError);
  });
});

describe("cube-net-kernel-v1", () => {
  it("accepts exactly the 11 gold cube nets among the 35 free hexominoes", () => {
    const analyses = enumerateFreePolyominoes(6).map((net) => ({ net, analysis: analyzeCubeNet(net) }));
    const accepted = analyses.filter(({ analysis }) => analysis.isCubeNet).map(({ net }) => unitSquareNetCanonicalKey(net));
    expect(accepted).toEqual(CUBE_NET_GOLD_CANONICAL_KEYS);
    expect(analyses.filter(({ analysis }) => !analysis.isCubeNet)).toHaveLength(24);
    expect(new Set(analyses.filter(({ analysis }) => !analysis.isCubeNet).map(({ analysis }) => analysis.reason))).toEqual(
      new Set([CUBE_NET_ANALYSIS_REASONS.faceOverlap, CUBE_NET_ANALYSIS_REASONS.orientationConflict]),
    );
    expect(SPATIAL_CUBE_NET_GOLD_CANDIDATES).toHaveLength(11);
    expect(SPATIAL_CUBE_NET_GOLD_CANDIDATES.every((candidate) => candidate.reviewStatus === SPATIAL_GOLD_REVIEW_STATUS)).toBe(
      true,
    );
  });

  it("keeps all 11 gold decisions invariant under translation, rotation and reflection", () => {
    CUBE_NET_GOLD_CANONICAL_KEYS.forEach((key) => {
      const cells = cellsFromKey(key);
      for (let index = 0; index < 8; index += 1) {
        const variant = unitSquareNet(transform(cells, index));
        const analysis = analyzeCubeNet(variant);
        expect(analysis.isCubeNet, `${key} transform ${index}`).toBe(true);
        expect(analysis.canonicalKey).toBe(key);
      }
    });
  });

  it("keeps valid and invalid classification stable for every free hexomino transform", () => {
    enumerateFreePolyominoes(6).forEach((net) => {
      const baseline = analyzeCubeNet(net);
      for (let index = 0; index < 8; index += 1) {
        const variant = analyzeCubeNet(unitSquareNet(transform(net.cells, index)));
        expect(variant.canonicalKey).toBe(baseline.canonicalKey);
        expect(variant.isCubeNet, `${baseline.canonicalKey} transform ${index}`).toBe(baseline.isCubeNet);
        expect(variant.reason, `${baseline.canonicalKey} transform ${index}`).toBe(baseline.reason);
      }
    });
  });

  it("assigns every valid net to the six distinct semantic cube faces", () => {
    const net = unitSquareNet([
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    const analysis = analyzeCubeNet(net);

    expect(analysis).toMatchObject({
      connected: true,
      isCubeNet: true,
      reason: CUBE_NET_ANALYSIS_REASONS.valid,
      adjacencyEdgeCount: 5,
    });
    expect([...new Set(analysis.faces.map((face) => face.cubeFace))].sort()).toEqual([
      "x+",
      "x-",
      "y+",
      "y-",
      "z+",
      "z-",
    ]);
    analysis.faces.forEach((face) => {
      const cross = {
        x: face.right.y * face.up.z - face.right.z * face.up.y || 0,
        y: face.right.z * face.up.x - face.right.x * face.up.z || 0,
        z: face.right.x * face.up.y - face.right.y * face.up.x || 0,
      };
      expect(cross).toEqual(face.normal);
    });
  });

  it("reports malformed topology with explicit non-valid reasons", () => {
    const wrongCount = analyzeCubeNet(unitSquareNet([{ x: 0, y: 0 }]));
    expect(wrongCount).toMatchObject({ isCubeNet: false, reason: CUBE_NET_ANALYSIS_REASONS.cellCount });

    const disconnected = analyzeCubeNet(
      unitSquareNet([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 10, y: 0 },
        { x: 11, y: 0 },
        { x: 12, y: 0 },
      ]),
    );
    expect(disconnected).toMatchObject({
      connected: false,
      isCubeNet: false,
      reason: CUBE_NET_ANALYSIS_REASONS.disconnected,
    });

    const rectangle = analyzeCubeNet(
      unitSquareNet([
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ]),
    );
    expect(rectangle).toMatchObject({
      connected: true,
      isCubeNet: false,
      reason: CUBE_NET_ANALYSIS_REASONS.orientationConflict,
    });
  });
});
