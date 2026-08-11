import { describe, expect, it } from "vitest";
import {
  SPATIAL_ATTEMPT_ERROR_CODES,
  SPATIAL_PAGE_ERROR_CODES,
  SpatialAttemptContractError,
  evaluateSpatialAttempt,
  isExactSpatialAttemptRetry,
  materializeSpatialPageDoc,
  parseSpatialAttempt,
  rational,
  spatialAttemptFingerprint,
  type SpatialAttempt,
  type SpatialAttemptBinding,
  type SpatialAttemptResponse,
  type SpatialPageDoc,
  type SpatialScene,
} from "@/features/spatial-math/domain";
import { standardSpatialPageDraft, validSpatialScene, validStandardSpatialPage } from "./fixtures/spatial-page";

const SESSION_ID = "session.001";
const PAGE_DOC_ID = "page.001";
const STUDENT_ID = "student.001";
const RUNTIME_STATE_HASH = "1".repeat(64);

function trustedBinding(overrides: Partial<SpatialAttemptBinding> = {}): SpatialAttemptBinding {
  return {
    sessionId: SESSION_ID,
    pageDocId: PAGE_DOC_ID,
    studentId: STUDENT_ID,
    currentResetEpoch: 0,
    runtimeStateHash: RUNTIME_STATE_HASH,
    nextAttemptNo: 1,
    ...overrides,
  };
}

function attemptFor(
  page: SpatialPageDoc,
  checkpointId: string,
  response: SpatialAttemptResponse,
  overrides: Partial<SpatialAttempt> = {},
): SpatialAttempt {
  const attempt: SpatialAttempt = {
    attemptVersion: "spatial-attempt-v1",
    attemptId: "attempt.001",
    idempotencyKey: "idempotency.001",
    sceneRevisionHash: page.sceneHash,
    checkpointId,
    context: {
      sessionId: SESSION_ID,
      pageDocId: PAGE_DOC_ID,
      studentId: STUDENT_ID,
      resetEpoch: 0,
      runtimeStateHash: RUNTIME_STATE_HASH,
      attemptNo: 1,
    },
    submittedAt: "2026-08-11T12:00:00+08:00",
    response,
    ...overrides,
  };
  return parseSpatialAttempt(attempt);
}

async function expectContractCode(action: () => unknown | Promise<unknown>, code: string): Promise<void> {
  try {
    await action();
    throw new Error(`expected contract error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SpatialAttemptContractError);
    expect((error as SpatialAttemptContractError).code).toBe(code);
  }
}

async function pageWithAllResponseKinds(): Promise<SpatialPageDoc> {
  const scene = validSpatialScene();
  scene.checkpoints.push(
    {
      id: "checkpoint.choice",
      type: "choice",
      prompt: { zh: "选择正确答案", en: "Choose the correct answer" },
      revealPolicy: "after-submit",
      multiple: false,
      options: [
        { id: "option.a", label: { zh: "一个", en: "One" } },
        { id: "option.b", label: { zh: "两个", en: "Two" } },
      ],
      correctOptionIds: ["option.a"],
    },
    {
      id: "checkpoint.entity",
      type: "entity-selection",
      prompt: { zh: "选择立方体", en: "Select the cube" },
      revealPolicy: "teacher",
      expectedEntityIds: ["voxel.main"],
    },
    {
      id: "checkpoint.voxel",
      type: "voxel-selection",
      prompt: { zh: "选择单位正方体", en: "Select the unit cube" },
      revealPolicy: "teacher",
      entityId: "voxel.main",
      expectedCells: [{ x: 0, y: 0, z: 0 }],
    },
    {
      id: "checkpoint.formula",
      type: "numeric",
      prompt: { zh: "表面积是多少？", en: "What is the surface area?" },
      revealPolicy: "after-submit",
      responseFormat: "integer",
      evaluator: { kind: "formula", formulaId: "formula.surface" },
    },
  );
  scene.formulas.push({
    id: "formula.surface",
    label: { zh: "表面积", en: "Surface area" },
    expression: { kind: "measure", entityId: "voxel.main", measure: "surface-area" },
    unit: "unit",
    displaySteps: [],
  });

  const draft = standardSpatialPageDraft(scene);
  if (draft.learningCheck.mode !== "formative-only") throw new Error("fixture must enable formative checks");
  draft.learningCheck.items.push(
    { checkpointId: "checkpoint.choice", required: false, evaluation: "server-pinned-kernel" },
    { checkpointId: "checkpoint.entity", required: false, evaluation: "server-pinned-kernel" },
    { checkpointId: "checkpoint.voxel", required: false, evaluation: "server-pinned-kernel" },
    { checkpointId: "checkpoint.formula", required: false, evaluation: "server-pinned-kernel" },
  );
  draft.fallback.checkpoints.push(
    { checkpointId: "checkpoint.choice", mode: "interactive-2d" },
    { checkpointId: "checkpoint.entity", mode: "interactive-2d" },
    { checkpointId: "checkpoint.voxel", mode: "interactive-2d" },
    { checkpointId: "checkpoint.formula", mode: "interactive-2d" },
  );
  return materializeSpatialPageDoc(draft);
}

type NumericCheckpoint = Extract<SpatialScene["checkpoints"][number], { type: "numeric" }>;
type DerivedQuery = Extract<NumericCheckpoint["evaluator"], { kind: "derived" }>["query"];

async function pageForDerivedQuery(query: DerivedQuery): Promise<SpatialPageDoc> {
  const scene = validSpatialScene();
  const checkpoint = scene.checkpoints[0];
  if (checkpoint?.type !== "numeric") throw new Error("fixture must begin with a numeric checkpoint");
  checkpoint.evaluator = { kind: "derived", query };
  return materializeSpatialPageDoc(standardSpatialPageDraft(scene));
}

describe("spatial-attempt-v1 schema", () => {
  it("accepts a canonical bounded response and rejects unknown fields", async () => {
    const page = await validStandardSpatialPage();
    const attempt = attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) });

    expect(parseSpatialAttempt(attempt)).toEqual(attempt);
    expect(() => parseSpatialAttempt({ ...attempt, unexpected: true })).toThrow();
    expect(spatialAttemptFingerprint(attempt)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects duplicate or unstable selection order before evaluation", async () => {
    const page = await validStandardSpatialPage();
    const base = attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) });

    expect(() => parseSpatialAttempt({ ...base, response: { kind: "choice", optionIds: ["option.b", "option.a"] } })).toThrow();
    expect(() => parseSpatialAttempt({ ...base, response: { kind: "choice", optionIds: ["option.a", "option.a"] } })).toThrow();
    expect(() =>
      parseSpatialAttempt({
        ...base,
        response: { kind: "entity-selection", entityIds: ["voxel.z", "voxel.a"] },
      }),
    ).toThrow();
    expect(() =>
      parseSpatialAttempt({
        ...base,
        response: {
          kind: "voxel-selection",
          entityId: "voxel.main",
          cells: [
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects unsafe explanation control characters", async () => {
    const page = await validStandardSpatialPage();
    const base = attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) });
    expect(() => parseSpatialAttempt({ ...base, response: { kind: "explanation", text: "可见\u0000内容" } })).toThrow();
  });
});

describe("trusted submission binding", () => {
  it("rejects forged frozen-scene hashes", async () => {
    const page = await validStandardSpatialPage();
    const attempt = attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) });
    await expectContractCode(
      () => evaluateSpatialAttempt(page, { ...attempt, sceneRevisionHash: "0".repeat(64) }, trustedBinding()),
      SPATIAL_ATTEMPT_ERROR_CODES.sceneMismatch,
    );
  });

  it("recomputes the frozen page hash before using its answer model", async () => {
    const page = await validStandardSpatialPage();
    const attempt = attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) });
    const tampered = structuredClone(page);
    tampered.scene.title.zh = "被篡改的场景";

    await expect(evaluateSpatialAttempt(tampered, attempt, trustedBinding())).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.sceneHashMismatch,
    });
  });

  it("binds session, page, student, reset epoch, state and server-known attempt sequence", async () => {
    const page = await validStandardSpatialPage();
    const attempt = attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) });
    const variants: SpatialAttempt[] = [
      { ...attempt, context: { ...attempt.context, sessionId: "session.forged" } },
      { ...attempt, context: { ...attempt.context, pageDocId: "page.forged" } },
      { ...attempt, context: { ...attempt.context, studentId: "student.forged" } },
      { ...attempt, context: { ...attempt.context, resetEpoch: 1 } },
      { ...attempt, context: { ...attempt.context, runtimeStateHash: "2".repeat(64) } },
      { ...attempt, context: { ...attempt.context, attemptNo: 2 } },
    ];
    for (const variant of variants) {
      await expectContractCode(
        () => evaluateSpatialAttempt(page, variant, trustedBinding()),
        SPATIAL_ATTEMPT_ERROR_CODES.bindingMismatch,
      );
    }
  });

  it("enforces page submission limits and enabled checkpoints", async () => {
    const page = await validStandardSpatialPage();
    const fourth = attemptFor(
      page,
      "checkpoint.count",
      { kind: "numeric", value: rational(1) },
      { context: { ...attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) }).context, attemptNo: 4 } },
    );
    await expectContractCode(
      () => evaluateSpatialAttempt(page, fourth, trustedBinding({ nextAttemptNo: 4 })),
      SPATIAL_ATTEMPT_ERROR_CODES.attemptLimit,
    );
    await expectContractCode(
      () =>
        evaluateSpatialAttempt(
          page,
          attemptFor(page, "checkpoint.not-enabled", { kind: "numeric", value: rational(1) }),
          trustedBinding(),
        ),
      SPATIAL_ATTEMPT_ERROR_CODES.checkpointDisabled,
    );
  });
});

describe("server-pinned spatial attempt evaluation", () => {
  it("evaluates every response kind without trusting a client score", async () => {
    const page = await pageWithAllResponseKinds();
    const cases: Array<[string, SpatialAttemptResponse, string]> = [
      ["checkpoint.count", { kind: "numeric", value: rational(1) }, "correct"],
      ["checkpoint.count", { kind: "numeric", value: rational(2) }, "incorrect"],
      ["checkpoint.choice", { kind: "choice", optionIds: ["option.a"] }, "correct"],
      ["checkpoint.choice", { kind: "choice", optionIds: ["option.b"] }, "incorrect"],
      ["checkpoint.entity", { kind: "entity-selection", entityIds: ["voxel.main"] }, "correct"],
      ["checkpoint.voxel", { kind: "voxel-selection", entityId: "voxel.main", cells: [{ x: 0, y: 0, z: 0 }] }, "correct"],
      ["checkpoint.formula", { kind: "numeric", value: rational(6) }, "correct"],
      ["checkpoint.explain", { kind: "explanation", text: "逐层计数" }, "collected"],
    ];

    for (const [index, [checkpointId, response, outcome]] of cases.entries()) {
      const evaluation = await evaluateSpatialAttempt(
        page,
        attemptFor(page, checkpointId, response, { attemptId: `attempt.${index}` }),
        trustedBinding(),
      );
      expect(evaluation.outcome).toBe(outcome);
      expect(evaluation.authority).toBe("server-pinned-kernel");
      expect(evaluation.kernelVersion).toBe("voxel-kernel-v1");
    }
  });

  it("evaluates every pinned voxel query with exact integer results", async () => {
    const cases: Array<[DerivedQuery, number]> = [
      [{ kind: "voxel.total", entityId: "voxel.main" }, 1],
      [{ kind: "voxel.layer-count", entityId: "voxel.main", axis: "y", coordinate: 0 }, 1],
      [{ kind: "voxel.hidden-count", entityId: "voxel.main", view: "front" }, 0],
      [{ kind: "voxel.surface-area", entityId: "voxel.main", surface: "total" }, 6],
      [
        {
          kind: "voxel.paint-category",
          entityId: "voxel.main",
          paintedFaceCount: 6,
          exposure: "exterior-only",
          directions: ["x-", "x+", "y-", "y+", "z-", "z+"],
        },
        1,
      ],
      [{ kind: "voxel.cavity-volume", entityId: "voxel.main" }, 0],
    ];

    for (const [query, expected] of cases) {
      const page = await pageForDerivedQuery(query);
      const evaluation = await evaluateSpatialAttempt(
        page,
        attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(expected) }),
        trustedBinding(),
      );
      expect(evaluation.outcome, query.kind).toBe("correct");
    }
  });

  it("returns not-evaluated for a valid formula the pinned kernel cannot derive", async () => {
    const scene = validSpatialScene();
    scene.formulas.push({
      id: "formula.length",
      label: { zh: "长度", en: "Length" },
      expression: { kind: "measure", entityId: "voxel.main", measure: "length" },
      unit: "unit",
      displaySteps: [],
    });
    const checkpoint = scene.checkpoints[0];
    if (checkpoint?.type !== "numeric") throw new Error("fixture must begin with a numeric checkpoint");
    checkpoint.evaluator = { kind: "formula", formulaId: "formula.length" };
    const page = await materializeSpatialPageDoc(standardSpatialPageDraft(scene));

    await expect(
      evaluateSpatialAttempt(
        page,
        attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) }),
        trustedBinding(),
      ),
    ).resolves.toMatchObject({ outcome: "not-evaluated", reason: "UNSUPPORTED_EVALUATOR" });
  });

  it("rejects mismatched response kinds and semantically invalid values", async () => {
    const page = await pageWithAllResponseKinds();
    await expectContractCode(
      () =>
        evaluateSpatialAttempt(
          page,
          attemptFor(page, "checkpoint.count", { kind: "choice", optionIds: ["option.a"] }),
          trustedBinding(),
        ),
      SPATIAL_ATTEMPT_ERROR_CODES.responseTypeMismatch,
    );
    await expectContractCode(
      () =>
        evaluateSpatialAttempt(
          page,
          attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1, 2) }),
          trustedBinding(),
        ),
      SPATIAL_ATTEMPT_ERROR_CODES.responseInvalid,
    );
    await expectContractCode(
      () =>
        evaluateSpatialAttempt(
          page,
          attemptFor(page, "checkpoint.choice", { kind: "choice", optionIds: ["option.unknown"] }),
          trustedBinding(),
        ),
      SPATIAL_ATTEMPT_ERROR_CODES.responseInvalid,
    );
  });

  it("keeps raw student evidence and expected answers out of the evaluation payload", async () => {
    const page = await pageWithAllResponseKinds();
    const evidence = "我先观察，再逐层计数。";
    const evaluation = await evaluateSpatialAttempt(
      page,
      attemptFor(page, "checkpoint.explain", { kind: "explanation", text: evidence }),
      trustedBinding(),
    );
    const serialized = JSON.stringify(evaluation);

    expect(Object.keys(evaluation).sort()).toEqual(
      [
        "attemptFingerprint",
        "attemptId",
        "authority",
        "checkpointId",
        "evaluationVersion",
        "kernelVersion",
        "outcome",
        "reason",
        "sceneRevisionHash",
      ].sort(),
    );
    expect(serialized).not.toContain(evidence);
    expect(serialized).not.toContain(STUDENT_ID);
    expect(serialized).not.toContain(SESSION_ID);
    expect(serialized).not.toContain("correctOptionIds");
  });
});

describe("attempt retry idempotency", () => {
  it("accepts exact retries, separates new keys and rejects key reuse with changed content", async () => {
    const page = await validStandardSpatialPage();
    const attempt = attemptFor(page, "checkpoint.count", { kind: "numeric", value: rational(1) });

    expect(isExactSpatialAttemptRetry(attempt, structuredClone(attempt))).toBe(true);
    expect(isExactSpatialAttemptRetry(attempt, { ...attempt, idempotencyKey: "idempotency.002" })).toBe(false);
    await expectContractCode(
      () => isExactSpatialAttemptRetry(attempt, { ...attempt, response: { kind: "numeric", value: rational(2) } }),
      SPATIAL_ATTEMPT_ERROR_CODES.idempotencyConflict,
    );
  });
});
