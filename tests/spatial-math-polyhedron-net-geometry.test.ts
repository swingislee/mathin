import { describe, expect, it } from "vitest";
import {
  POLYHEDRON_GEOMETRY_ISSUE_CODES,
  POLYHEDRON_GEOMETRY_VERSION,
  POLYHEDRON_HINGE_GRAPH_VERSION,
  POLYHEDRON_NET_LAYOUT_ISSUE_CODES,
  POLYHEDRON_NET_LAYOUT_VERSION,
  POLYHEDRON_TOPOLOGY_VERSION,
  analyzePolyhedronGeometry,
  analyzePolyhedronNetLayout,
  parsePolyhedronGeometry,
  parsePolyhedronHingeGraph,
  parsePolyhedronNetLayout,
  parsePolyhedronTopology,
  rational,
  type PolyhedronGeometry,
  type PolyhedronHingeGraph,
  type PolyhedronNetLayout,
  type PolyhedronTopology,
} from "@/features/spatial-math/domain";

interface FaceInput {
  readonly id: string;
  readonly vertexIds: readonly string[];
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function edgeVertices(left: string, right: string): [string, string] {
  return compareIds(left, right) <= 0 ? [left, right] : [right, left];
}

function edgeId(left: string, right: string): string {
  const [first, second] = edgeVertices(left, right);
  return `edge.${first}-${second}`;
}

function topologyFromFaces(
  topologyId: string,
  vertexIds: readonly string[],
  faceInputs: readonly FaceInput[],
): PolyhedronTopology {
  const edges = new Map<string, [string, string]>();
  faceInputs.forEach((face) => {
    face.vertexIds.forEach((vertexId, index) => {
      const next = face.vertexIds[(index + 1) % face.vertexIds.length];
      edges.set(edgeId(vertexId, next), edgeVertices(vertexId, next));
    });
  });
  return parsePolyhedronTopology({
    topologyVersion: POLYHEDRON_TOPOLOGY_VERSION,
    topologyId,
    vertices: [...vertexIds].sort(compareIds).map((id) => ({ id })),
    edges: [...edges.entries()]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([id, endpoints]) => ({ id, vertexIds: endpoints })),
    faces: [...faceInputs]
      .sort((left, right) => compareIds(left.id, right.id))
      .map((face) => ({ id: face.id, vertexIds: [...face.vertexIds] })),
  });
}

function cubeTopology(): PolyhedronTopology {
  return topologyFromFaces(
    "topology.cube",
    ["v000", "v001", "v010", "v011", "v100", "v101", "v110", "v111"],
    [
      { id: "face.x.neg", vertexIds: ["v000", "v001", "v011", "v010"] },
      { id: "face.x.pos", vertexIds: ["v100", "v110", "v111", "v101"] },
      { id: "face.y.neg", vertexIds: ["v000", "v100", "v101", "v001"] },
      { id: "face.y.pos", vertexIds: ["v010", "v011", "v111", "v110"] },
      { id: "face.z.neg", vertexIds: ["v000", "v010", "v110", "v100"] },
      { id: "face.z.pos", vertexIds: ["v001", "v101", "v111", "v011"] },
    ],
  );
}

const CUBE_HINGE_EDGE_IDS = [
  edgeId("v001", "v011"),
  edgeId("v001", "v101"),
  edgeId("v011", "v111"),
  edgeId("v100", "v110"),
  edgeId("v101", "v111"),
].sort(compareIds);

function cubeHingeGraph(mountainEdgeId: string | null = null): PolyhedronHingeGraph {
  return parsePolyhedronHingeGraph({
    hingeVersion: POLYHEDRON_HINGE_GRAPH_VERSION,
    topologyId: "topology.cube",
    rootFaceId: "face.z.pos",
    hinges: CUBE_HINGE_EDGE_IDS.map((selectedEdgeId) => ({
      edgeId: selectedEdgeId,
      foldSense: selectedEdgeId === mountainEdgeId ? "mountain" : "valley",
    })),
  });
}

function cubeGeometry(): PolyhedronGeometry {
  return parsePolyhedronGeometry({
    geometryVersion: POLYHEDRON_GEOMETRY_VERSION,
    topologyId: "topology.cube",
    vertices: ["v000", "v001", "v010", "v011", "v100", "v101", "v110", "v111"].map((vertexId) => ({
      vertexId,
      position: {
        x: rational(Number(vertexId[1])),
        y: rational(Number(vertexId[2])),
        z: rational(Number(vertexId[3])),
      },
    })),
  });
}

function face(
  faceId: string,
  entries: readonly (readonly [vertexId: string, x: number, y: number])[],
): PolyhedronNetLayout["faces"][number] {
  return { faceId, vertices: entries.map(([vertexId, x, y]) => ({ vertexId, position: { x, y } })) };
}

function cubeNetLayout(): PolyhedronNetLayout {
  return parsePolyhedronNetLayout({
    layoutVersion: POLYHEDRON_NET_LAYOUT_VERSION,
    topologyId: "topology.cube",
    rootFaceId: "face.z.pos",
    faces: [
      face("face.x.neg", [
        ["v000", -2, 0],
        ["v001", 0, 0],
        ["v011", 0, 2],
        ["v010", -2, 2],
      ]),
      face("face.x.pos", [
        ["v100", 4, 0],
        ["v110", 4, 2],
        ["v111", 2, 2],
        ["v101", 2, 0],
      ]),
      face("face.y.neg", [
        ["v000", 0, -2],
        ["v100", 2, -2],
        ["v101", 2, 0],
        ["v001", 0, 0],
      ]),
      face("face.y.pos", [
        ["v010", 0, 4],
        ["v011", 0, 2],
        ["v111", 2, 2],
        ["v110", 2, 4],
      ]),
      face("face.z.neg", [
        ["v000", 6, 0],
        ["v010", 6, 2],
        ["v110", 4, 2],
        ["v100", 4, 0],
      ]),
      face("face.z.pos", [
        ["v001", 0, 0],
        ["v101", 2, 0],
        ["v111", 2, 2],
        ["v011", 0, 2],
      ]),
    ],
    foldTargets: CUBE_HINGE_EDGE_IDS.map((selectedEdgeId) => ({
      edgeId: selectedEdgeId,
      targetAngleMicrodegrees: 90_000_000,
    })),
  });
}

function replaceFace(
  layout: PolyhedronNetLayout,
  faceId: string,
  replacement: PolyhedronNetLayout["faces"][number],
): PolyhedronNetLayout {
  return parsePolyhedronNetLayout({
    ...layout,
    faces: layout.faces.map((candidate) => (candidate.faceId === faceId ? replacement : candidate)),
  });
}

function geometryIssueCodes(result: ReturnType<typeof analyzePolyhedronGeometry>): Set<string> {
  return new Set(result.issues.map((issue) => issue.code));
}

function layoutIssueCodes(result: ReturnType<typeof analyzePolyhedronNetLayout>): Set<string> {
  return new Set(result.issues.map((issue) => issue.code));
}

describe("polyhedron geometry and net layout schemas", () => {
  it("accepts canonical strict documents and rejects unstable order, unknown fields and unsafe folds", () => {
    const geometry = cubeGeometry();
    const layout = cubeNetLayout();

    expect(parsePolyhedronGeometry(geometry)).toEqual(geometry);
    expect(parsePolyhedronNetLayout(layout)).toEqual(layout);
    expect(() => parsePolyhedronGeometry({ ...geometry, unexpected: true })).toThrow();
    expect(() =>
      parsePolyhedronGeometry({ ...geometry, vertices: [geometry.vertices[1], geometry.vertices[0], ...geometry.vertices.slice(2)] }),
    ).toThrow();
    expect(() => parsePolyhedronNetLayout({ ...layout, faces: [...layout.faces].reverse() })).toThrow();
    expect(() => parsePolyhedronNetLayout({ ...layout, foldTargets: [...layout.foldTargets].reverse() })).toThrow();
    expect(() =>
      parsePolyhedronNetLayout({
        ...layout,
        foldTargets: layout.foldTargets.map((fold, index) =>
          index === 0 ? { ...fold, targetAngleMicrodegrees: 180_000_000 } : fold,
        ),
      }),
    ).toThrow();
  });
});

describe("polyhedron-geometry-v1 exact analysis", () => {
  it("derives exact outward face normals and confirms the cube's three opposite pairs", () => {
    const result = analyzePolyhedronGeometry(cubeTopology(), cubeGeometry());

    expect(result.validGeometry).toBe(true);
    expect(result.issues).toEqual([]);
    expect(new Map(result.faces.map((candidate) => [candidate.faceId, candidate.normalDirection]))).toEqual(
      new Map([
        ["face.x.neg", ["-1", "0", "0"]],
        ["face.x.pos", ["1", "0", "0"]],
        ["face.y.neg", ["0", "-1", "0"]],
        ["face.y.pos", ["0", "1", "0"]],
        ["face.z.neg", ["0", "0", "-1"]],
        ["face.z.pos", ["0", "0", "1"]],
      ]),
    );
    expect(new Map(result.faces.map((candidate) => [candidate.faceId, candidate.confirmedOppositeFaceIds]))).toEqual(
      new Map([
        ["face.x.neg", ["face.x.pos"]],
        ["face.x.pos", ["face.x.neg"]],
        ["face.y.neg", ["face.y.pos"]],
        ["face.y.pos", ["face.y.neg"]],
        ["face.z.neg", ["face.z.pos"]],
        ["face.z.pos", ["face.z.neg"]],
      ]),
    );
  });

  it("reports mismatched identity, missing/unknown/coincident vertices and non-planar faces", () => {
    const topology = cubeTopology();
    const geometry = cubeGeometry();
    const missingAndUnknown = parsePolyhedronGeometry({
      ...geometry,
      vertices: [
        ...geometry.vertices.filter((vertex) => vertex.vertexId !== "v111"),
        { vertexId: "v999", position: { x: rational(2), y: rational(2), z: rational(2) } },
      ],
    });
    expect(geometryIssueCodes(analyzePolyhedronGeometry(topology, missingAndUnknown))).toEqual(
      new Set([
        POLYHEDRON_GEOMETRY_ISSUE_CODES.missingVertexPosition,
        POLYHEDRON_GEOMETRY_ISSUE_CODES.unknownVertexPosition,
      ]),
    );

    const coincident = parsePolyhedronGeometry({
      ...geometry,
      vertices: geometry.vertices.map((vertex) =>
        vertex.vertexId === "v111"
          ? { ...vertex, position: geometry.vertices.find((candidate) => candidate.vertexId === "v110")?.position }
          : vertex,
      ),
    });
    expect(geometryIssueCodes(analyzePolyhedronGeometry(topology, coincident))).toContain(
      POLYHEDRON_GEOMETRY_ISSUE_CODES.coincidentVertexPosition,
    );

    const nonPlanar = parsePolyhedronGeometry({
      ...geometry,
      vertices: geometry.vertices.map((vertex) =>
        vertex.vertexId === "v111" ? { ...vertex, position: { ...vertex.position, z: rational(2) } } : vertex,
      ),
    });
    expect(geometryIssueCodes(analyzePolyhedronGeometry(topology, nonPlanar))).toContain(
      POLYHEDRON_GEOMETRY_ISSUE_CODES.faceNonPlanar,
    );
    expect(
      geometryIssueCodes(
        analyzePolyhedronGeometry(topology, parsePolyhedronGeometry({ ...geometry, topologyId: "topology.other" })),
      ),
    ).toContain(POLYHEDRON_GEOMETRY_ISSUE_CODES.topologyIdMismatch);
  });
});

describe("polyhedron-net-layout-v1 exact analysis", () => {
  it("accepts a non-overlapping cube cross and emits a deterministic breadth-first fold program", () => {
    const topology = cubeTopology();
    const hingeGraph = cubeHingeGraph();
    const layout = cubeNetLayout();
    const first = analyzePolyhedronNetLayout(topology, hingeGraph, layout);
    const second = analyzePolyhedronNetLayout(topology, hingeGraph, layout);

    expect(first).toEqual(second);
    expect(first.validPlanarNet).toBe(true);
    expect(first.issues).toEqual([]);
    expect(first.faces).toHaveLength(6);
    expect(first.faces.every((candidate) => candidate.signedDoubleArea === "8")).toBe(true);
    expect(first.foldProgram.map((instruction) => instruction.faceId)).toEqual([
      "face.x.neg",
      "face.x.pos",
      "face.y.neg",
      "face.y.pos",
      "face.z.neg",
    ]);
    expect(first.foldProgram.every((instruction) => instruction.signedTargetAngleMicrodegrees === 90_000_000)).toBe(true);
    expect(first.foldProgram.every((instruction) => instruction.progressRule === "linear-angle")).toBe(true);
  });

  it("keeps fold sense semantic by negating only mountain target angles", () => {
    const mountainEdge = edgeId("v001", "v011");
    const result = analyzePolyhedronNetLayout(cubeTopology(), cubeHingeGraph(mountainEdge), cubeNetLayout());
    const mountainInstruction = result.foldProgram.find((instruction) => instruction.hingeEdgeId === mountainEdge);

    expect(result.validPlanarNet).toBe(true);
    expect(mountainInstruction?.signedTargetAngleMicrodegrees).toBe(-90_000_000);
    expect(
      result.foldProgram
        .filter((instruction) => instruction.hingeEdgeId !== mountainEdge)
        .every((instruction) => instruction.signedTargetAngleMicrodegrees === 90_000_000),
    ).toBe(true);
  });

  it("rejects face self-intersection, cross-face interior overlap and non-hinge boundary overlap", () => {
    const topology = cubeTopology();
    const hinges = cubeHingeGraph();
    const layout = cubeNetLayout();

    const selfIntersecting = replaceFace(
      layout,
      "face.z.pos",
      face("face.z.pos", [
        ["v001", 0, 0],
        ["v101", 2, 2],
        ["v111", 0, 2],
        ["v011", 2, 0],
      ]),
    );
    expect(layoutIssueCodes(analyzePolyhedronNetLayout(topology, hinges, selfIntersecting))).toContain(
      POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceSelfIntersection,
    );

    const overlapping = replaceFace(
      layout,
      "face.z.neg",
      face("face.z.neg", [
        ["v000", 3, -1],
        ["v010", 5, 1],
        ["v110", 3, 3],
        ["v100", 1, 1],
      ]),
    );
    expect(layoutIssueCodes(analyzePolyhedronNetLayout(topology, hinges, overlapping))).toContain(
      POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceInteriorOverlap,
    );

    const coincidentBoundary = replaceFace(
      layout,
      "face.z.neg",
      face("face.z.neg", [
        ["v000", 0, 0],
        ["v010", 2, 0],
        ["v110", 2, 2],
        ["v100", 0, 2],
      ]),
    );
    expect(layoutIssueCodes(analyzePolyhedronNetLayout(topology, hinges, coincidentBoundary))).toContain(
      POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceBoundaryOverlap,
    );
  });

  it("rejects semantic coverage, face cycles, hinge coordinates, roots and fold targets that drift", () => {
    const topology = cubeTopology();
    const hinges = cubeHingeGraph();
    const layout = cubeNetLayout();
    const missingFace = parsePolyhedronNetLayout({ ...layout, faces: layout.faces.slice(1) });
    expect(layoutIssueCodes(analyzePolyhedronNetLayout(topology, hinges, missingFace))).toContain(
      POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceCoverage,
    );

    const wrongCycle = replaceFace(
      layout,
      "face.z.pos",
      face("face.z.pos", [
        ["v001", 0, 0],
        ["v010", 2, 0],
        ["v111", 2, 2],
        ["v011", 0, 2],
      ]),
    );
    expect(layoutIssueCodes(analyzePolyhedronNetLayout(topology, hinges, wrongCycle))).toContain(
      POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceVertexMismatch,
    );

    const misalignedHinge = replaceFace(
      layout,
      "face.y.neg",
      face("face.y.neg", [
        ["v000", 0, -2],
        ["v100", 2, -2],
        ["v101", 2, 0],
        ["v001", -1, 0],
      ]),
    );
    expect(layoutIssueCodes(analyzePolyhedronNetLayout(topology, hinges, misalignedHinge))).toContain(
      POLYHEDRON_NET_LAYOUT_ISSUE_CODES.hingeAlignment,
    );

    expect(
      layoutIssueCodes(
        analyzePolyhedronNetLayout(
          topology,
          hinges,
          parsePolyhedronNetLayout({ ...layout, rootFaceId: "face.x.neg" }),
        ),
      ),
    ).toContain(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.rootFaceMismatch);
    expect(
      layoutIssueCodes(
        analyzePolyhedronNetLayout(
          topology,
          hinges,
          parsePolyhedronNetLayout({ ...layout, foldTargets: layout.foldTargets.slice(1) }),
        ),
      ),
    ).toContain(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.foldCoverage);
  });
});
