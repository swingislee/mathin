import {
  parsePolyhedronHingeGraph,
  parsePolyhedronTopology,
  type PolyhedronHingeGraph,
  type PolyhedronTopology,
} from "./polyhedron-topology-schema";

export const POLYHEDRON_TOPOLOGY_KERNEL_VERSION = "polyhedron-topology-kernel-v1" as const;

export const POLYHEDRON_TOPOLOGY_ISSUE_CODES = {
  unknownEdgeVertex: "UNKNOWN_EDGE_VERTEX",
  unknownFaceVertex: "UNKNOWN_FACE_VERTEX",
  unusedVertex: "UNUSED_VERTEX",
  duplicateEdgeEndpoints: "DUPLICATE_EDGE_ENDPOINTS",
  duplicateFaceBoundary: "DUPLICATE_FACE_BOUNDARY",
  missingBoundaryEdge: "MISSING_BOUNDARY_EDGE",
  unusedEdge: "UNUSED_EDGE",
  edgeIncidence: "EDGE_INCIDENCE",
  windingConflict: "WINDING_CONFLICT",
  disconnected: "DISCONNECTED",
  vertexFan: "VERTEX_FAN",
  eulerCharacteristic: "EULER_CHARACTERISTIC",
} as const;

export type PolyhedronTopologyIssueCode =
  (typeof POLYHEDRON_TOPOLOGY_ISSUE_CODES)[keyof typeof POLYHEDRON_TOPOLOGY_ISSUE_CODES];

export interface PolyhedronTopologyIssue {
  readonly code: PolyhedronTopologyIssueCode;
  readonly subjectId: string;
  readonly relatedIds: readonly string[];
}

export interface PolyhedronEdgeAnalysis {
  readonly edgeId: string;
  readonly vertexIds: readonly [string, string];
  readonly faceIds: readonly string[];
}

export interface PolyhedronAdjacentFace {
  readonly faceId: string;
  readonly edgeId: string;
}

export interface PolyhedronFaceAnalysis {
  readonly faceId: string;
  readonly vertexIds: readonly string[];
  readonly adjacentFaces: readonly PolyhedronAdjacentFace[];
  /** Purely topological candidates sharing no vertex; geometry must confirm true parallel/opposite meaning. */
  readonly oppositeCandidateFaceIds: readonly string[];
}

export interface PolyhedronTopologyAnalysis {
  readonly kernelVersion: typeof POLYHEDRON_TOPOLOGY_KERNEL_VERSION;
  readonly topologyId: string;
  readonly validClosedOrientableSphere: boolean;
  readonly eulerCharacteristic: number;
  readonly issues: readonly PolyhedronTopologyIssue[];
  readonly edges: readonly PolyhedronEdgeAnalysis[];
  readonly faces: readonly PolyhedronFaceAnalysis[];
}

interface EdgeIncidence {
  readonly faceId: string;
  readonly fromVertexId: string;
  readonly toVertexId: string;
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function undirectedEdgeKey(left: string, right: string): string {
  return compareStableIds(left, right) <= 0 ? `${left}|${right}` : `${right}|${left}`;
}

function canonicalFaceBoundary(vertexIds: readonly string[]): string {
  const candidates: string[] = [];
  const reversed = [...vertexIds].reverse();
  for (const sequence of [vertexIds, reversed]) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      candidates.push([...sequence.slice(offset), ...sequence.slice(0, offset)].join("|"));
    }
  }
  return candidates.sort(compareStableIds)[0];
}

function connectedCount(startId: string, adjacency: ReadonlyMap<string, ReadonlySet<string>>): number {
  const visited = new Set<string>();
  const queue = [startId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return visited.size;
}

export function analyzePolyhedronTopology(input: unknown): PolyhedronTopologyAnalysis {
  const topology = parsePolyhedronTopology(input);
  const issues: PolyhedronTopologyIssue[] = [];
  const addIssue = (code: PolyhedronTopologyIssueCode, subjectId: string, relatedIds: readonly string[] = []) => {
    issues.push({ code, subjectId, relatedIds: [...relatedIds].sort(compareStableIds) });
  };
  const vertexIds = new Set(topology.vertices.map((vertex) => vertex.id));
  const usedVertexIds = new Set<string>();
  const edgeByBoundary = new Map<string, PolyhedronTopology["edges"][number]>();
  const incidenceByEdgeId = new Map<string, EdgeIncidence[]>(topology.edges.map((edge) => [edge.id, []]));

  topology.edges.forEach((edge) => {
    edge.vertexIds.forEach((vertexId) => {
      if (!vertexIds.has(vertexId)) addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unknownEdgeVertex, edge.id, [vertexId]);
    });
    const key = undirectedEdgeKey(edge.vertexIds[0], edge.vertexIds[1]);
    const duplicate = edgeByBoundary.get(key);
    if (duplicate) {
      addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.duplicateEdgeEndpoints, edge.id, [duplicate.id]);
    } else {
      edgeByBoundary.set(key, edge);
    }
  });

  const faceBoundaryOwner = new Map<string, string>();
  topology.faces.forEach((face) => {
    face.vertexIds.forEach((vertexId) => {
      if (!vertexIds.has(vertexId)) addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unknownFaceVertex, face.id, [vertexId]);
      else usedVertexIds.add(vertexId);
    });
    const boundaryKey = canonicalFaceBoundary(face.vertexIds);
    const duplicate = faceBoundaryOwner.get(boundaryKey);
    if (duplicate) addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.duplicateFaceBoundary, face.id, [duplicate]);
    else faceBoundaryOwner.set(boundaryKey, face.id);

    face.vertexIds.forEach((fromVertexId, vertexIndex) => {
      const toVertexId = face.vertexIds[(vertexIndex + 1) % face.vertexIds.length];
      const edge = edgeByBoundary.get(undirectedEdgeKey(fromVertexId, toVertexId));
      if (!edge) {
        addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.missingBoundaryEdge, face.id, [fromVertexId, toVertexId]);
        return;
      }
      incidenceByEdgeId.get(edge.id)?.push({ faceId: face.id, fromVertexId, toVertexId });
    });
  });

  topology.vertices.forEach((vertex) => {
    if (!usedVertexIds.has(vertex.id)) addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unusedVertex, vertex.id);
  });

  const faceAdjacency = new Map<string, Set<string>>(topology.faces.map((face) => [face.id, new Set()]));
  const adjacentDetails = new Map<string, PolyhedronAdjacentFace[]>(topology.faces.map((face) => [face.id, []]));
  const edgeAnalyses: PolyhedronEdgeAnalysis[] = [];
  topology.edges.forEach((edge) => {
    const incidences = incidenceByEdgeId.get(edge.id) ?? [];
    const faceIds = [...new Set(incidences.map((incidence) => incidence.faceId))].sort(compareStableIds);
    edgeAnalyses.push({ edgeId: edge.id, vertexIds: edge.vertexIds, faceIds });
    if (incidences.length === 0) addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.unusedEdge, edge.id);
    if (incidences.length !== 2 || faceIds.length !== 2) {
      addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.edgeIncidence, edge.id, faceIds);
      return;
    }
    const [left, right] = incidences;
    if (left.fromVertexId !== right.toVertexId || left.toVertexId !== right.fromVertexId) {
      addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.windingConflict, edge.id, faceIds);
    }
    faceAdjacency.get(left.faceId)?.add(right.faceId);
    faceAdjacency.get(right.faceId)?.add(left.faceId);
    adjacentDetails.get(left.faceId)?.push({ faceId: right.faceId, edgeId: edge.id });
    adjacentDetails.get(right.faceId)?.push({ faceId: left.faceId, edgeId: edge.id });
  });
  const edgeAnalysisById = new Map(edgeAnalyses.map((edge) => [edge.edgeId, edge]));

  const firstFaceId = topology.faces[0].id;
  if (connectedCount(firstFaceId, faceAdjacency) !== topology.faces.length) {
    addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.disconnected, topology.topologyId);
  }

  topology.vertices.forEach((vertex) => {
    const incidentFaces = topology.faces.filter((face) => face.vertexIds.includes(vertex.id)).map((face) => face.id);
    if (incidentFaces.length === 0) return;
    const link = new Map<string, Set<string>>(incidentFaces.map((faceId) => [faceId, new Set()]));
    topology.edges.forEach((edge) => {
      if (!edge.vertexIds.includes(vertex.id)) return;
      const edgeFaces = edgeAnalysisById.get(edge.id)?.faceIds ?? [];
      if (edgeFaces.length === 2) {
        link.get(edgeFaces[0])?.add(edgeFaces[1]);
        link.get(edgeFaces[1])?.add(edgeFaces[0]);
      }
    });
    const hasCycleDegree = incidentFaces.every((faceId) => link.get(faceId)?.size === 2);
    const linkConnected = connectedCount(incidentFaces[0], link) === incidentFaces.length;
    if (!hasCycleDegree || !linkConnected) {
      addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.vertexFan, vertex.id, incidentFaces);
    }
  });

  const eulerCharacteristic = topology.vertices.length - topology.edges.length + topology.faces.length;
  if (eulerCharacteristic !== 2) {
    addIssue(POLYHEDRON_TOPOLOGY_ISSUE_CODES.eulerCharacteristic, topology.topologyId);
  }

  const faceVertexSets = new Map(topology.faces.map((face) => [face.id, new Set(face.vertexIds)]));
  const faceAnalyses = topology.faces.map((face): PolyhedronFaceAnalysis => {
    const ownVertices = faceVertexSets.get(face.id) ?? new Set<string>();
    const oppositeCandidateFaceIds = topology.faces
      .filter((candidate) => candidate.id !== face.id)
      .filter((candidate) => candidate.vertexIds.every((vertexId) => !ownVertices.has(vertexId)))
      .map((candidate) => candidate.id)
      .sort(compareStableIds);
    return {
      faceId: face.id,
      vertexIds: face.vertexIds,
      adjacentFaces: (adjacentDetails.get(face.id) ?? []).sort(
        (left, right) => compareStableIds(left.faceId, right.faceId) || compareStableIds(left.edgeId, right.edgeId),
      ),
      oppositeCandidateFaceIds,
    };
  });

  return {
    kernelVersion: POLYHEDRON_TOPOLOGY_KERNEL_VERSION,
    topologyId: topology.topologyId,
    validClosedOrientableSphere: issues.length === 0,
    eulerCharacteristic,
    issues,
    edges: edgeAnalyses,
    faces: faceAnalyses,
  };
}

export const POLYHEDRON_HINGE_ISSUE_CODES = {
  topologyInvalid: "TOPOLOGY_INVALID",
  topologyIdMismatch: "TOPOLOGY_ID_MISMATCH",
  rootFaceMissing: "ROOT_FACE_MISSING",
  hingeEdgeMissing: "HINGE_EDGE_MISSING",
  hingeCount: "HINGE_COUNT",
  hingeCycle: "HINGE_CYCLE",
  hingeDisconnected: "HINGE_DISCONNECTED",
} as const;

export type PolyhedronHingeIssueCode =
  (typeof POLYHEDRON_HINGE_ISSUE_CODES)[keyof typeof POLYHEDRON_HINGE_ISSUE_CODES];

export interface PolyhedronHingeIssue {
  readonly code: PolyhedronHingeIssueCode;
  readonly subjectId: string;
}

export interface PolyhedronHingeTraversalStep {
  readonly faceId: string;
  readonly parentFaceId: string | null;
  readonly hingeEdgeId: string | null;
  readonly foldSense: PolyhedronHingeGraph["hinges"][number]["foldSense"] | null;
  readonly depth: number;
}

export interface PolyhedronHingeAnalysis {
  readonly kernelVersion: typeof POLYHEDRON_TOPOLOGY_KERNEL_VERSION;
  readonly topologyId: string;
  readonly validSpanningTree: boolean;
  readonly issues: readonly PolyhedronHingeIssue[];
  readonly traversal: readonly PolyhedronHingeTraversalStep[];
}

interface SelectedHingeNeighbor {
  readonly faceId: string;
  readonly edgeId: string;
  readonly foldSense: PolyhedronHingeGraph["hinges"][number]["foldSense"];
}

export function analyzePolyhedronHingeGraph(topologyInput: unknown, graphInput: unknown): PolyhedronHingeAnalysis {
  const topology = parsePolyhedronTopology(topologyInput);
  const graph = parsePolyhedronHingeGraph(graphInput);
  const topologyAnalysis = analyzePolyhedronTopology(topology);
  const issues: PolyhedronHingeIssue[] = [];
  const addIssue = (code: PolyhedronHingeIssueCode, subjectId: string) => issues.push({ code, subjectId });
  if (!topologyAnalysis.validClosedOrientableSphere) {
    addIssue(POLYHEDRON_HINGE_ISSUE_CODES.topologyInvalid, topology.topologyId);
    return {
      kernelVersion: POLYHEDRON_TOPOLOGY_KERNEL_VERSION,
      topologyId: topology.topologyId,
      validSpanningTree: false,
      issues,
      traversal: [],
    };
  }
  if (graph.topologyId !== topology.topologyId) {
    addIssue(POLYHEDRON_HINGE_ISSUE_CODES.topologyIdMismatch, graph.topologyId);
  }

  const faceIds = new Set(topology.faces.map((face) => face.id));
  if (!faceIds.has(graph.rootFaceId)) addIssue(POLYHEDRON_HINGE_ISSUE_CODES.rootFaceMissing, graph.rootFaceId);
  if (graph.hinges.length !== topology.faces.length - 1) {
    addIssue(POLYHEDRON_HINGE_ISSUE_CODES.hingeCount, graph.topologyId);
  }

  const edgeById = new Map(topologyAnalysis.edges.map((edge) => [edge.edgeId, edge]));
  const selectedAdjacency = new Map<string, SelectedHingeNeighbor[]>(topology.faces.map((face) => [face.id, []]));
  const parent = new Map(topology.faces.map((face) => [face.id, face.id]));
  const find = (faceId: string): string => {
    let root = faceId;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let current = faceId;
    while (parent.get(current) !== root) {
      const next = parent.get(current) ?? root;
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  graph.hinges.forEach((hinge) => {
    const edge = edgeById.get(hinge.edgeId);
    if (!edge || edge.faceIds.length !== 2) {
      addIssue(POLYHEDRON_HINGE_ISSUE_CODES.hingeEdgeMissing, hinge.edgeId);
      return;
    }
    const [leftFaceId, rightFaceId] = edge.faceIds;
    selectedAdjacency.get(leftFaceId)?.push({ faceId: rightFaceId, edgeId: edge.edgeId, foldSense: hinge.foldSense });
    selectedAdjacency.get(rightFaceId)?.push({ faceId: leftFaceId, edgeId: edge.edgeId, foldSense: hinge.foldSense });
    const leftRoot = find(leftFaceId);
    const rightRoot = find(rightFaceId);
    if (leftRoot === rightRoot) addIssue(POLYHEDRON_HINGE_ISSUE_CODES.hingeCycle, hinge.edgeId);
    else parent.set(rightRoot, leftRoot);
  });

  selectedAdjacency.forEach((neighbors) =>
    neighbors.sort((left, right) => compareStableIds(left.faceId, right.faceId) || compareStableIds(left.edgeId, right.edgeId)),
  );

  const traversal: PolyhedronHingeTraversalStep[] = [];
  if (faceIds.has(graph.rootFaceId)) {
    const visited = new Set([graph.rootFaceId]);
    traversal.push({ faceId: graph.rootFaceId, parentFaceId: null, hingeEdgeId: null, foldSense: null, depth: 0 });
    for (let cursor = 0; cursor < traversal.length; cursor += 1) {
      const step = traversal[cursor];
      for (const neighbor of selectedAdjacency.get(step.faceId) ?? []) {
        if (visited.has(neighbor.faceId)) continue;
        visited.add(neighbor.faceId);
        traversal.push({
          faceId: neighbor.faceId,
          parentFaceId: step.faceId,
          hingeEdgeId: neighbor.edgeId,
          foldSense: neighbor.foldSense,
          depth: step.depth + 1,
        });
      }
    }
    if (visited.size !== topology.faces.length) {
      addIssue(POLYHEDRON_HINGE_ISSUE_CODES.hingeDisconnected, graph.topologyId);
    }
  }

  return {
    kernelVersion: POLYHEDRON_TOPOLOGY_KERNEL_VERSION,
    topologyId: topology.topologyId,
    validSpanningTree: issues.length === 0,
    issues,
    traversal,
  };
}
