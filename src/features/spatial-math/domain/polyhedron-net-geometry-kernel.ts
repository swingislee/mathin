import type { ExactVector3, Rational } from "./exact";
import {
  parsePolyhedronGeometry,
  parsePolyhedronNetLayout,
  type ExactPlanarPoint,
  type PolyhedronNetLayout,
} from "./polyhedron-net-geometry-schema";
import {
  analyzePolyhedronHingeGraph,
  analyzePolyhedronTopology,
} from "./polyhedron-topology-kernel";
import {
  parsePolyhedronHingeGraph,
  parsePolyhedronTopology,
} from "./polyhedron-topology-schema";

export const POLYHEDRON_NET_GEOMETRY_KERNEL_VERSION = "polyhedron-net-geometry-kernel-v1" as const;

interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface FractionVector3 {
  readonly x: Fraction;
  readonly y: Fraction;
  readonly z: Fraction;
}

function bigintAbs(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
}

function bigintGcd(left: bigint, right: bigint): bigint {
  let a = bigintAbs(left);
  let b = bigintAbs(right);
  while (b !== BigInt(0)) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (numerator === BigInt(0)) return { numerator: BigInt(0), denominator: BigInt(1) };
  const sign = denominator < BigInt(0) ? BigInt(-1) : BigInt(1);
  const divisor = bigintGcd(numerator, denominator);
  return { numerator: (numerator / divisor) * sign, denominator: (denominator / divisor) * sign };
}

function fromRational(value: Rational): Fraction {
  return { numerator: BigInt(value.numerator), denominator: BigInt(value.denominator) };
}

function fractionSubtract(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function fractionAdd(left: Fraction, right: Fraction): Fraction {
  return fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function fractionMultiply(left: Fraction, right: Fraction): Fraction {
  return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

function vectorFromExact(value: ExactVector3): FractionVector3 {
  return { x: fromRational(value.x), y: fromRational(value.y), z: fromRational(value.z) };
}

function vectorSubtract(left: FractionVector3, right: FractionVector3): FractionVector3 {
  return {
    x: fractionSubtract(left.x, right.x),
    y: fractionSubtract(left.y, right.y),
    z: fractionSubtract(left.z, right.z),
  };
}

function vectorCross(left: FractionVector3, right: FractionVector3): FractionVector3 {
  return {
    x: fractionSubtract(fractionMultiply(left.y, right.z), fractionMultiply(left.z, right.y)),
    y: fractionSubtract(fractionMultiply(left.z, right.x), fractionMultiply(left.x, right.z)),
    z: fractionSubtract(fractionMultiply(left.x, right.y), fractionMultiply(left.y, right.x)),
  };
}

function vectorDot(left: FractionVector3, right: FractionVector3): Fraction {
  return fractionAdd(
    fractionAdd(fractionMultiply(left.x, right.x), fractionMultiply(left.y, right.y)),
    fractionMultiply(left.z, right.z),
  );
}

function vectorIsZero(vector: FractionVector3): boolean {
  return (
    vector.x.numerator === BigInt(0) &&
    vector.y.numerator === BigInt(0) &&
    vector.z.numerator === BigInt(0)
  );
}

function directionKey(vector: FractionVector3): readonly [string, string, string] {
  const lcm = (left: bigint, right: bigint) => (left / bigintGcd(left, right)) * right;
  const denominator = lcm(lcm(vector.x.denominator, vector.y.denominator), vector.z.denominator);
  const values = [
    vector.x.numerator * (denominator / vector.x.denominator),
    vector.y.numerator * (denominator / vector.y.denominator),
    vector.z.numerator * (denominator / vector.z.denominator),
  ];
  const divisor = values.reduce((current, value) => bigintGcd(current, value), BigInt(0)) || BigInt(1);
  return [
    (values[0] / divisor).toString(),
    (values[1] / divisor).toString(),
    (values[2] / divisor).toString(),
  ];
}

export const POLYHEDRON_GEOMETRY_ISSUE_CODES = {
  topologyInvalid: "TOPOLOGY_INVALID",
  topologyIdMismatch: "TOPOLOGY_ID_MISMATCH",
  missingVertexPosition: "MISSING_VERTEX_POSITION",
  unknownVertexPosition: "UNKNOWN_VERTEX_POSITION",
  coincidentVertexPosition: "COINCIDENT_VERTEX_POSITION",
  faceDegenerate: "FACE_DEGENERATE",
  faceNonPlanar: "FACE_NON_PLANAR",
} as const;

export type PolyhedronGeometryIssueCode =
  (typeof POLYHEDRON_GEOMETRY_ISSUE_CODES)[keyof typeof POLYHEDRON_GEOMETRY_ISSUE_CODES];

export interface PolyhedronGeometryIssue {
  readonly code: PolyhedronGeometryIssueCode;
  readonly subjectId: string;
}

export interface PolyhedronFaceGeometryAnalysis {
  readonly faceId: string;
  readonly normalDirection: readonly [string, string, string] | null;
  readonly confirmedOppositeFaceIds: readonly string[];
}

export interface PolyhedronGeometryAnalysis {
  readonly kernelVersion: typeof POLYHEDRON_NET_GEOMETRY_KERNEL_VERSION;
  readonly topologyId: string;
  readonly validGeometry: boolean;
  readonly issues: readonly PolyhedronGeometryIssue[];
  readonly faces: readonly PolyhedronFaceGeometryAnalysis[];
}

export function analyzePolyhedronGeometry(topologyInput: unknown, geometryInput: unknown): PolyhedronGeometryAnalysis {
  const topology = parsePolyhedronTopology(topologyInput);
  const geometry = parsePolyhedronGeometry(geometryInput);
  const topologyAnalysis = analyzePolyhedronTopology(topology);
  const issues: PolyhedronGeometryIssue[] = [];
  const addIssue = (code: PolyhedronGeometryIssueCode, subjectId: string) => issues.push({ code, subjectId });
  if (!topologyAnalysis.validClosedOrientableSphere) addIssue(POLYHEDRON_GEOMETRY_ISSUE_CODES.topologyInvalid, topology.topologyId);
  if (geometry.topologyId !== topology.topologyId) addIssue(POLYHEDRON_GEOMETRY_ISSUE_CODES.topologyIdMismatch, geometry.topologyId);

  const topologyVertexIds = new Set(topology.vertices.map((vertex) => vertex.id));
  const positions = new Map(geometry.vertices.map((vertex) => [vertex.vertexId, vectorFromExact(vertex.position)]));
  topology.vertices.forEach((vertex) => {
    if (!positions.has(vertex.id)) addIssue(POLYHEDRON_GEOMETRY_ISSUE_CODES.missingVertexPosition, vertex.id);
  });
  geometry.vertices.forEach((vertex) => {
    if (!topologyVertexIds.has(vertex.vertexId)) addIssue(POLYHEDRON_GEOMETRY_ISSUE_CODES.unknownVertexPosition, vertex.vertexId);
  });

  const positionOwner = new Map<string, string>();
  geometry.vertices.forEach((vertex) => {
    const key = `${vertex.position.x.numerator}/${vertex.position.x.denominator}|${vertex.position.y.numerator}/${vertex.position.y.denominator}|${vertex.position.z.numerator}/${vertex.position.z.denominator}`;
    const owner = positionOwner.get(key);
    if (owner) addIssue(POLYHEDRON_GEOMETRY_ISSUE_CODES.coincidentVertexPosition, vertex.vertexId);
    else positionOwner.set(key, vertex.vertexId);
  });

  const normals = new Map<string, FractionVector3>();
  const origins = new Map<string, FractionVector3>();
  topology.faces.forEach((face) => {
    const points = face.vertexIds.map((vertexId) => positions.get(vertexId));
    if (points.some((point) => !point)) return;
    const exactPoints = points as FractionVector3[];
    const origin = exactPoints[0];
    let normal: FractionVector3 | null = null;
    for (let left = 1; left < exactPoints.length - 1 && !normal; left += 1) {
      for (let right = left + 1; right < exactPoints.length; right += 1) {
        const candidate = vectorCross(vectorSubtract(exactPoints[left], origin), vectorSubtract(exactPoints[right], origin));
        if (!vectorIsZero(candidate)) {
          normal = candidate;
          break;
        }
      }
    }
    if (!normal) {
      addIssue(POLYHEDRON_GEOMETRY_ISSUE_CODES.faceDegenerate, face.id);
      return;
    }
    if (exactPoints.some((point) => vectorDot(normal, vectorSubtract(point, origin)).numerator !== BigInt(0))) {
      addIssue(POLYHEDRON_GEOMETRY_ISSUE_CODES.faceNonPlanar, face.id);
      return;
    }
    normals.set(face.id, normal);
    origins.set(face.id, origin);
  });

  const faceAnalyses = topologyAnalysis.faces.map((face): PolyhedronFaceGeometryAnalysis => {
    const normal = normals.get(face.faceId);
    const origin = origins.get(face.faceId);
    const confirmedOppositeFaceIds = normal && origin
      ? face.oppositeCandidateFaceIds.filter((candidateId) => {
          const candidateNormal = normals.get(candidateId);
          const candidateOrigin = origins.get(candidateId);
          if (!candidateNormal || !candidateOrigin) return false;
          if (!vectorIsZero(vectorCross(normal, candidateNormal))) return false;
          if (vectorDot(normal, candidateNormal).numerator >= BigInt(0)) return false;
          return vectorDot(normal, vectorSubtract(candidateOrigin, origin)).numerator !== BigInt(0);
        })
      : [];
    return {
      faceId: face.faceId,
      normalDirection: normal ? directionKey(normal) : null,
      confirmedOppositeFaceIds,
    };
  });

  return {
    kernelVersion: POLYHEDRON_NET_GEOMETRY_KERNEL_VERSION,
    topologyId: topology.topologyId,
    validGeometry: issues.length === 0,
    issues,
    faces: faceAnalyses,
  };
}

export const POLYHEDRON_NET_LAYOUT_ISSUE_CODES = {
  topologyInvalid: "TOPOLOGY_INVALID",
  hingeInvalid: "HINGE_INVALID",
  topologyIdMismatch: "TOPOLOGY_ID_MISMATCH",
  rootFaceMismatch: "ROOT_FACE_MISMATCH",
  faceCoverage: "FACE_COVERAGE",
  faceVertexMismatch: "FACE_VERTEX_MISMATCH",
  faceDegenerate: "FACE_DEGENERATE",
  faceSelfIntersection: "FACE_SELF_INTERSECTION",
  hingeAlignment: "HINGE_ALIGNMENT",
  foldCoverage: "FOLD_COVERAGE",
  faceInteriorOverlap: "FACE_INTERIOR_OVERLAP",
  faceBoundaryOverlap: "FACE_BOUNDARY_OVERLAP",
} as const;

export type PolyhedronNetLayoutIssueCode =
  (typeof POLYHEDRON_NET_LAYOUT_ISSUE_CODES)[keyof typeof POLYHEDRON_NET_LAYOUT_ISSUE_CODES];

export interface PolyhedronNetLayoutIssue {
  readonly code: PolyhedronNetLayoutIssueCode;
  readonly subjectId: string;
  readonly relatedId: string | null;
}

export interface PolyhedronPlanarFaceAnalysis {
  readonly faceId: string;
  readonly signedDoubleArea: string;
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface PolyhedronFoldInstruction {
  readonly faceId: string;
  readonly parentFaceId: string;
  readonly hingeEdgeId: string;
  readonly axis: { readonly from: ExactPlanarPoint; readonly to: ExactPlanarPoint };
  readonly signedTargetAngleMicrodegrees: number;
  readonly progressRule: "linear-angle";
}

export interface PolyhedronNetLayoutAnalysis {
  readonly kernelVersion: typeof POLYHEDRON_NET_GEOMETRY_KERNEL_VERSION;
  readonly topologyId: string;
  readonly validPlanarNet: boolean;
  readonly issues: readonly PolyhedronNetLayoutIssue[];
  readonly faces: readonly PolyhedronPlanarFaceAnalysis[];
  readonly foldProgram: readonly PolyhedronFoldInstruction[];
}

interface PlanarSegment {
  readonly faceId: string;
  readonly fromVertexId: string;
  readonly toVertexId: string;
  readonly from: ExactPlanarPoint;
  readonly to: ExactPlanarPoint;
}

function planarCross(origin: ExactPlanarPoint, left: ExactPlanarPoint, right: ExactPlanarPoint): bigint {
  return (
    BigInt(left.x - origin.x) * BigInt(right.y - origin.y) -
    BigInt(left.y - origin.y) * BigInt(right.x - origin.x)
  );
}

function pointOnSegment(point: ExactPlanarPoint, segment: PlanarSegment): boolean {
  if (planarCross(segment.from, segment.to, point) !== BigInt(0)) return false;
  return (
    point.x >= Math.min(segment.from.x, segment.to.x) &&
    point.x <= Math.max(segment.from.x, segment.to.x) &&
    point.y >= Math.min(segment.from.y, segment.to.y) &&
    point.y <= Math.max(segment.from.y, segment.to.y)
  );
}

type SegmentRelation = "none" | "touch" | "proper" | "collinear-overlap";

function segmentRelation(left: PlanarSegment, right: PlanarSegment): SegmentRelation {
  const a = planarCross(left.from, left.to, right.from);
  const b = planarCross(left.from, left.to, right.to);
  const c = planarCross(right.from, right.to, left.from);
  const d = planarCross(right.from, right.to, left.to);
  const opposite = (first: bigint, second: bigint) =>
    (first < BigInt(0) && second > BigInt(0)) || (first > BigInt(0) && second < BigInt(0));
  if (opposite(a, b) && opposite(c, d)) return "proper";
  if (a === BigInt(0) && b === BigInt(0) && c === BigInt(0) && d === BigInt(0)) {
    const useX = left.from.x !== left.to.x || right.from.x !== right.to.x;
    const leftMin = Math.min(useX ? left.from.x : left.from.y, useX ? left.to.x : left.to.y);
    const leftMax = Math.max(useX ? left.from.x : left.from.y, useX ? left.to.x : left.to.y);
    const rightMin = Math.min(useX ? right.from.x : right.from.y, useX ? right.to.x : right.to.y);
    const rightMax = Math.max(useX ? right.from.x : right.from.y, useX ? right.to.x : right.to.y);
    const overlap = Math.min(leftMax, rightMax) - Math.max(leftMin, rightMin);
    return overlap > 0 ? "collinear-overlap" : overlap === 0 ? "touch" : "none";
  }
  if (
    (a === BigInt(0) && pointOnSegment(right.from, left)) ||
    (b === BigInt(0) && pointOnSegment(right.to, left)) ||
    (c === BigInt(0) && pointOnSegment(left.from, right)) ||
    (d === BigInt(0) && pointOnSegment(left.to, right))
  ) {
    return "touch";
  }
  return "none";
}

function pointStrictlyInsidePolygon(point: ExactPlanarPoint, segments: readonly PlanarSegment[]): boolean {
  if (segments.some((segment) => pointOnSegment(point, segment))) return false;
  let winding = 0;
  segments.forEach((segment) => {
    if (
      segment.from.y <= point.y &&
      segment.to.y > point.y &&
      planarCross(segment.from, segment.to, point) > BigInt(0)
    )
      winding += 1;
    if (
      segment.from.y > point.y &&
      segment.to.y <= point.y &&
      planarCross(segment.from, segment.to, point) < BigInt(0)
    )
      winding -= 1;
  });
  return winding !== 0;
}

function planarSegments(face: PolyhedronNetLayout["faces"][number]): PlanarSegment[] {
  return face.vertices.map((vertex, index) => {
    const next = face.vertices[(index + 1) % face.vertices.length];
    return {
      faceId: face.faceId,
      fromVertexId: vertex.vertexId,
      toVertexId: next.vertexId,
      from: vertex.position,
      to: next.position,
    };
  });
}

function signedDoubleArea(face: PolyhedronNetLayout["faces"][number]): bigint {
  return face.vertices.reduce((sum, vertex, index) => {
    const next = face.vertices[(index + 1) % face.vertices.length];
    return sum + BigInt(vertex.position.x) * BigInt(next.position.y) - BigInt(vertex.position.y) * BigInt(next.position.x);
  }, BigInt(0));
}

function samePoint(left: ExactPlanarPoint | undefined, right: ExactPlanarPoint | undefined): boolean {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

function segmentEdgeKey(segment: PlanarSegment): string {
  return segment.fromVertexId < segment.toVertexId
    ? `${segment.fromVertexId}|${segment.toVertexId}`
    : `${segment.toVertexId}|${segment.fromVertexId}`;
}

export function analyzePolyhedronNetLayout(
  topologyInput: unknown,
  hingeInput: unknown,
  layoutInput: unknown,
): PolyhedronNetLayoutAnalysis {
  const topology = parsePolyhedronTopology(topologyInput);
  const hingeGraph = parsePolyhedronHingeGraph(hingeInput);
  const layout = parsePolyhedronNetLayout(layoutInput);
  const topologyAnalysis = analyzePolyhedronTopology(topology);
  const hingeAnalysis = analyzePolyhedronHingeGraph(topology, hingeGraph);
  const issues: PolyhedronNetLayoutIssue[] = [];
  const addIssue = (code: PolyhedronNetLayoutIssueCode, subjectId: string, relatedId: string | null = null) => {
    if (!issues.some((issue) => issue.code === code && issue.subjectId === subjectId && issue.relatedId === relatedId)) {
      issues.push({ code, subjectId, relatedId });
    }
  };
  if (!topologyAnalysis.validClosedOrientableSphere) addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.topologyInvalid, topology.topologyId);
  if (!hingeAnalysis.validSpanningTree) addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.hingeInvalid, topology.topologyId);
  if (layout.topologyId !== topology.topologyId || hingeGraph.topologyId !== topology.topologyId) {
    addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.topologyIdMismatch, layout.topologyId);
  }
  if (layout.rootFaceId !== hingeGraph.rootFaceId) {
    addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.rootFaceMismatch, layout.rootFaceId, hingeGraph.rootFaceId);
  }

  const layoutFaceById = new Map(layout.faces.map((face) => [face.faceId, face]));
  const topologyFaceIds = new Set(topology.faces.map((face) => face.id));
  topology.faces.forEach((face) => {
    const layoutFace = layoutFaceById.get(face.id);
    if (!layoutFace) {
      addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceCoverage, face.id);
      return;
    }
    if (
      layoutFace.vertices.length !== face.vertexIds.length ||
      layoutFace.vertices.some((vertex, index) => vertex.vertexId !== face.vertexIds[index])
    ) {
      addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceVertexMismatch, face.id);
    }
  });
  layout.faces.forEach((face) => {
    if (!topologyFaceIds.has(face.faceId)) addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceCoverage, face.faceId);
  });

  const faceAnalyses: PolyhedronPlanarFaceAnalysis[] = [];
  const segmentsByFace = new Map<string, PlanarSegment[]>();
  layout.faces.forEach((face) => {
    const area = signedDoubleArea(face);
    if (area === BigInt(0)) addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceDegenerate, face.faceId);
    const segments = planarSegments(face);
    segmentsByFace.set(face.faceId, segments);
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        if (right === left + 1 || (left === 0 && right === segments.length - 1)) continue;
        if (segmentRelation(segments[left], segments[right]) !== "none") {
          addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceSelfIntersection, face.faceId);
        }
      }
    }
    const xs = face.vertices.map((vertex) => vertex.position.x);
    const ys = face.vertices.map((vertex) => vertex.position.y);
    faceAnalyses.push({
      faceId: face.faceId,
      signedDoubleArea: area.toString(),
      bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
    });
  });

  const topologyEdgeById = new Map(topologyAnalysis.edges.map((edge) => [edge.edgeId, edge]));
  const topologyEdgeByVertexKey = new Map(
    topologyAnalysis.edges.map((edge) => [`${edge.vertexIds[0]}|${edge.vertexIds[1]}`, edge]),
  );
  const hingeEdgeIds = new Set(hingeGraph.hinges.map((hinge) => hinge.edgeId));
  hingeGraph.hinges.forEach((hinge) => {
    const edge = topologyEdgeById.get(hinge.edgeId);
    if (!edge || edge.faceIds.length !== 2) return;
    const [leftFaceId, rightFaceId] = edge.faceIds;
    const leftFace = layoutFaceById.get(leftFaceId);
    const rightFace = layoutFaceById.get(rightFaceId);
    if (!leftFace || !rightFace) return;
    const leftPositions = new Map(leftFace.vertices.map((vertex) => [vertex.vertexId, vertex.position]));
    const rightPositions = new Map(rightFace.vertices.map((vertex) => [vertex.vertexId, vertex.position]));
    if (
      !samePoint(leftPositions.get(edge.vertexIds[0]), rightPositions.get(edge.vertexIds[0])) ||
      !samePoint(leftPositions.get(edge.vertexIds[1]), rightPositions.get(edge.vertexIds[1]))
    ) {
      addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.hingeAlignment, hinge.edgeId);
    }
  });

  const foldByEdgeId = new Map(layout.foldTargets.map((fold) => [fold.edgeId, fold]));
  hingeGraph.hinges.forEach((hinge) => {
    if (!foldByEdgeId.has(hinge.edgeId)) addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.foldCoverage, hinge.edgeId);
  });
  layout.foldTargets.forEach((fold) => {
    if (!hingeEdgeIds.has(fold.edgeId)) addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.foldCoverage, fold.edgeId);
  });

  for (let leftIndex = 0; leftIndex < layout.faces.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.faces.length; rightIndex += 1) {
      const leftFace = layout.faces[leftIndex];
      const rightFace = layout.faces[rightIndex];
      const leftSegments = segmentsByFace.get(leftFace.faceId) ?? [];
      const rightSegments = segmentsByFace.get(rightFace.faceId) ?? [];
      let interiorOverlap = false;
      let boundaryOverlap = false;
      for (const leftSegment of leftSegments) {
        for (const rightSegment of rightSegments) {
          const relation = segmentRelation(leftSegment, rightSegment);
          if (relation === "proper") interiorOverlap = true;
          if (relation === "collinear-overlap") {
            const sameSemanticEdge = segmentEdgeKey(leftSegment) === segmentEdgeKey(rightSegment);
            const edge = topologyEdgeByVertexKey.get(segmentEdgeKey(leftSegment));
            if (!(sameSemanticEdge && edge && hingeEdgeIds.has(edge.edgeId))) boundaryOverlap = true;
          }
        }
      }
      if (
        leftFace.vertices.some((vertex) => pointStrictlyInsidePolygon(vertex.position, rightSegments)) ||
        rightFace.vertices.some((vertex) => pointStrictlyInsidePolygon(vertex.position, leftSegments))
      ) {
        interiorOverlap = true;
      }
      if (interiorOverlap) {
        addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceInteriorOverlap, leftFace.faceId, rightFace.faceId);
      }
      if (boundaryOverlap) {
        addIssue(POLYHEDRON_NET_LAYOUT_ISSUE_CODES.faceBoundaryOverlap, leftFace.faceId, rightFace.faceId);
      }
    }
  }

  const foldProgram: PolyhedronFoldInstruction[] = [];
  if (issues.length === 0) {
    const hingeByEdgeId = new Map(hingeGraph.hinges.map((hinge) => [hinge.edgeId, hinge]));
    hingeAnalysis.traversal.slice(1).forEach((step) => {
      if (!step.parentFaceId || !step.hingeEdgeId) return;
      const edge = topologyEdgeById.get(step.hingeEdgeId);
      const parentFace = layoutFaceById.get(step.parentFaceId);
      const fold = foldByEdgeId.get(step.hingeEdgeId);
      const hinge = hingeByEdgeId.get(step.hingeEdgeId);
      if (!edge || !parentFace || !fold || !hinge) return;
      const positions = new Map(parentFace.vertices.map((vertex) => [vertex.vertexId, vertex.position]));
      const from = positions.get(edge.vertexIds[0]);
      const to = positions.get(edge.vertexIds[1]);
      if (!from || !to) return;
      foldProgram.push({
        faceId: step.faceId,
        parentFaceId: step.parentFaceId,
        hingeEdgeId: step.hingeEdgeId,
        axis: { from, to },
        signedTargetAngleMicrodegrees:
          hinge.foldSense === "valley" ? fold.targetAngleMicrodegrees : -fold.targetAngleMicrodegrees,
        progressRule: "linear-angle",
      });
    });
  }

  return {
    kernelVersion: POLYHEDRON_NET_GEOMETRY_KERNEL_VERSION,
    topologyId: topology.topologyId,
    validPlanarNet: issues.length === 0,
    issues,
    faces: faceAnalyses,
    foldProgram,
  };
}
