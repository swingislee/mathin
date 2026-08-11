import {
  POLYHEDRON_GEOMETRY_VERSION,
  POLYHEDRON_HINGE_GRAPH_VERSION,
  POLYHEDRON_NET_LAYOUT_VERSION,
  POLYHEDRON_TOPOLOGY_VERSION,
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

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function edgeVertices(left: string, right: string): [string, string] {
  return compareIds(left, right) <= 0 ? [left, right] : [right, left];
}

export function cubeEdgeId(left: string, right: string): string {
  const [first, second] = edgeVertices(left, right);
  return `edge.${first}-${second}`;
}

export const CUBE_HINGE_EDGE_IDS = [
  cubeEdgeId("v001", "v011"),
  cubeEdgeId("v001", "v101"),
  cubeEdgeId("v011", "v111"),
  cubeEdgeId("v100", "v110"),
  cubeEdgeId("v101", "v111"),
].sort(compareIds);

const CUBE_FOLD_SENSE_BY_EDGE_ID = new Map<string, "mountain" | "valley">([
  [cubeEdgeId("v001", "v011"), "mountain"],
  [cubeEdgeId("v001", "v101"), "valley"],
  [cubeEdgeId("v011", "v111"), "mountain"],
  [cubeEdgeId("v100", "v110"), "valley"],
  [cubeEdgeId("v101", "v111"), "valley"],
]);

export function cubeTopology(): PolyhedronTopology {
  const faceInputs = [
    { id: "face.x.neg", vertexIds: ["v000", "v001", "v011", "v010"] },
    { id: "face.x.pos", vertexIds: ["v100", "v110", "v111", "v101"] },
    { id: "face.y.neg", vertexIds: ["v000", "v100", "v101", "v001"] },
    { id: "face.y.pos", vertexIds: ["v010", "v011", "v111", "v110"] },
    { id: "face.z.neg", vertexIds: ["v000", "v010", "v110", "v100"] },
    { id: "face.z.pos", vertexIds: ["v001", "v101", "v111", "v011"] },
  ];
  const edges = new Map<string, [string, string]>();
  faceInputs.forEach((face) => {
    face.vertexIds.forEach((vertexId, index) => {
      const next = face.vertexIds[(index + 1) % face.vertexIds.length];
      edges.set(cubeEdgeId(vertexId, next), edgeVertices(vertexId, next));
    });
  });
  return parsePolyhedronTopology({
    topologyVersion: POLYHEDRON_TOPOLOGY_VERSION,
    topologyId: "topology.cube",
    vertices: ["v000", "v001", "v010", "v011", "v100", "v101", "v110", "v111"].map((id) => ({ id })),
    edges: [...edges.entries()]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([id, vertexIds]) => ({ id, vertexIds })),
    faces: faceInputs.sort((left, right) => compareIds(left.id, right.id)),
  });
}

export function cubeGeometry(): PolyhedronGeometry {
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

export function cubeHingeGraph(
  options: { readonly allMountain?: boolean; readonly allValley?: boolean } = {},
): PolyhedronHingeGraph {
  return parsePolyhedronHingeGraph({
    hingeVersion: POLYHEDRON_HINGE_GRAPH_VERSION,
    topologyId: "topology.cube",
    rootFaceId: "face.z.pos",
    hinges: CUBE_HINGE_EDGE_IDS.map((edgeId) => ({
      edgeId,
      foldSense: options.allMountain
        ? "mountain"
        : options.allValley
          ? "valley"
          : CUBE_FOLD_SENSE_BY_EDGE_ID.get(edgeId),
    })),
  });
}

function face(
  faceId: string,
  entries: readonly (readonly [vertexId: string, x: number, y: number])[],
): PolyhedronNetLayout["faces"][number] {
  return { faceId, vertices: entries.map(([vertexId, x, y]) => ({ vertexId, position: { x, y } })) };
}

export function cubeUnitNetLayout(targetAngleMicrodegrees = 90_000_000): PolyhedronNetLayout {
  return parsePolyhedronNetLayout({
    layoutVersion: POLYHEDRON_NET_LAYOUT_VERSION,
    topologyId: "topology.cube",
    rootFaceId: "face.z.pos",
    faces: [
      face("face.x.neg", [
        ["v000", -1, 0],
        ["v001", 0, 0],
        ["v011", 0, 1],
        ["v010", -1, 1],
      ]),
      face("face.x.pos", [
        ["v100", 2, 0],
        ["v110", 2, 1],
        ["v111", 1, 1],
        ["v101", 1, 0],
      ]),
      face("face.y.neg", [
        ["v000", 0, -1],
        ["v100", 1, -1],
        ["v101", 1, 0],
        ["v001", 0, 0],
      ]),
      face("face.y.pos", [
        ["v010", 0, 2],
        ["v011", 0, 1],
        ["v111", 1, 1],
        ["v110", 1, 2],
      ]),
      face("face.z.neg", [
        ["v000", 3, 0],
        ["v010", 3, 1],
        ["v110", 2, 1],
        ["v100", 2, 0],
      ]),
      face("face.z.pos", [
        ["v001", 0, 0],
        ["v101", 1, 0],
        ["v111", 1, 1],
        ["v011", 0, 1],
      ]),
    ],
    foldTargets: CUBE_HINGE_EDGE_IDS.map((edgeId) => ({ edgeId, targetAngleMicrodegrees })),
  });
}
