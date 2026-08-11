import type { Rational } from "./exact";
import {
  analyzePolyhedronGeometry,
  analyzePolyhedronNetLayout,
} from "./polyhedron-net-geometry-kernel";
import {
  parsePolyhedronGeometry,
  parsePolyhedronNetLayout,
  type ExactPlanarPoint,
  type PolyhedronGeometry,
  type PolyhedronNetLayout,
} from "./polyhedron-net-geometry-schema";
import {
  POLYHEDRON_FOLD_PROGRESS_SCALE,
  POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION,
  POLYHEDRON_FOLD_SIMULATION_LIMITS,
  POLYHEDRON_FOLD_SIMULATION_VERSION,
  parsePolyhedronFoldProgress,
  parsePolyhedronFoldSimulationRequest,
  type PolyhedronFoldSimulationRequest,
} from "./polyhedron-fold-simulation-schema";
import {
  analyzePolyhedronHingeGraph,
  analyzePolyhedronTopology,
} from "./polyhedron-topology-kernel";
import {
  parsePolyhedronHingeGraph,
  parsePolyhedronTopology,
  type PolyhedronHingeGraph,
  type PolyhedronTopology,
} from "./polyhedron-topology-schema";

const GEOMETRY_EPSILON = 1e-9;
const OUTPUT_DECIMALS = 12;

interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Matrix3 {
  readonly values: readonly [number, number, number, number, number, number, number, number, number];
}

interface RigidTransform {
  readonly rotation: Matrix3;
  readonly translation: Vector3;
}

interface Fraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

interface WorldFace {
  readonly faceId: string;
  readonly points: readonly Vector3[];
  readonly triangles: readonly (readonly [number, number, number])[];
}

function vector(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

function add(left: Vector3, right: Vector3): Vector3 {
  return vector(left.x + right.x, left.y + right.y, left.z + right.z);
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return vector(left.x - right.x, left.y - right.y, left.z - right.z);
}

function scale(value: Vector3, factor: number): Vector3 {
  return vector(value.x * factor, value.y * factor, value.z * factor);
}

function dot(left: Vector3, right: Vector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return vector(
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  );
}

function length(value: Vector3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function normalize(value: Vector3): Vector3 | null {
  const magnitude = length(value);
  return magnitude <= GEOMETRY_EPSILON ? null : scale(value, 1 / magnitude);
}

function distance(left: Vector3, right: Vector3): number {
  return length(subtract(left, right));
}

function rationalToNumber(value: Rational): number {
  return value.numerator / value.denominator;
}

function geometryVector(position: PolyhedronGeometry["vertices"][number]["position"]): Vector3 {
  return vector(rationalToNumber(position.x), rationalToNumber(position.y), rationalToNumber(position.z));
}

function planarVector(position: ExactPlanarPoint): Vector3 {
  return vector(position.x, position.y, 0);
}

function matrix(values: Matrix3["values"]): Matrix3 {
  return { values };
}

const IDENTITY_MATRIX = matrix([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function applyMatrix(value: Matrix3, point: Vector3): Vector3 {
  const m = value.values;
  return vector(
    m[0] * point.x + m[1] * point.y + m[2] * point.z,
    m[3] * point.x + m[4] * point.y + m[5] * point.z,
    m[6] * point.x + m[7] * point.y + m[8] * point.z,
  );
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  const a = left.values;
  const b = right.values;
  const values = Array.from({ length: 9 }, () => 0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      values[row * 3 + column] =
        a[row * 3] * b[column] +
        a[row * 3 + 1] * b[3 + column] +
        a[row * 3 + 2] * b[6 + column];
    }
  }
  return matrix([
    values[0],
    values[1],
    values[2],
    values[3],
    values[4],
    values[5],
    values[6],
    values[7],
    values[8],
  ]);
}

function applyTransform(transform: RigidTransform, point: Vector3): Vector3 {
  return add(applyMatrix(transform.rotation, point), transform.translation);
}

function composeTransforms(parent: RigidTransform, local: RigidTransform): RigidTransform {
  return {
    rotation: multiplyMatrices(parent.rotation, local.rotation),
    translation: add(applyMatrix(parent.rotation, local.translation), parent.translation),
  };
}

function rotationAroundAxis(from: Vector3, to: Vector3, angleRadians: number): RigidTransform | null {
  const axis = normalize(subtract(to, from));
  if (!axis) return null;
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  const oneMinusCosine = 1 - cosine;
  const { x, y, z } = axis;
  const rotation = matrix([
    cosine + x * x * oneMinusCosine,
    x * y * oneMinusCosine - z * sine,
    x * z * oneMinusCosine + y * sine,
    y * x * oneMinusCosine + z * sine,
    cosine + y * y * oneMinusCosine,
    y * z * oneMinusCosine - x * sine,
    z * x * oneMinusCosine - y * sine,
    z * y * oneMinusCosine + x * sine,
    cosine + z * z * oneMinusCosine,
  ]);
  return { rotation, translation: subtract(from, applyMatrix(rotation, from)) };
}

function rounded(value: number): number {
  const normalized = Number(value.toFixed(OUTPUT_DECIMALS));
  return Object.is(normalized, -0) ? 0 : normalized;
}

function roundedVector(value: Vector3): PolyhedronFoldVector3 {
  return { x: rounded(value.x), y: rounded(value.y), z: rounded(value.z) };
}

function transformMatrix(transform: RigidTransform): PolyhedronFoldTransformMatrix {
  const r = transform.rotation.values;
  const t = transform.translation;
  return [
    rounded(r[0]),
    rounded(r[1]),
    rounded(r[2]),
    rounded(t.x),
    rounded(r[3]),
    rounded(r[4]),
    rounded(r[5]),
    rounded(t.y),
    rounded(r[6]),
    rounded(r[7]),
    rounded(r[8]),
    rounded(t.z),
    0,
    0,
    0,
    1,
  ];
}

function fractionSubtract(left: Fraction, right: Fraction): Fraction {
  return {
    numerator: left.numerator * right.denominator - right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}

function fractionAdd(left: Fraction, right: Fraction): Fraction {
  return {
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}

function fractionMultiply(left: Fraction, right: Fraction): Fraction {
  return { numerator: left.numerator * right.numerator, denominator: left.denominator * right.denominator };
}

function exactSquaredDistance(
  left: PolyhedronGeometry["vertices"][number]["position"],
  right: PolyhedronGeometry["vertices"][number]["position"],
): Fraction {
  const coordinate = (value: Rational): Fraction => ({
    numerator: BigInt(value.numerator),
    denominator: BigInt(value.denominator),
  });
  const dx = fractionSubtract(coordinate(left.x), coordinate(right.x));
  const dy = fractionSubtract(coordinate(left.y), coordinate(right.y));
  const dz = fractionSubtract(coordinate(left.z), coordinate(right.z));
  return fractionAdd(fractionAdd(fractionMultiply(dx, dx), fractionMultiply(dy, dy)), fractionMultiply(dz, dz));
}

function exactMetricMatches(
  planarLeft: ExactPlanarPoint,
  planarRight: ExactPlanarPoint,
  geometryLeft: PolyhedronGeometry["vertices"][number]["position"],
  geometryRight: PolyhedronGeometry["vertices"][number]["position"],
): boolean {
  const dx = BigInt(planarLeft.x - planarRight.x);
  const dy = BigInt(planarLeft.y - planarRight.y);
  const planarSquared = dx * dx + dy * dy;
  const geometrySquared = exactSquaredDistance(geometryLeft, geometryRight);
  return planarSquared * geometrySquared.denominator === geometrySquared.numerator;
}

function faceNormal(points: readonly Vector3[]): Vector3 | null {
  const origin = points[0];
  for (let left = 1; left < points.length - 1; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const normal = normalize(cross(subtract(points[left], origin), subtract(points[right], origin)));
      if (normal) return normal;
    }
  }
  return null;
}

function planarSignedDoubleArea(face: PolyhedronNetLayout["faces"][number]): number {
  return face.vertices.reduce((sum, vertex, index) => {
    const next = face.vertices[(index + 1) % face.vertices.length];
    return sum + vertex.position.x * next.position.y - vertex.position.y * next.position.x;
  }, 0);
}

function rootAlignment(
  rootLayout: PolyhedronNetLayout["faces"][number],
  geometryByVertexId: ReadonlyMap<string, PolyhedronGeometry["vertices"][number]["position"]>,
): RigidTransform | null {
  const sourcePoints = rootLayout.vertices.map((vertex) => planarVector(vertex.position));
  const targetPoints = rootLayout.vertices.map((vertex) => {
    const target = geometryByVertexId.get(vertex.vertexId);
    return target ? geometryVector(target) : null;
  });
  if (targetPoints.some((point) => !point)) return null;
  const targets = targetPoints as Vector3[];
  const sourceOrigin = sourcePoints[0];
  const targetOrigin = targets[0];
  for (let left = 1; left < sourcePoints.length - 1; left += 1) {
    for (let right = left + 1; right < sourcePoints.length; right += 1) {
      const sourceU = normalize(subtract(sourcePoints[left], sourceOrigin));
      const sourceNormal = normalize(
        cross(subtract(sourcePoints[left], sourceOrigin), subtract(sourcePoints[right], sourceOrigin)),
      );
      const targetU = normalize(subtract(targets[left], targetOrigin));
      const targetNormal = normalize(cross(subtract(targets[left], targetOrigin), subtract(targets[right], targetOrigin)));
      if (!sourceU || !sourceNormal || !targetU || !targetNormal) continue;
      const sourceV = cross(sourceNormal, sourceU);
      const targetV = cross(targetNormal, targetU);
      const rotation = matrix([
        targetU.x * sourceU.x + targetV.x * sourceV.x + targetNormal.x * sourceNormal.x,
        targetU.x * sourceU.y + targetV.x * sourceV.y + targetNormal.x * sourceNormal.y,
        targetU.x * sourceU.z + targetV.x * sourceV.z + targetNormal.x * sourceNormal.z,
        targetU.y * sourceU.x + targetV.y * sourceV.x + targetNormal.y * sourceNormal.x,
        targetU.y * sourceU.y + targetV.y * sourceV.y + targetNormal.y * sourceNormal.y,
        targetU.y * sourceU.z + targetV.y * sourceV.z + targetNormal.y * sourceNormal.z,
        targetU.z * sourceU.x + targetV.z * sourceV.x + targetNormal.z * sourceNormal.x,
        targetU.z * sourceU.y + targetV.z * sourceV.y + targetNormal.z * sourceNormal.y,
        targetU.z * sourceU.z + targetV.z * sourceV.z + targetNormal.z * sourceNormal.z,
      ]);
      return { rotation, translation: subtract(targetOrigin, applyMatrix(rotation, sourceOrigin)) };
    }
  }
  return null;
}

function cross2(origin: ExactPlanarPoint, left: ExactPlanarPoint, right: ExactPlanarPoint): number {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

function pointInTriangleInclusive2(point: ExactPlanarPoint, triangle: readonly ExactPlanarPoint[]): boolean {
  const first = cross2(triangle[0], triangle[1], point);
  const second = cross2(triangle[1], triangle[2], point);
  const third = cross2(triangle[2], triangle[0], point);
  const hasNegative = first < 0 || second < 0 || third < 0;
  const hasPositive = first > 0 || second > 0 || third > 0;
  return !(hasNegative && hasPositive);
}

function triangulateFace(face: PolyhedronNetLayout["faces"][number]): readonly (readonly [number, number, number])[] {
  const points = face.vertices.map((vertex) => vertex.position);
  const orientation = Math.sign(planarSignedDoubleArea(face));
  const remaining = points.map((_, index) => index);
  const triangles: Array<readonly [number, number, number]> = [];
  let guard = 0;
  while (remaining.length > 3 && guard < points.length * points.length) {
    let clipped = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index - 1 + remaining.length) % remaining.length];
      const current = remaining[index];
      const next = remaining[(index + 1) % remaining.length];
      if (cross2(points[previous], points[current], points[next]) * orientation <= 0) continue;
      const triangle = [points[previous], points[current], points[next]];
      const containsOther = remaining.some(
        (candidate) =>
          candidate !== previous &&
          candidate !== current &&
          candidate !== next &&
          pointInTriangleInclusive2(points[candidate], triangle),
      );
      if (containsOther) continue;
      triangles.push([previous, current, next]);
      remaining.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) return [];
    guard += 1;
  }
  if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

interface Point2 {
  readonly x: number;
  readonly y: number;
}

function projectPoint(point: Vector3, droppedAxis: "x" | "y" | "z"): Point2 {
  if (droppedAxis === "x") return { x: point.y, y: point.z };
  if (droppedAxis === "y") return { x: point.x, y: point.z };
  return { x: point.x, y: point.y };
}

function dominantAxis(normal: Vector3): "x" | "y" | "z" {
  const x = Math.abs(normal.x);
  const y = Math.abs(normal.y);
  const z = Math.abs(normal.z);
  return x >= y && x >= z ? "x" : y >= z ? "y" : "z";
}

function crossPoint2(origin: Point2, left: Point2, right: Point2): number {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

function pointInTriangle2(point: Point2, triangle: readonly Point2[], strict: boolean): boolean {
  const values = [
    crossPoint2(triangle[0], triangle[1], point),
    crossPoint2(triangle[1], triangle[2], point),
    crossPoint2(triangle[2], triangle[0], point),
  ];
  const hasNegative = values.some((value) => value < -GEOMETRY_EPSILON);
  const hasPositive = values.some((value) => value > GEOMETRY_EPSILON);
  if (hasNegative && hasPositive) return false;
  return strict ? values.every((value) => Math.abs(value) > GEOMETRY_EPSILON) : true;
}

function segmentsProperlyIntersect2(
  leftFrom: Point2,
  leftTo: Point2,
  rightFrom: Point2,
  rightTo: Point2,
): boolean {
  const a = crossPoint2(leftFrom, leftTo, rightFrom);
  const b = crossPoint2(leftFrom, leftTo, rightTo);
  const c = crossPoint2(rightFrom, rightTo, leftFrom);
  const d = crossPoint2(rightFrom, rightTo, leftTo);
  return a * b < -GEOMETRY_EPSILON && c * d < -GEOMETRY_EPSILON;
}

function coplanarTrianglesInteriorIntersect(
  left: readonly Vector3[],
  right: readonly Vector3[],
  normal: Vector3,
): boolean {
  const axis = dominantAxis(normal);
  const left2 = left.map((point) => projectPoint(point, axis));
  const right2 = right.map((point) => projectPoint(point, axis));
  for (let leftEdge = 0; leftEdge < 3; leftEdge += 1) {
    for (let rightEdge = 0; rightEdge < 3; rightEdge += 1) {
      if (
        segmentsProperlyIntersect2(
          left2[leftEdge],
          left2[(leftEdge + 1) % 3],
          right2[rightEdge],
          right2[(rightEdge + 1) % 3],
        )
      )
        return true;
    }
  }
  if (left2.some((point) => pointInTriangle2(point, right2, true))) return true;
  if (right2.some((point) => pointInTriangle2(point, left2, true))) return true;
  const leftCentroid = {
    x: (left2[0].x + left2[1].x + left2[2].x) / 3,
    y: (left2[0].y + left2[1].y + left2[2].y) / 3,
  };
  const rightCentroid = {
    x: (right2[0].x + right2[1].x + right2[2].x) / 3,
    y: (right2[0].y + right2[1].y + right2[2].y) / 3,
  };
  return pointInTriangle2(leftCentroid, right2, true) || pointInTriangle2(rightCentroid, left2, true);
}

function pointInTriangle3(point: Vector3, triangle: readonly Vector3[], normal: Vector3, strict: boolean): boolean {
  const axis = dominantAxis(normal);
  return pointInTriangle2(projectPoint(point, axis), triangle.map((candidate) => projectPoint(candidate, axis)), strict);
}

function segmentCrossesTriangleInterior(
  from: Vector3,
  to: Vector3,
  triangle: readonly Vector3[],
  normal: Vector3,
): boolean {
  const distanceFrom = dot(normal, subtract(from, triangle[0]));
  const distanceTo = dot(normal, subtract(to, triangle[0]));
  if (Math.abs(distanceFrom) <= GEOMETRY_EPSILON && Math.abs(distanceTo) <= GEOMETRY_EPSILON) {
    return pointInTriangle3(scale(add(from, to), 0.5), triangle, normal, true);
  }
  if (distanceFrom * distanceTo > GEOMETRY_EPSILON) return false;
  const denominator = distanceFrom - distanceTo;
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return false;
  const progress = distanceFrom / denominator;
  if (progress <= GEOMETRY_EPSILON || progress >= 1 - GEOMETRY_EPSILON) return false;
  const point = add(from, scale(subtract(to, from), progress));
  return pointInTriangle3(point, triangle, normal, false);
}

function trianglesInteriorIntersect(left: readonly Vector3[], right: readonly Vector3[]): boolean {
  const leftNormal = normalize(cross(subtract(left[1], left[0]), subtract(left[2], left[0])));
  const rightNormal = normalize(cross(subtract(right[1], right[0]), subtract(right[2], right[0])));
  if (!leftNormal || !rightNormal) return false;
  if (length(cross(leftNormal, rightNormal)) <= GEOMETRY_EPSILON) {
    if (Math.abs(dot(leftNormal, subtract(right[0], left[0]))) > GEOMETRY_EPSILON) return false;
    return coplanarTrianglesInteriorIntersect(left, right, leftNormal);
  }
  for (let index = 0; index < 3; index += 1) {
    if (segmentCrossesTriangleInterior(left[index], left[(index + 1) % 3], right, rightNormal)) return true;
    if (segmentCrossesTriangleInterior(right[index], right[(index + 1) % 3], left, leftNormal)) return true;
  }
  return false;
}

function facesInteriorIntersect(left: WorldFace, right: WorldFace): boolean {
  return left.triangles.some((leftTriangle) =>
    right.triangles.some((rightTriangle) =>
      trianglesInteriorIntersect(
        leftTriangle.map((index) => left.points[index]),
        rightTriangle.map((index) => right.points[index]),
      ),
    ),
  );
}

function stablePair(left: string, right: string): readonly [string, string] {
  return left < right ? [left, right] : [right, left];
}

function degreesToRadians(microdegrees: number): number {
  return (microdegrees / 1_000_000) * (Math.PI / 180);
}

export const POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES = {
  geometryInvalid: "GEOMETRY_INVALID",
  netLayoutInvalid: "NET_LAYOUT_INVALID",
  simulationBudgetExceeded: "SIMULATION_BUDGET_EXCEEDED",
  triangulationFailed: "TRIANGULATION_FAILED",
  faceMetricMismatch: "FACE_METRIC_MISMATCH",
  faceOrientationMismatch: "FACE_ORIENTATION_MISMATCH",
  rootAlignmentFailed: "ROOT_ALIGNMENT_FAILED",
  targetAngleMismatch: "TARGET_ANGLE_MISMATCH",
  sampledFaceCollision: "SAMPLED_FACE_COLLISION",
  finalClosureMismatch: "FINAL_CLOSURE_MISMATCH",
} as const;

export type PolyhedronFoldSimulationIssueCode =
  (typeof POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES)[keyof typeof POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES];

export interface PolyhedronFoldSimulationIssue {
  readonly code: PolyhedronFoldSimulationIssueCode;
  readonly subjectId: string;
  readonly relatedId: string | null;
}

export interface PolyhedronFoldVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type PolyhedronFoldTransformMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface PolyhedronFoldFaceFrame {
  readonly faceId: string;
  readonly transformMatrix: PolyhedronFoldTransformMatrix;
  readonly vertices: readonly { readonly vertexId: string; readonly position: PolyhedronFoldVector3 }[];
}

export interface PolyhedronFoldCollisionPair {
  readonly faceIds: readonly [string, string];
}

export interface PolyhedronFoldFrame {
  readonly progressMillionths: number;
  readonly faces: readonly PolyhedronFoldFaceFrame[];
  readonly collisionPairs: readonly PolyhedronFoldCollisionPair[];
  readonly collisionPairsTruncated: boolean;
}

export interface PolyhedronFoldTargetAngleAnalysis {
  readonly edgeId: string;
  readonly parentFaceId: string;
  readonly childFaceId: string;
  readonly requestedSignedAngleMicrodegrees: number;
  readonly expectedSignedAngleMicrodegrees: number;
  readonly deltaMicrodegrees: number;
}

export interface PolyhedronFoldFaceClosure {
  readonly faceId: string;
  readonly maximumVertexErrorMicrounits: number;
}

export interface PolyhedronFoldClosureAnalysis {
  readonly closedWithinTolerance: boolean;
  readonly toleranceMicrounits: number;
  readonly maximumVertexErrorMicrounits: number;
  readonly faces: readonly PolyhedronFoldFaceClosure[];
}

export interface PolyhedronFoldSimulationAnalysis {
  readonly kernelVersion: typeof POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION;
  readonly simulationVersion: typeof POLYHEDRON_FOLD_SIMULATION_VERSION;
  readonly topologyId: string;
  readonly passesSampledValidation: boolean;
  readonly collisionEvidence: "deterministic-samples-only";
  readonly issues: readonly PolyhedronFoldSimulationIssue[];
  readonly targetAngles: readonly PolyhedronFoldTargetAngleAnalysis[];
  readonly frames: readonly PolyhedronFoldFrame[];
  readonly finalClosure: PolyhedronFoldClosureAnalysis | null;
}

interface PreparedFold {
  readonly topology: PolyhedronTopology;
  readonly geometry: PolyhedronGeometry;
  readonly hingeGraph: PolyhedronHingeGraph;
  readonly layout: PolyhedronNetLayout;
  readonly rootTransform: RigidTransform;
  readonly targetAngles: readonly PolyhedronFoldTargetAngleAnalysis[];
  readonly trianglesByFaceId: ReadonlyMap<string, readonly (readonly [number, number, number])[]>;
  readonly adjacentFacePairKeys: ReadonlySet<string>;
}

function computeTargetAngles(
  topology: PolyhedronTopology,
  geometry: PolyhedronGeometry,
  hingeGraph: PolyhedronHingeGraph,
  layout: PolyhedronNetLayout,
): readonly PolyhedronFoldTargetAngleAnalysis[] {
  const hingeAnalysis = analyzePolyhedronHingeGraph(topology, hingeGraph);
  const topologyAnalysis = analyzePolyhedronTopology(topology);
  const geometryByVertexId = new Map(geometry.vertices.map((vertex) => [vertex.vertexId, vertex.position]));
  const layoutFoldByEdgeId = new Map(layout.foldTargets.map((fold) => [fold.edgeId, fold]));
  const hingeByEdgeId = new Map(hingeGraph.hinges.map((hinge) => [hinge.edgeId, hinge]));
  const edgeById = new Map(topologyAnalysis.edges.map((edge) => [edge.edgeId, edge]));
  const topologyFaceById = new Map(topology.faces.map((face) => [face.id, face]));
  return hingeAnalysis.traversal.slice(1).flatMap((step): PolyhedronFoldTargetAngleAnalysis[] => {
    if (!step.parentFaceId || !step.hingeEdgeId) return [];
    const edge = edgeById.get(step.hingeEdgeId);
    const parentFace = topologyFaceById.get(step.parentFaceId);
    const childFace = topologyFaceById.get(step.faceId);
    const fold = layoutFoldByEdgeId.get(step.hingeEdgeId);
    const hinge = hingeByEdgeId.get(step.hingeEdgeId);
    if (!edge || !parentFace || !childFace || !fold || !hinge) return [];
    const parentNormal = faceNormal(
      parentFace.vertexIds.map((vertexId) => geometryVector(geometryByVertexId.get(vertexId)!)),
    );
    const childNormal = faceNormal(
      childFace.vertexIds.map((vertexId) => geometryVector(geometryByVertexId.get(vertexId)!)),
    );
    const axis = normalize(
      subtract(
        geometryVector(geometryByVertexId.get(edge.vertexIds[1])!),
        geometryVector(geometryByVertexId.get(edge.vertexIds[0])!),
      ),
    );
    if (!parentNormal || !childNormal || !axis) return [];
    const expectedSignedAngleMicrodegrees = Math.round(
      (Math.atan2(dot(axis, cross(parentNormal, childNormal)), dot(parentNormal, childNormal)) * 180 * 1_000_000) /
        Math.PI,
    );
    const requestedSignedAngleMicrodegrees =
      hinge.foldSense === "valley" ? fold.targetAngleMicrodegrees : -fold.targetAngleMicrodegrees;
    return [
      {
        edgeId: step.hingeEdgeId,
        parentFaceId: step.parentFaceId,
        childFaceId: step.faceId,
        requestedSignedAngleMicrodegrees,
        expectedSignedAngleMicrodegrees,
        deltaMicrodegrees: requestedSignedAngleMicrodegrees - expectedSignedAngleMicrodegrees,
      },
    ];
  });
}

function prepareFold(
  topology: PolyhedronTopology,
  geometry: PolyhedronGeometry,
  hingeGraph: PolyhedronHingeGraph,
  layout: PolyhedronNetLayout,
  addIssue: (code: PolyhedronFoldSimulationIssueCode, subjectId: string, relatedId?: string | null) => void,
): PreparedFold | null {
  const geometryByVertexId = new Map(geometry.vertices.map((vertex) => [vertex.vertexId, vertex.position]));
  const layoutByFaceId = new Map(layout.faces.map((face) => [face.faceId, face]));
  let totalTriangles = 0;
  let triangulationFailed = false;
  const trianglesByFaceId = new Map<string, readonly (readonly [number, number, number])[]>();
  layout.faces.forEach((face) => {
    const triangles = triangulateFace(face);
    trianglesByFaceId.set(face.faceId, triangles);
    totalTriangles += triangles.length;
    if (triangles.length !== face.vertices.length - 2) {
      triangulationFailed = true;
      addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.triangulationFailed, face.faceId);
    }
  });
  if (triangulationFailed) {
    return null;
  }
  if (topology.faces.length > POLYHEDRON_FOLD_SIMULATION_LIMITS.maxFaces || totalTriangles > POLYHEDRON_FOLD_SIMULATION_LIMITS.maxTriangles) {
    addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.simulationBudgetExceeded, topology.topologyId);
    return null;
  }

  topology.faces.forEach((topologyFace) => {
    const layoutFace = layoutByFaceId.get(topologyFace.id);
    if (!layoutFace) return;
    let metricMatches = true;
    for (let left = 0; left < layoutFace.vertices.length - 1; left += 1) {
      for (let right = left + 1; right < layoutFace.vertices.length; right += 1) {
        const planarLeft = layoutFace.vertices[left];
        const planarRight = layoutFace.vertices[right];
        const geometryLeft = geometryByVertexId.get(planarLeft.vertexId);
        const geometryRight = geometryByVertexId.get(planarRight.vertexId);
        if (
          !geometryLeft ||
          !geometryRight ||
          !exactMetricMatches(planarLeft.position, planarRight.position, geometryLeft, geometryRight)
        ) {
          metricMatches = false;
        }
      }
    }
    if (!metricMatches) addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.faceMetricMismatch, topologyFace.id);
  });

  const rootLayout = layoutByFaceId.get(layout.rootFaceId);
  if (!rootLayout) return null;
  const orientation = Math.sign(planarSignedDoubleArea(rootLayout));
  layout.faces.forEach((face) => {
    if (Math.sign(planarSignedDoubleArea(face)) !== orientation) {
      addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.faceOrientationMismatch, face.faceId);
    }
  });
  const rootTransform = rootAlignment(rootLayout, geometryByVertexId);
  if (!rootTransform) {
    addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.rootAlignmentFailed, layout.rootFaceId);
    return null;
  }

  const targetAngles = computeTargetAngles(topology, geometry, hingeGraph, layout);
  targetAngles.forEach((angle) => {
    if (Math.abs(angle.deltaMicrodegrees) > 1) {
      addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.targetAngleMismatch, angle.edgeId, angle.childFaceId);
    }
  });

  const adjacentFacePairKeys = new Set<string>();
  analyzePolyhedronTopology(topology).edges.forEach((edge) => {
    if (edge.faceIds.length === 2) adjacentFacePairKeys.add(stablePair(edge.faceIds[0], edge.faceIds[1]).join("|"));
  });
  return {
    topology,
    geometry,
    hingeGraph,
    layout,
    rootTransform,
    targetAngles,
    trianglesByFaceId,
    adjacentFacePairKeys,
  };
}

function computeFrameInternal(prepared: PreparedFold, progressMillionths: number): PolyhedronFoldFrame {
  const progress = progressMillionths / POLYHEDRON_FOLD_PROGRESS_SCALE;
  const layoutByFaceId = new Map(prepared.layout.faces.map((face) => [face.faceId, face]));
  const topologyAnalysis = analyzePolyhedronTopology(prepared.topology);
  const edgeById = new Map(topologyAnalysis.edges.map((edge) => [edge.edgeId, edge]));
  const hingeAnalysis = analyzePolyhedronHingeGraph(prepared.topology, prepared.hingeGraph);
  const angleByChildFaceId = new Map(prepared.targetAngles.map((angle) => [angle.childFaceId, angle]));
  const transforms = new Map<string, RigidTransform>([[prepared.layout.rootFaceId, prepared.rootTransform]]);
  hingeAnalysis.traversal.slice(1).forEach((step) => {
    if (!step.parentFaceId || !step.hingeEdgeId) return;
    const parentTransform = transforms.get(step.parentFaceId);
    const edge = edgeById.get(step.hingeEdgeId);
    const parentFace = layoutByFaceId.get(step.parentFaceId);
    const angle = angleByChildFaceId.get(step.faceId);
    if (!parentTransform || !edge || !parentFace || !angle) return;
    const positions = new Map(parentFace.vertices.map((vertex) => [vertex.vertexId, vertex.position]));
    const from = positions.get(edge.vertexIds[0]);
    const to = positions.get(edge.vertexIds[1]);
    if (!from || !to) return;
    const rotation = rotationAroundAxis(
      planarVector(from),
      planarVector(to),
      degreesToRadians(angle.requestedSignedAngleMicrodegrees * progress),
    );
    if (rotation) transforms.set(step.faceId, composeTransforms(parentTransform, rotation));
  });

  const worldFaces: WorldFace[] = prepared.layout.faces.map((face) => {
    const transform = transforms.get(face.faceId) ?? { rotation: IDENTITY_MATRIX, translation: vector(0, 0, 0) };
    return {
      faceId: face.faceId,
      points: face.vertices.map((vertex) => applyTransform(transform, planarVector(vertex.position))),
      triangles: prepared.trianglesByFaceId.get(face.faceId) ?? [],
    };
  });

  const collisionPairs: PolyhedronFoldCollisionPair[] = [];
  let collisionPairsTruncated = false;
  for (let leftIndex = 0; leftIndex < worldFaces.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < worldFaces.length; rightIndex += 1) {
      const left = worldFaces[leftIndex];
      const right = worldFaces[rightIndex];
      const pair = stablePair(left.faceId, right.faceId);
      if (prepared.adjacentFacePairKeys.has(pair.join("|"))) continue;
      if (!facesInteriorIntersect(left, right)) continue;
      if (collisionPairs.length < POLYHEDRON_FOLD_SIMULATION_LIMITS.maxCollisionPairsPerFrame) {
        collisionPairs.push({ faceIds: pair });
      } else {
        collisionPairsTruncated = true;
      }
    }
  }

  return {
    progressMillionths,
    faces: prepared.layout.faces.map((face) => {
      const transform = transforms.get(face.faceId) ?? { rotation: IDENTITY_MATRIX, translation: vector(0, 0, 0) };
      return {
        faceId: face.faceId,
        transformMatrix: transformMatrix(transform),
        vertices: face.vertices.map((vertex) => ({
          vertexId: vertex.vertexId,
          position: roundedVector(applyTransform(transform, planarVector(vertex.position))),
        })),
      };
    }),
    collisionPairs,
    collisionPairsTruncated,
  };
}

function analyzeClosure(
  prepared: PreparedFold,
  finalFrame: PolyhedronFoldFrame,
  toleranceMicrounits: number,
): PolyhedronFoldClosureAnalysis {
  const geometryByVertexId = new Map(
    prepared.geometry.vertices.map((vertex) => [vertex.vertexId, geometryVector(vertex.position)]),
  );
  const faceClosures = finalFrame.faces.map((face) => {
    const maximumError = face.vertices.reduce((current, vertex) => {
      const target = geometryByVertexId.get(vertex.vertexId);
      return target ? Math.max(current, distance(vertex.position, target)) : current;
    }, 0);
    return { faceId: face.faceId, maximumVertexErrorMicrounits: Math.ceil(maximumError * 1_000_000) };
  });
  const maximumVertexErrorMicrounits = faceClosures.reduce(
    (current, face) => Math.max(current, face.maximumVertexErrorMicrounits),
    0,
  );
  return {
    closedWithinTolerance: maximumVertexErrorMicrounits <= toleranceMicrounits,
    toleranceMicrounits,
    maximumVertexErrorMicrounits,
    faces: faceClosures,
  };
}

export function computePolyhedronFoldFrame(
  topologyInput: unknown,
  geometryInput: unknown,
  hingeInput: unknown,
  layoutInput: unknown,
  progressInput: unknown,
): PolyhedronFoldFrame {
  const topology = parsePolyhedronTopology(topologyInput);
  const geometry = parsePolyhedronGeometry(geometryInput);
  const hingeGraph = parsePolyhedronHingeGraph(hingeInput);
  const layout = parsePolyhedronNetLayout(layoutInput);
  const progressMillionths = parsePolyhedronFoldProgress(progressInput);
  const issues: PolyhedronFoldSimulationIssue[] = [];
  if (!analyzePolyhedronGeometry(topology, geometry).validGeometry) {
    issues.push({
      code: POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.geometryInvalid,
      subjectId: topology.topologyId,
      relatedId: null,
    });
  }
  if (!analyzePolyhedronNetLayout(topology, hingeGraph, layout).validPlanarNet) {
    issues.push({
      code: POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.netLayoutInvalid,
      subjectId: topology.topologyId,
      relatedId: null,
    });
  }
  if (issues.length > 0) throw new Error(`fold frame prerequisites failed: ${issues.map((issue) => issue.code).join(",")}`);
  const prepared = prepareFold(topology, geometry, hingeGraph, layout, (code, subjectId, relatedId = null) =>
    issues.push({ code, subjectId, relatedId }),
  );
  if (!prepared) throw new Error(`fold frame prerequisites failed: ${issues.map((issue) => issue.code).join(",")}`);
  return computeFrameInternal(prepared, progressMillionths);
}

export function analyzePolyhedronFoldSimulation(
  topologyInput: unknown,
  geometryInput: unknown,
  hingeInput: unknown,
  layoutInput: unknown,
  requestInput: unknown,
): PolyhedronFoldSimulationAnalysis {
  const topology = parsePolyhedronTopology(topologyInput);
  const geometry = parsePolyhedronGeometry(geometryInput);
  const hingeGraph = parsePolyhedronHingeGraph(hingeInput);
  const layout = parsePolyhedronNetLayout(layoutInput);
  const request: PolyhedronFoldSimulationRequest = parsePolyhedronFoldSimulationRequest(requestInput);
  const geometryAnalysis = analyzePolyhedronGeometry(topology, geometry);
  const layoutAnalysis = analyzePolyhedronNetLayout(topology, hingeGraph, layout);
  const issues: PolyhedronFoldSimulationIssue[] = [];
  const addIssue = (code: PolyhedronFoldSimulationIssueCode, subjectId: string, relatedId: string | null = null) => {
    if (!issues.some((issue) => issue.code === code && issue.subjectId === subjectId && issue.relatedId === relatedId)) {
      issues.push({ code, subjectId, relatedId });
    }
  };
  if (!geometryAnalysis.validGeometry) {
    addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.geometryInvalid, topology.topologyId);
  }
  if (!layoutAnalysis.validPlanarNet) {
    addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.netLayoutInvalid, topology.topologyId);
  }
  if (issues.length > 0) {
    return {
      kernelVersion: POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION,
      simulationVersion: POLYHEDRON_FOLD_SIMULATION_VERSION,
      topologyId: topology.topologyId,
      passesSampledValidation: false,
      collisionEvidence: "deterministic-samples-only",
      issues,
      targetAngles: [],
      frames: [],
      finalClosure: null,
    };
  }

  const prepared = prepareFold(topology, geometry, hingeGraph, layout, addIssue);
  if (!prepared) {
    return {
      kernelVersion: POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION,
      simulationVersion: POLYHEDRON_FOLD_SIMULATION_VERSION,
      topologyId: topology.topologyId,
      passesSampledValidation: false,
      collisionEvidence: "deterministic-samples-only",
      issues,
      targetAngles: [],
      frames: [],
      finalClosure: null,
    };
  }

  const frames = request.sampleProgressMillionths.map((progress) => computeFrameInternal(prepared, progress));
  frames.forEach((frame) => {
    frame.collisionPairs.forEach((pair) =>
      addIssue(
        POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.sampledFaceCollision,
        pair.faceIds[0],
        pair.faceIds[1],
      ),
    );
  });
  const finalClosure = analyzeClosure(prepared, frames[frames.length - 1], request.closureToleranceMicrounits);
  if (!finalClosure.closedWithinTolerance) {
    addIssue(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.finalClosureMismatch, topology.topologyId);
  }
  return {
    kernelVersion: POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION,
    simulationVersion: POLYHEDRON_FOLD_SIMULATION_VERSION,
    topologyId: topology.topologyId,
    passesSampledValidation: issues.length === 0,
    collisionEvidence: "deterministic-samples-only",
    issues,
    targetAngles: prepared.targetAngles,
    frames,
    finalClosure,
  };
}
