import { describe, expect, it } from "vitest";
import {
  POLYHEDRON_HINGE_GRAPH_VERSION,
  POLYHEDRON_HINGE_ISSUE_CODES,
  POLYHEDRON_TOPOLOGY_ISSUE_CODES,
  POLYHEDRON_TOPOLOGY_VERSION,
  analyzePolyhedronHingeGraph,
  analyzePolyhedronTopology,
  parsePolyhedronHingeGraph,
  parsePolyhedronTopology,
  type PolyhedronHingeGraph,
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

function topologyFromFaces(topologyId: string, vertexIds: readonly string[], faceInputs: readonly FaceInput[]): PolyhedronTopology {
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

function tetrahedronTopology(prefix = ""): PolyhedronTopology {
  const vertex = (id: number) => `${prefix}v${id}`;
  return topologyFromFaces(
    `${prefix}topology.tetrahedron`,
    [vertex(0), vertex(1), vertex(2), vertex(3)],
    [
      { id: `${prefix}face.0`, vertexIds: [vertex(0), vertex(2), vertex(1)] },
      { id: `${prefix}face.1`, vertexIds: [vertex(0), vertex(1), vertex(3)] },
      { id: `${prefix}face.2`, vertexIds: [vertex(0), vertex(3), vertex(2)] },
      { id: `${prefix}face.3`, vertexIds: [vertex(1), vertex(2), vertex(3)] },
    ],
  );
}

function hingeGraph(
  topology: PolyhedronTopology,
  rootFaceId: string,
  edgeIds: readonly string[],
  topologyId = topology.topologyId,
): PolyhedronHingeGraph {
  return parsePolyhedronHingeGraph({
    hingeVersion: POLYHEDRON_HINGE_GRAPH_VERSION,
    topologyId,
    rootFaceId,
    hinges: [...edgeIds].sort(compareIds).map((selectedEdgeId) => ({ edgeId: selectedEdgeId, foldSense: "valley" })),
  });
}

function issueCodes(result: ReturnType<typeof analyzePolyhedronTopology>): Set<string> {
  return new Set(result.issues.map((issue) => issue.code));
}

describe("polyhedron-topology-v1 schema", () => {
  it("requires strict stable identities, ordered edge endpoints and unique face cycles", () => {
    const cube = cubeTopology();
    expect(parsePolyhedronTopology(cube)).toEqual(cube);
    expect(() => parsePolyhedronTopology({ ...cube, unexpected: true })).toThrow();
    expect(() => parsePolyhedronTopology({ ...cube, vertices: [cube.vertices[1], cube.vertices[0], ...cube.vertices.slice(2)] })).toThrow();
    expect(() =>
      parsePolyhedronTopology({
        ...cube,
        edges: cube.edges.map((edge, index) =>
          index === 0 ? { ...edge, vertexIds: [edge.vertexIds[1], edge.vertexIds[0]] } : edge,
        ),
      }),
    ).toThrow();
    expect(() =>
      parsePolyhedronTopology({
        ...cube,
        faces: cube.faces.map((face, index) =>
          index === 0 ? { ...face, vertexIds: [face.vertexIds[0], face.vertexIds[1], face.vertexIds[1]] } : face,
        ),
      }),
    ).toThrow();
  });

  it("requires strict unique stable hinge edges", () => {
    const cube = cubeTopology();
    const valid = hingeGraph(cube, "face.z.pos", [
      edgeId("v001", "v011"),
      edgeId("v001", "v101"),
      edgeId("v011", "v111"),
      edgeId("v100", "v110"),
      edgeId("v101", "v111"),
    ]);
    expect(parsePolyhedronHingeGraph(valid)).toEqual(valid);
    expect(() => parsePolyhedronHingeGraph({ ...valid, unexpected: true })).toThrow();
    expect(() => parsePolyhedronHingeGraph({ ...valid, hinges: [valid.hinges[0], valid.hinges[0]] })).toThrow();
    expect(() => parsePolyhedronHingeGraph({ ...valid, hinges: [...valid.hinges].reverse() })).toThrow();
  });
});

describe("polyhedron-topology-kernel-v1 closed shell analysis", () => {
  it("derives the cube's 12 edges, four neighbors and one opposite candidate per face", () => {
    const result = analyzePolyhedronTopology(cubeTopology());

    expect(result).toMatchObject({
      topologyId: "topology.cube",
      validClosedOrientableSphere: true,
      eulerCharacteristic: 2,
      issues: [],
    });
    expect(result.edges).toHaveLength(12);
    expect(result.edges.every((edge) => edge.faceIds.length === 2)).toBe(true);
    const oppositePairs = new Map([
      ["face.x.neg", "face.x.pos"],
      ["face.x.pos", "face.x.neg"],
      ["face.y.neg", "face.y.pos"],
      ["face.y.pos", "face.y.neg"],
      ["face.z.neg", "face.z.pos"],
      ["face.z.pos", "face.z.neg"],
    ]);
    result.faces.forEach((face) => {
      expect(face.adjacentFaces).toHaveLength(4);
      expect(face.oppositeCandidateFaceIds).toEqual([oppositePairs.get(face.faceId)]);
      const opposite = result.faces.find((candidate) => candidate.faceId === face.oppositeCandidateFaceIds[0]);
      expect(opposite?.oppositeCandidateFaceIds).toContain(face.faceId);
    });
  });

  it("accepts a tetrahedron and does not invent an opposite face", () => {
    const result = analyzePolyhedronTopology(tetrahedronTopology());
    expect(result.validClosedOrientableSphere).toBe(true);
    expect(result.eulerCharacteristic).toBe(2);
    expect(result.edges).toHaveLength(6);
    expect(result.faces.every((face) => face.adjacentFaces.length === 3)).toBe(true);
    expect(result.faces.every((face) => face.oppositeCandidateFaceIds.length === 0)).toBe(true);
  });

  it("detects inconsistent face winding", () => {
    const cube = structuredClone(cubeTopology());
    const face = cube.faces.find((candidate) => candidate.id === "face.x.pos");
    if (!face) throw new Error("cube fixture is missing face.x.pos");
    face.vertexIds.reverse();
    const result = analyzePolyhedronTopology(cube);
    expect(result.validClosedOrientableSphere).toBe(false);
    expect(issueCodes(result)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.windingConflict);
  });

  it("detects open shells, duplicate faces, missing boundaries and unused vertices", () => {
    const cube = cubeTopology();
    const open = analyzePolyhedronTopology({ ...cube, faces: cube.faces.filter((face) => face.id !== "face.z.pos") });
    expect(issueCodes(open)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.edgeIncidence);
    expect(issueCodes(open)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.vertexFan);
    expect(issueCodes(open)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.eulerCharacteristic);

    const duplicateFace = { ...cube.faces[0], id: "face.zzz" };
    const duplicate = analyzePolyhedronTopology({ ...cube, faces: [...cube.faces, duplicateFace] });
    expect(issueCodes(duplicate)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.duplicateFaceBoundary);

    const missingEdge = analyzePolyhedronTopology({ ...cube, edges: cube.edges.slice(1) });
    expect(issueCodes(missingEdge)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.missingBoundaryEdge);

    const unusedVertex = analyzePolyhedronTopology({
      ...cube,
      vertices: [...cube.vertices, { id: "v999" }],
    });
    expect(issueCodes(unusedVertex)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unusedVertex);

    const duplicateEdge = analyzePolyhedronTopology({
      ...cube,
      edges: [...cube.edges, { id: "edge.zzz", vertexIds: cube.edges[0].vertexIds }],
    });
    expect(issueCodes(duplicateEdge)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.duplicateEdgeEndpoints);
    expect(issueCodes(duplicateEdge)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unusedEdge);

    const unusedEdge = analyzePolyhedronTopology({
      ...cube,
      edges: [{ id: "edge.diagonal", vertexIds: ["v000", "v111"] }, ...cube.edges],
    });
    expect(issueCodes(unusedEdge)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unusedEdge);
  });

  it("reports unknown vertex references without silently dropping them", () => {
    const cube = cubeTopology();
    const unknownEdgeVertex = analyzePolyhedronTopology({
      ...cube,
      edges: [{ id: "edge.unknown", vertexIds: ["v000", "v999"] }, ...cube.edges],
    });
    expect(issueCodes(unknownEdgeVertex)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unknownEdgeVertex);

    const faces = structuredClone(cube.faces);
    faces[0].vertexIds[0] = "v999";
    const unknownFaceVertex = analyzePolyhedronTopology({ ...cube, faces });
    expect(issueCodes(unknownFaceVertex)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unknownFaceVertex);
  });

  it("detects disconnected closed shells", () => {
    const left = tetrahedronTopology("a.");
    const right = tetrahedronTopology("b.");
    const combined = parsePolyhedronTopology({
      topologyVersion: POLYHEDRON_TOPOLOGY_VERSION,
      topologyId: "topology.disconnected",
      vertices: [...left.vertices, ...right.vertices],
      edges: [...left.edges, ...right.edges],
      faces: [...left.faces, ...right.faces],
    });
    const result = analyzePolyhedronTopology(combined);
    expect(result.validClosedOrientableSphere).toBe(false);
    expect(issueCodes(result)).toContain(POLYHEDRON_TOPOLOGY_ISSUE_CODES.disconnected);
    expect(result.eulerCharacteristic).toBe(4);
  });
});

describe("polyhedron-hinge-graph-v1", () => {
  it("accepts a five-hinge cube spanning tree and derives deterministic fold order", () => {
    const cube = cubeTopology();
    const graph = hingeGraph(cube, "face.z.pos", [
      edgeId("v001", "v011"),
      edgeId("v001", "v101"),
      edgeId("v011", "v111"),
      edgeId("v100", "v110"),
      edgeId("v101", "v111"),
    ]);
    const result = analyzePolyhedronHingeGraph(cube, graph);

    expect(result.validSpanningTree).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.traversal).toHaveLength(6);
    expect(result.traversal[0]).toEqual({
      faceId: "face.z.pos",
      parentFaceId: null,
      hingeEdgeId: null,
      foldSense: null,
      depth: 0,
    });
    expect(new Set(result.traversal.map((step) => step.faceId)).size).toBe(6);
    expect(result.traversal.slice(1).every((step) => step.parentFaceId && step.hingeEdgeId && step.foldSense === "valley")).toBe(
      true,
    );
  });

  it("rejects cyclic/disconnected, incomplete, unknown and mismatched hinge graphs", () => {
    const cube = cubeTopology();
    const cyclic = hingeGraph(cube, "face.z.pos", [
      edgeId("v000", "v010"),
      edgeId("v001", "v011"),
      edgeId("v001", "v101"),
      edgeId("v100", "v110"),
      edgeId("v101", "v111"),
    ]);
    const cyclicResult = analyzePolyhedronHingeGraph(cube, cyclic);
    expect(new Set(cyclicResult.issues.map((issue) => issue.code))).toEqual(
      new Set([POLYHEDRON_HINGE_ISSUE_CODES.hingeCycle, POLYHEDRON_HINGE_ISSUE_CODES.hingeDisconnected]),
    );

    const incomplete = hingeGraph(cube, "face.z.pos", cyclic.hinges.slice(0, 4).map((hinge) => hinge.edgeId));
    const incompleteCodes = new Set(analyzePolyhedronHingeGraph(cube, incomplete).issues.map((issue) => issue.code));
    expect(incompleteCodes).toContain(POLYHEDRON_HINGE_ISSUE_CODES.hingeCount);
    expect(incompleteCodes).toContain(POLYHEDRON_HINGE_ISSUE_CODES.hingeDisconnected);

    const unknown = hingeGraph(cube, "face.z.pos", [...cyclic.hinges.slice(0, 4).map((hinge) => hinge.edgeId), "edge.unknown"]);
    expect(new Set(analyzePolyhedronHingeGraph(cube, unknown).issues.map((issue) => issue.code))).toContain(
      POLYHEDRON_HINGE_ISSUE_CODES.hingeEdgeMissing,
    );

    const mismatched = hingeGraph(cube, "face.z.pos", cyclic.hinges.map((hinge) => hinge.edgeId), "topology.other");
    expect(new Set(analyzePolyhedronHingeGraph(cube, mismatched).issues.map((issue) => issue.code))).toContain(
      POLYHEDRON_HINGE_ISSUE_CODES.topologyIdMismatch,
    );
  });

  it("refuses hinge traversal when the target shell is invalid", () => {
    const cube = cubeTopology();
    const invalid = { ...cube, faces: cube.faces.filter((face) => face.id !== "face.z.pos") };
    const graph = hingeGraph(cube, "face.z.neg", [
      edgeId("v000", "v001"),
      edgeId("v000", "v010"),
      edgeId("v000", "v100"),
      edgeId("v100", "v110"),
    ]);
    expect(analyzePolyhedronHingeGraph(invalid, graph)).toMatchObject({
      validSpanningTree: false,
      traversal: [],
      issues: [{ code: POLYHEDRON_HINGE_ISSUE_CODES.topologyInvalid }],
    });
  });
});
