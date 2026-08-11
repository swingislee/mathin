import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SPATIAL_SCENE_LIMITS,
  SPATIAL_SCENE_VERSION,
  canonicalJsonStringify,
  canonicalSha256,
  compareRationals,
  parseSpatialScene,
  rational,
  rationalSchema,
  spatialEntitySchema,
  spatialSceneSchema,
  type SpatialScene,
  type SpatialExpression,
} from "@/features/spatial-math/domain";

const ZERO = rational(0);
const ONE = rational(1);

function localized(zh: string, en?: string): { zh: string; en?: string } {
  return en ? { zh, en } : { zh };
}

function validSceneInput(): SpatialScene {
  return {
    schemaVersion: SPATIAL_SCENE_VERSION,
    sceneId: "scene.layer-count.001",
    title: localized("分层数正方体", "Count cubes by layer"),
    localePolicy: "bilingual",
    learning: {
      capability: "P2",
      learningGoal: localized("用逐层观察验证正方体总数", "Verify a cube count layer by layer"),
      termIds: ["solid-figures", "views-of-objects"],
      prerequisiteTermIds: ["solid-figures"],
      misconceptions: [localized("只数看得见的正方体")],
      teacherPrompts: [localized("先猜一猜，再逐层验证")],
    },
    space: {
      coordinateSystem: "right-handed-y-up",
      unit: "unit",
      gridStep: ONE,
    },
    model: {
      entities: [
        {
          id: "label.question",
          type: "label",
          visible: true,
          anchor: { x: ZERO, y: rational(3), z: ZERO },
          text: localized("一共有多少个正方体？", "How many cubes are there?"),
        },
        {
          id: "voxel.main",
          type: "voxel-set",
          label: localized("单位正方体模型", "Unit-cube model"),
          visible: true,
          materialToken: "voxel.base",
          cells: [
            { id: "cell.0.0.0", x: 0, y: 0, z: 0 },
            { id: "cell.0.1.0", x: 0, y: 1, z: 0 },
            { id: "cell.1.0.0", x: 1, y: 0, z: 0 },
          ],
        },
      ],
      parameters: [],
    },
    presentation: {
      background: "paper",
      lighting: "flat",
      showEdges: true,
      showAxes: false,
      cameraBookmarks: [
        {
          id: "camera.front",
          label: localized("正面", "Front"),
          projection: "orthographic",
          position: { x: 0, y: 1, z: 8 },
          target: { x: 0, y: 1, z: 0 },
          up: { x: 0, y: 1, z: 0 },
          zoom: 1,
        },
        {
          id: "camera.top",
          label: localized("上面", "Top"),
          projection: "orthographic",
          position: { x: 0, y: 8, z: 0 },
          target: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 0, z: -1 },
          zoom: 1,
        },
      ],
      defaultCameraId: "camera.front",
      layers: [
        {
          id: "layer.y0",
          label: localized("第 1 层", "Layer 1"),
          initiallyVisible: true,
          selector: { kind: "voxel-axis-range", entityId: "voxel.main", axis: "y", min: 0, max: 0 },
        },
      ],
    },
    sequence: {
      initialStepId: "step.predict",
      steps: [
        {
          id: "step.predict",
          title: localized("先预测", "Predict"),
          teacherPrompt: localized("不要转动模型，先说出你的猜想"),
          transition: "none",
          durationMs: 0,
          actions: [{ kind: "camera.apply", cameraId: "camera.front" }],
        },
        {
          id: "step.verify",
          title: localized("逐层验证", "Verify by layer"),
          announce: localized("现在显示第一层"),
          transition: "ease-in-out",
          durationMs: 300,
          actions: [
            { kind: "layer.set", layerId: "layer.y0", visible: true },
            { kind: "entity.select", entityIds: ["label.question", "voxel.main"] },
          ],
        },
      ],
    },
    checkpoints: [
      {
        id: "checkpoint.total",
        type: "numeric",
        prompt: localized("一共有多少个单位正方体？"),
        revealPolicy: "teacher",
        responseFormat: "integer",
        evaluator: { kind: "derived", query: { kind: "voxel.total", entityId: "voxel.main" } },
      },
    ],
    formulas: [
      {
        id: "formula.volume",
        label: localized("体积", "Volume"),
        expression: { kind: "measure", entityId: "voxel.main", measure: "volume" },
        unit: "unit",
        displaySteps: [],
      },
    ],
    accessibility: {
      summary: localized("三个单位正方体组成两层，下面两个，上面一个。"),
      orthographicViews: [
        { view: "front", summary: localized("正面看到 L 形的三个方格") },
        { view: "right", summary: localized("右面看到上下两个方格") },
        { view: "top", summary: localized("上面看到左右两个方格") },
      ],
      layerTable: { enabled: true, axis: "y" },
      measurementTable: true,
      objectDescriptions: [
        { entityId: "label.question", description: localized("计数问题文字") },
        { entityId: "voxel.main", description: localized("由三个单位正方体组成的模型") },
      ],
      keyboardOrder: ["voxel.main", "label.question"],
      colorLegend: [
        {
          materialToken: "voxel.base",
          label: localized("普通单位正方体"),
          pattern: "solid",
        },
      ],
    },
    provenance: {
      source: { kind: "scratch" },
      createdBy: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-11T10:00:00+08:00",
      kernelVersion: "voxel-kernel-v1",
      minRuntimeVersion: "1.0.0",
    },
  };
}

describe("spatial scene exact values and canonical JSON", () => {
  it("normalizes rational construction and rejects non-canonical stored values", () => {
    expect(rational(6, -8)).toEqual({ numerator: -3, denominator: 4 });
    expect(rational(0, 99)).toEqual({ numerator: 0, denominator: 1 });
    expect(rationalSchema.safeParse({ numerator: 2, denominator: 4 }).success).toBe(false);
    expect(rationalSchema.safeParse({ numerator: 0, denominator: 2 }).success).toBe(false);
    expect(
      compareRationals(
        { numerator: 999_999_999, denominator: 1_000_000_000 },
        { numerator: 999_999_998, denominator: 999_999_999 },
      ),
    ).toBe(1);
  });

  it("sorts object keys, preserves authored array order and normalizes negative zero", () => {
    const left = { z: [2, 1], nested: { b: -0, a: true } };
    const right = { nested: { a: true, b: 0 }, z: [2, 1] };

    expect(canonicalJsonStringify(left)).toBe('{"nested":{"a":true,"b":0},"z":[2,1]}');
    expect(canonicalJsonStringify(left)).toBe(canonicalJsonStringify(right));
    expect(canonicalJsonStringify({ z: [1, 2] })).not.toBe(canonicalJsonStringify({ z: [2, 1] }));
  });

  it("rejects cycles, non-finite values, undefined and class instances", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalJsonStringify(cyclic)).toThrow(/cyclic/);
    expect(() => canonicalJsonStringify({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJsonStringify({ value: undefined })).toThrow(/non-JSON/);
    expect(() => canonicalJsonStringify(new Date())).toThrow(/non-plain/);
  });

  it("produces the same browser-safe SHA-256 as the independent Node implementation", async () => {
    const value = { scene: "alpha", version: 1, flags: [true, false] };
    const expected = createHash("sha256").update(canonicalJsonStringify(value), "utf8").digest("hex");

    await expect(canonicalSha256(value)).resolves.toBe(expected);
  });
});

describe("spatial-scene-v1", () => {
  it("accepts a complete voxel teaching scene", async () => {
    const parsed = parseSpatialScene(validSceneInput());

    expect(parsed.schemaVersion).toBe(SPATIAL_SCENE_VERSION);
    expect(parsed.model.entities).toHaveLength(2);
    expect(parsed.sequence.steps.map((step) => step.id)).toEqual(["step.predict", "step.verify"]);
    expect(await canonicalSha256(parsed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts the planned primitive, polyhedron, guide and label entity families", () => {
    expect(
      spatialEntitySchema.safeParse({
        id: "primitive.cube",
        type: "primitive",
        label: localized("正方体"),
        visible: true,
        materialToken: "solid.primary",
        origin: { x: ZERO, y: ZERO, z: ZERO },
        orientationQuarterTurns: { x: 0, y: 0, z: 0 },
        definition: { kind: "cube", edge: ONE },
      }).success,
    ).toBe(true);
    expect(
      spatialEntitySchema.safeParse({
        id: "guide.section",
        type: "guide",
        visible: true,
        materialToken: "guide.section",
        definition: { kind: "plane", normal: { x: ONE, y: ZERO, z: ZERO }, constant: ZERO },
      }).success,
    ).toBe(true);
    expect(
      spatialEntitySchema.safeParse({
        id: "poly.tetrahedron",
        type: "polyhedron",
        visible: true,
        materialToken: "solid.secondary",
        vertices: [
          { id: "v0", position: { x: ZERO, y: ZERO, z: ZERO } },
          { id: "v1", position: { x: ONE, y: ZERO, z: ZERO } },
          { id: "v2", position: { x: ZERO, y: ONE, z: ZERO } },
          { id: "v3", position: { x: ZERO, y: ZERO, z: ONE } },
        ],
        faces: [
          { id: "f0", vertexIds: ["v0", "v2", "v1"] },
          { id: "f1", vertexIds: ["v0", "v1", "v3"] },
          { id: "f2", vertexIds: ["v0", "v3", "v2"] },
          { id: "f3", vertexIds: ["v1", "v2", "v3"] },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects unknown executable, shader, URL and markup fields", () => {
    const rootScript = { ...validSceneInput(), script: "alert(1)" };
    const scene = validSceneInput();
    const voxel = scene.model.entities.find((entity) => entity.type === "voxel-set");
    if (!voxel) throw new Error("fixture missing voxel entity");
    const shaderScene = {
      ...scene,
      model: {
        ...scene.model,
        entities: scene.model.entities.map((entity) =>
          entity.id === voxel.id ? { ...entity, shader: "void main(){}", url: "https://example.com/model.glb" } : entity,
        ),
      },
    };
    const markupScene = { ...validSceneInput(), title: { zh: "<script>bad</script>" } };

    expect(spatialSceneSchema.safeParse(rootScript).success).toBe(false);
    expect(spatialSceneSchema.safeParse(shaderScene).success).toBe(false);
    expect(spatialSceneSchema.safeParse(markupScene).success).toBe(false);
  });

  it("rejects duplicate coordinates and unstable set ordering", () => {
    const duplicate = validSceneInput();
    const duplicateVoxel = duplicate.model.entities.find((entity) => entity.type === "voxel-set");
    if (!duplicateVoxel) throw new Error("fixture missing voxel entity");
    duplicateVoxel.cells.push({ id: "cell.duplicate", x: 0, y: 0, z: 0 });

    const unsorted = validSceneInput();
    unsorted.model.entities.reverse();

    const unsortedAction = validSceneInput();
    unsortedAction.sequence.steps[0].actions.push({
      kind: "voxel.paint",
      entityId: "voxel.main",
      cells: [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      directions: ["y+", "x+"],
      materialToken: "voxel.highlight",
    });

    expect(spatialSceneSchema.safeParse(duplicate).success).toBe(false);
    expect(spatialSceneSchema.safeParse(unsorted).success).toBe(false);
    expect(spatialSceneSchema.safeParse(unsortedAction).success).toBe(false);
  });

  it("rejects dangling camera, layer, entity, parameter and formula references", () => {
    const camera = validSceneInput();
    camera.presentation.defaultCameraId = "camera.missing";

    const layer = validSceneInput();
    const firstLayer = layer.presentation.layers[0];
    if (firstLayer.selector.kind !== "voxel-axis-range") throw new Error("fixture layer mismatch");
    firstLayer.selector.entityId = "voxel.missing";

    const parameter = validSceneInput();
    parameter.sequence.steps[0].actions.push({
      kind: "parameter.set",
      parameterId: "parameter.missing",
      value: ONE,
    });

    const formula = validSceneInput();
    const firstCheckpoint = formula.checkpoints[0];
    if (firstCheckpoint.type !== "numeric") throw new Error("fixture checkpoint mismatch");
    firstCheckpoint.evaluator = { kind: "formula", formulaId: "formula.missing" };

    expect(spatialSceneSchema.safeParse(camera).success).toBe(false);
    expect(spatialSceneSchema.safeParse(layer).success).toBe(false);
    expect(spatialSceneSchema.safeParse(parameter).success).toBe(false);
    expect(spatialSceneSchema.safeParse(formula).success).toBe(false);
  });

  it("rejects non-canonical planes, invalid cameras and incomplete accessibility views", () => {
    const camera = validSceneInput();
    camera.presentation.cameraBookmarks[0].target = camera.presentation.cameraBookmarks[0].position;

    const accessibility = validSceneInput();
    accessibility.accessibility.orthographicViews[2] = {
      view: "front",
      summary: localized("重复正面"),
    };

    expect(spatialSceneSchema.safeParse(camera).success).toBe(false);
    expect(spatialSceneSchema.safeParse(accessibility).success).toBe(false);
  });

  it("enforces expression node/depth and scene byte budgets", () => {
    let expression: SpatialExpression = { kind: "constant", value: ONE };
    for (let index = 0; index < SPATIAL_SCENE_LIMITS.maxExpressionDepth; index += 1) {
      expression = { kind: "power", base: expression, exponent: 1 };
    }
    const deepExpression = validSceneInput();
    deepExpression.formulas[0].expression = expression;

    const oversized = validSceneInput();
    const voxel = oversized.model.entities.find((entity) => entity.type === "voxel-set");
    if (!voxel) throw new Error("fixture missing voxel entity");
    voxel.cells = Array.from({ length: 8_192 }, (_, index) => {
      const x = Math.floor(index / 4_096);
      const y = Math.floor(index / 64) % 64;
      const z = index % 64;
      return {
        id: `cell.${String(index).padStart(4, "0")}.${"x".repeat(55)}`,
        x,
        y,
        z,
      };
    });

    expect(spatialSceneSchema.safeParse(deepExpression).success).toBe(false);
    const oversizedResult = spatialSceneSchema.safeParse(oversized);
    expect(oversizedResult.success).toBe(false);
    if (!oversizedResult.success) {
      expect(oversizedResult.error.issues.some((issue) => issue.message.includes("scene size"))).toBe(true);
    }
  });
});
