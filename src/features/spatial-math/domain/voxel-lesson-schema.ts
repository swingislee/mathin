import { z } from "zod";
import { localizedTextSchema } from "./scene-schema";

export const VOXEL_LESSON_PLAN_VERSION = "voxel-lesson-plan-v1" as const;
export const VOXEL_LESSON_CAMERAS = ["front", "right", "top"] as const;

export const VOXEL_LESSON_LIMITS = {
  maxLogicalSteps: 12,
  maxTextCharacters: 2_000,
  maxLayerTitleCharacters: 1_990,
} as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "invalid stable id");

const lessonStepBase = {
  id: stableIdSchema,
  teacherPrompt: localizedTextSchema.optional(),
};

export const voxelLessonLayerTitleSchema = localizedTextSchema.superRefine((title, context) => {
  if (title.zh.length > VOXEL_LESSON_LIMITS.maxLayerTitleCharacters) {
    context.addIssue({ code: "custom", message: "layer title is too long", path: ["zh"] });
  }
  if (title.en && title.en.length > VOXEL_LESSON_LIMITS.maxLayerTitleCharacters) {
    context.addIssue({ code: "custom", message: "layer title is too long", path: ["en"] });
  }
});

export const voxelLessonStepSchema = z.discriminatedUnion("kind", [
  z.object({ ...lessonStepBase, kind: z.literal("predict"), title: localizedTextSchema }).strict(),
  z
    .object({
      ...lessonStepBase,
      kind: z.literal("view"),
      camera: z.enum(VOXEL_LESSON_CAMERAS),
      title: localizedTextSchema,
    })
    .strict(),
  z
    .object({
      ...lessonStepBase,
      kind: z.literal("layer-scan"),
      order: z.enum(["ascending", "descending"]),
      title: voxelLessonLayerTitleSchema,
    })
    .strict(),
  z.object({ ...lessonStepBase, kind: z.literal("verify"), title: localizedTextSchema }).strict(),
]);

export const voxelLessonPlanSchema = z
  .object({
    planVersion: z.literal(VOXEL_LESSON_PLAN_VERSION),
    steps: z.array(voxelLessonStepSchema).min(4).max(VOXEL_LESSON_LIMITS.maxLogicalSteps),
    checkpoint: z
      .object({
        prompt: localizedTextSchema,
        required: z.boolean(),
        maxSubmissions: z.number().int().min(1).max(10),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    const ids = new Set<string>();
    plan.steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        context.addIssue({ code: "custom", message: `duplicate lesson step id: ${step.id}`, path: ["steps", index, "id"] });
      }
      ids.add(step.id);
      if (step.kind === "view" && (step.id === "step.layers" || step.id.startsWith("step.layer."))) {
        context.addIssue({ code: "custom", message: "view step id collides with compiled layer steps", path: ["steps", index, "id"] });
      }
    });

    const predictSteps = plan.steps.filter((step) => step.kind === "predict");
    const verifySteps = plan.steps.filter((step) => step.kind === "verify");
    const layerSteps = plan.steps.filter((step) => step.kind === "layer-scan");
    if (predictSteps.length !== 1 || plan.steps[0]?.kind !== "predict" || plan.steps[0]?.id !== "step.predict") {
      context.addIssue({ code: "custom", message: "lesson must start with the single step.predict phase", path: ["steps"] });
    }
    const last = plan.steps.at(-1);
    if (verifySteps.length !== 1 || last?.kind !== "verify" || last.id !== "step.verify") {
      context.addIssue({ code: "custom", message: "lesson must end with the single step.verify phase", path: ["steps"] });
    }
    if (
      layerSteps.length !== 1 ||
      layerSteps[0]?.id !== "step.layers" ||
      plan.steps.at(-2)?.kind !== "layer-scan"
    ) {
      context.addIssue({ code: "custom", message: "lesson requires step.layers immediately before verification", path: ["steps"] });
    }
    const views = plan.steps.filter((step) => step.kind === "view");
    if (views.length < 1 || views.length > VOXEL_LESSON_CAMERAS.length) {
      context.addIssue({ code: "custom", message: "lesson requires one to three authored views", path: ["steps"] });
    }
    const cameras = views.map((step) => step.camera);
    if (new Set(cameras).size !== cameras.length) {
      context.addIssue({ code: "custom", message: "authored lesson views must use unique cameras", path: ["steps"] });
    }
  });

export type VoxelLessonStep = z.infer<typeof voxelLessonStepSchema>;
export type VoxelLessonPlan = z.infer<typeof voxelLessonPlanSchema>;
export type VoxelLessonCamera = (typeof VOXEL_LESSON_CAMERAS)[number];

export function parseVoxelLessonPlan(input: unknown): VoxelLessonPlan {
  return voxelLessonPlanSchema.parse(input);
}

export function isVoxelLayerSceneStepId(stepId: string | null | undefined): boolean {
  return stepId?.startsWith("step.layer.") ?? false;
}

export function isVoxelVerifySceneStepId(stepId: string | null | undefined): boolean {
  return stepId === "step.verify";
}

export function createDefaultVoxelLessonPlan(
  teacherPrompt: z.infer<typeof localizedTextSchema>,
): VoxelLessonPlan {
  return parseVoxelLessonPlan({
    planVersion: VOXEL_LESSON_PLAN_VERSION,
    steps: [
      {
        id: "step.predict",
        kind: "predict",
        title: { zh: "先预测", en: "Predict" },
        teacherPrompt,
      },
      { id: "step.front", kind: "view", camera: "front", title: { zh: "看正面", en: "Front view" } },
      { id: "step.right", kind: "view", camera: "right", title: { zh: "看右面", en: "Right view" } },
      { id: "step.top", kind: "view", camera: "top", title: { zh: "看上面", en: "Top view" } },
      {
        id: "step.layers",
        kind: "layer-scan",
        title: { zh: "观察", en: "Observe layer" },
        order: "ascending",
      },
      {
        id: "step.verify",
        kind: "verify",
        title: { zh: "合并验证", en: "Verify total" },
        teacherPrompt: {
          zh: "把各层数量相加，再与整体核对。",
          en: "Add the layer counts, then check the whole model.",
        },
      },
    ],
    checkpoint: {
      prompt: { zh: "一共有多少个单位正方体？", en: "How many unit cubes are there?" },
      required: true,
      maxSubmissions: 3,
    },
  });
}
