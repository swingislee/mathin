import { canonicalJsonStringify } from "./canonical-json";
import {
  parseSpatialAttempt,
  parseSpatialAttemptBinding,
  parseSpatialAttemptEvaluation,
  spatialAttemptFingerprint,
  type SpatialAttempt,
  type SpatialAttemptBinding,
  type SpatialAttemptEvaluation,
} from "./attempt-schema";
import { EXACT_INTEGER_LIMIT, compareRationals, type Rational } from "./exact";
import { verifySpatialPageDoc, type SpatialPageDoc } from "./page-schema";
import type { SpatialExpression } from "./scene-schema";
import {
  analyzeSurfacePaint,
  analyzeVoxelSurfaceArea,
  countVoxelLayers,
  findEnclosedVoxelCavities,
  projectVoxels,
} from "./voxel-kernel";
import { compareVoxelCoordinates, createVoxelSet } from "./voxel-schema";

export const SPATIAL_ATTEMPT_ERROR_CODES = {
  sceneMismatch: "SPATIAL_ATTEMPT_SCENE_MISMATCH",
  bindingMismatch: "SPATIAL_ATTEMPT_BINDING_MISMATCH",
  checkpointDisabled: "SPATIAL_ATTEMPT_CHECKPOINT_DISABLED",
  checkpointMissing: "SPATIAL_ATTEMPT_CHECKPOINT_MISSING",
  responseTypeMismatch: "SPATIAL_ATTEMPT_RESPONSE_TYPE_MISMATCH",
  responseInvalid: "SPATIAL_ATTEMPT_RESPONSE_INVALID",
  attemptLimit: "SPATIAL_ATTEMPT_LIMIT",
  idempotencyConflict: "SPATIAL_ATTEMPT_IDEMPOTENCY_CONFLICT",
} as const;

export type SpatialAttemptErrorCode =
  (typeof SPATIAL_ATTEMPT_ERROR_CODES)[keyof typeof SPATIAL_ATTEMPT_ERROR_CODES];

export class SpatialAttemptContractError extends Error {
  constructor(public readonly code: SpatialAttemptErrorCode, message: string) {
    super(message);
    this.name = "SpatialAttemptContractError";
  }
}

function fail(code: SpatialAttemptErrorCode, message: string): never {
  throw new SpatialAttemptContractError(code, message);
}

type SpatialCheckpoint = SpatialPageDoc["scene"]["checkpoints"][number];
type LearningCheckItem = Extract<SpatialPageDoc["learningCheck"], { mode: "formative-only" }>["items"][number];

export interface VerifiedSpatialAttempt {
  readonly page: SpatialPageDoc;
  readonly attempt: SpatialAttempt;
  readonly binding: SpatialAttemptBinding;
  readonly checkpoint: SpatialCheckpoint;
  readonly learningCheck: LearningCheckItem;
}

function responseKindForCheckpoint(checkpoint: SpatialCheckpoint): SpatialAttempt["response"]["kind"] {
  return checkpoint.type;
}

function validateResponse(page: SpatialPageDoc, attempt: SpatialAttempt, checkpoint: SpatialCheckpoint): void {
  if (attempt.response.kind !== responseKindForCheckpoint(checkpoint)) {
    fail(
      SPATIAL_ATTEMPT_ERROR_CODES.responseTypeMismatch,
      `checkpoint ${checkpoint.id} requires ${responseKindForCheckpoint(checkpoint)} response`,
    );
  }

  const response = attempt.response;
  if (checkpoint.type === "numeric" && response.kind === "numeric") {
    if (checkpoint.responseFormat === "integer" && response.value.denominator !== 1) {
      fail(SPATIAL_ATTEMPT_ERROR_CODES.responseInvalid, "integer checkpoint requires an integer response");
    }
    return;
  }
  if (checkpoint.type === "choice" && response.kind === "choice") {
    if (!checkpoint.multiple && response.optionIds.length !== 1) {
      fail(SPATIAL_ATTEMPT_ERROR_CODES.responseInvalid, "single-choice checkpoint requires exactly one option");
    }
    const allowed = new Set(checkpoint.options.map((option) => option.id));
    if (response.optionIds.some((optionId) => !allowed.has(optionId))) {
      fail(SPATIAL_ATTEMPT_ERROR_CODES.responseInvalid, "choice response contains an unknown option");
    }
    return;
  }
  if (checkpoint.type === "entity-selection" && response.kind === "entity-selection") {
    const entities = new Set(page.scene.model.entities.map((entity) => entity.id));
    if (response.entityIds.some((entityId) => !entities.has(entityId))) {
      fail(SPATIAL_ATTEMPT_ERROR_CODES.responseInvalid, "entity response contains an unknown entity");
    }
    return;
  }
  if (checkpoint.type === "voxel-selection" && response.kind === "voxel-selection") {
    if (response.entityId !== checkpoint.entityId) {
      fail(SPATIAL_ATTEMPT_ERROR_CODES.responseInvalid, "voxel response targets the wrong entity");
    }
    return;
  }
  if (checkpoint.type === "explanation" && response.kind === "explanation") {
    if (response.text.length < checkpoint.minLength || response.text.length > checkpoint.maxLength) {
      fail(SPATIAL_ATTEMPT_ERROR_CODES.responseInvalid, "explanation length is outside checkpoint limits");
    }
  }
}

export async function verifySpatialAttempt(
  pageInput: unknown,
  attemptInput: unknown,
  bindingInput: unknown,
): Promise<VerifiedSpatialAttempt> {
  const page = await verifySpatialPageDoc(pageInput);
  const attempt = parseSpatialAttempt(attemptInput);
  const binding = parseSpatialAttemptBinding(bindingInput);
  if (attempt.sceneRevisionHash !== page.sceneHash) {
    fail(SPATIAL_ATTEMPT_ERROR_CODES.sceneMismatch, "attempt scene hash does not match frozen page scene");
  }
  if (
    attempt.context.sessionId !== binding.sessionId ||
    attempt.context.pageDocId !== binding.pageDocId ||
    attempt.context.studentId !== binding.studentId ||
    attempt.context.resetEpoch !== binding.currentResetEpoch ||
    attempt.context.runtimeStateHash !== binding.runtimeStateHash ||
    attempt.context.attemptNo !== binding.nextAttemptNo
  ) {
    fail(SPATIAL_ATTEMPT_ERROR_CODES.bindingMismatch, "attempt context does not match trusted server binding");
  }
  if (page.learningCheck.mode !== "formative-only") {
    fail(SPATIAL_ATTEMPT_ERROR_CODES.checkpointDisabled, "spatial learning checks are disabled for this page");
  }
  if (attempt.context.attemptNo > page.learningCheck.maxSubmissions) {
    fail(SPATIAL_ATTEMPT_ERROR_CODES.attemptLimit, "attempt number exceeds page submission limit");
  }
  const learningCheck = page.learningCheck.items.find((item) => item.checkpointId === attempt.checkpointId);
  if (!learningCheck) {
    fail(SPATIAL_ATTEMPT_ERROR_CODES.checkpointDisabled, `checkpoint is not enabled for submission: ${attempt.checkpointId}`);
  }
  const checkpoint = page.scene.checkpoints.find((candidate) => candidate.id === attempt.checkpointId);
  if (!checkpoint) {
    fail(SPATIAL_ATTEMPT_ERROR_CODES.checkpointMissing, `checkpoint does not exist: ${attempt.checkpointId}`);
  }
  validateResponse(page, attempt, checkpoint);
  return { page, attempt, binding, checkpoint, learningCheck };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < BigInt(0) ? -left : left;
  let b = right < BigInt(0) ? -right : right;
  while (b !== BigInt(0)) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function exactRational(numerator: bigint, denominator: bigint): Rational | null {
  if (denominator === BigInt(0)) return null;
  const sign = denominator < BigInt(0) ? BigInt(-1) : BigInt(1);
  let normalizedNumerator = numerator * sign;
  let normalizedDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(normalizedNumerator, normalizedDenominator);
  normalizedNumerator /= divisor;
  normalizedDenominator /= divisor;
  const limit = BigInt(EXACT_INTEGER_LIMIT);
  if (
    normalizedNumerator < -limit ||
    normalizedNumerator > limit ||
    normalizedDenominator < BigInt(1) ||
    normalizedDenominator > limit
  ) {
    return null;
  }
  return { numerator: Number(normalizedNumerator), denominator: Number(normalizedDenominator) };
}

function rationalBinary(operator: "+" | "-" | "*" | "/", left: Rational, right: Rational): Rational | null {
  const leftN = BigInt(left.numerator);
  const leftD = BigInt(left.denominator);
  const rightN = BigInt(right.numerator);
  const rightD = BigInt(right.denominator);
  if (operator === "+") return exactRational(leftN * rightD + rightN * leftD, leftD * rightD);
  if (operator === "-") return exactRational(leftN * rightD - rightN * leftD, leftD * rightD);
  if (operator === "*") return exactRational(leftN * rightN, leftD * rightD);
  return exactRational(leftN * rightD, leftD * rightN);
}

function rationalPower(base: Rational, exponent: number): Rational | null {
  if (exponent === 0) return { numerator: 1, denominator: 1 };
  const absoluteExponent = Math.abs(exponent);
  const numerator = BigInt(base.numerator) ** BigInt(absoluteExponent);
  const denominator = BigInt(base.denominator) ** BigInt(absoluteExponent);
  return exponent > 0 ? exactRational(numerator, denominator) : exactRational(denominator, numerator);
}

function voxelSet(page: SpatialPageDoc, entityId: string) {
  const entity = page.scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "voxel-set") return null;
  return createVoxelSet(entity.cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z })));
}

function evaluateExpression(page: SpatialPageDoc, expression: SpatialExpression): Rational | null {
  if (expression.kind === "constant") return expression.value;
  if (expression.kind === "parameter") return null;
  if (expression.kind === "measure") {
    const voxels = voxelSet(page, expression.entityId);
    if (!voxels) return null;
    const gridStep = page.scene.space.gridStep;
    if (expression.measure === "volume") {
      const scale = rationalPower(gridStep, 3);
      return scale ? rationalBinary("*", { numerator: voxels.size, denominator: 1 }, scale) : null;
    }
    if (expression.measure === "surface-area") {
      const scale = rationalPower(gridStep, 2);
      const faces = analyzeVoxelSurfaceArea(voxels).totalUnitFaces;
      return scale ? rationalBinary("*", { numerator: faces, denominator: 1 }, scale) : null;
    }
    return null;
  }
  if (expression.kind === "binary") {
    const left = evaluateExpression(page, expression.left);
    const right = evaluateExpression(page, expression.right);
    return left && right ? rationalBinary(expression.operator, left, right) : null;
  }
  const base = evaluateExpression(page, expression.base);
  return base ? rationalPower(base, expression.exponent) : null;
}

function expectedNumeric(page: SpatialPageDoc, checkpoint: Extract<SpatialCheckpoint, { type: "numeric" }>): Rational | null {
  const evaluator = checkpoint.evaluator;
  if (evaluator.kind === "exact") return evaluator.value;
  if (evaluator.kind === "formula") {
    const formula = page.scene.formulas.find((candidate) => candidate.id === evaluator.formulaId);
    return formula ? evaluateExpression(page, formula.expression) : null;
  }

  const query = evaluator.query;
  const voxels = voxelSet(page, query.entityId);
  if (!voxels) return null;
  if (query.kind === "voxel.total") return { numerator: voxels.size, denominator: 1 };
  if (query.kind === "voxel.layer-count") {
    const count = countVoxelLayers(voxels, query.axis).find((layer) => layer.coordinate === query.coordinate)?.count ?? 0;
    return { numerator: count, denominator: 1 };
  }
  if (query.kind === "voxel.hidden-count") {
    return { numerator: projectVoxels(voxels, query.view).hiddenVoxelCount, denominator: 1 };
  }
  if (query.kind === "voxel.surface-area") {
    const surface = analyzeVoxelSurfaceArea(voxels);
    const value =
      query.surface === "total"
        ? surface.totalUnitFaces
        : query.surface === "exterior"
          ? surface.exteriorUnitFaces
          : surface.interiorUnitFaces;
    return { numerator: value, denominator: 1 };
  }
  if (query.kind === "voxel.paint-category") {
    const value = analyzeSurfacePaint(voxels, {
      exposure: query.exposure,
      directions: query.directions,
    }).histogram[query.paintedFaceCount];
    return { numerator: value, denominator: 1 };
  }
  const value = findEnclosedVoxelCavities(voxels).reduce((sum, cavity) => sum + cavity.volumeInUnitCubes, 0);
  return { numerator: value, denominator: 1 };
}

function responseMatches(page: SpatialPageDoc, attempt: SpatialAttempt, checkpoint: SpatialCheckpoint): boolean | null {
  const response = attempt.response;
  if (checkpoint.type === "numeric" && response.kind === "numeric") {
    const expected = expectedNumeric(page, checkpoint);
    return expected ? compareRationals(response.value, expected) === 0 : null;
  }
  if (checkpoint.type === "choice" && response.kind === "choice") {
    return canonicalJsonStringify(response.optionIds) === canonicalJsonStringify(checkpoint.correctOptionIds);
  }
  if (checkpoint.type === "entity-selection" && response.kind === "entity-selection") {
    return canonicalJsonStringify(response.entityIds) === canonicalJsonStringify(checkpoint.expectedEntityIds);
  }
  if (checkpoint.type === "voxel-selection" && response.kind === "voxel-selection") {
    const responseCells = [...response.cells].sort(compareVoxelCoordinates);
    const expectedCells = [...checkpoint.expectedCells].sort(compareVoxelCoordinates);
    return canonicalJsonStringify(responseCells) === canonicalJsonStringify(expectedCells);
  }
  return null;
}

export async function evaluateSpatialAttempt(
  pageInput: unknown,
  attemptInput: unknown,
  bindingInput: unknown,
): Promise<SpatialAttemptEvaluation> {
  const verified = await verifySpatialAttempt(pageInput, attemptInput, bindingInput);
  const base = {
    evaluationVersion: "spatial-attempt-evaluation-v1" as const,
    attemptId: verified.attempt.attemptId,
    attemptFingerprint: spatialAttemptFingerprint(verified.attempt),
    sceneRevisionHash: verified.page.sceneHash,
    checkpointId: verified.checkpoint.id,
    authority: "server-pinned-kernel" as const,
    kernelVersion: verified.page.scene.provenance.kernelVersion,
  };
  if (verified.learningCheck.evaluation === "collect-evidence") {
    return parseSpatialAttemptEvaluation({ ...base, outcome: "collected", reason: "COLLECTED" });
  }
  const matches = responseMatches(verified.page, verified.attempt, verified.checkpoint);
  if (matches === null) {
    return parseSpatialAttemptEvaluation({ ...base, outcome: "not-evaluated", reason: "UNSUPPORTED_EVALUATOR" });
  }
  return parseSpatialAttemptEvaluation({
    ...base,
    outcome: matches ? "correct" : "incorrect",
    reason: matches ? "MATCH" : "MISMATCH",
  });
}

export function isExactSpatialAttemptRetry(previousInput: unknown, incomingInput: unknown): boolean {
  const previous = parseSpatialAttempt(previousInput);
  const incoming = parseSpatialAttempt(incomingInput);
  if (previous.idempotencyKey !== incoming.idempotencyKey) return false;
  if (canonicalJsonStringify(previous) !== canonicalJsonStringify(incoming)) {
    fail(SPATIAL_ATTEMPT_ERROR_CODES.idempotencyConflict, "idempotency key was reused with different attempt content");
  }
  return true;
}
