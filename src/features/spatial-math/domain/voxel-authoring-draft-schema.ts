import { z } from "zod";
import { canonicalJsonStringify } from "./canonical-json";
import { compileVoxelLessonScene } from "./voxel-lesson-adapter";
import { voxelLessonPlanSchema } from "./voxel-lesson-schema";
import { voxelSceneAdapterInputSchema } from "./voxel-scene-adapter-schema";

export const VOXEL_AUTHORING_DRAFT_VERSION = "voxel-authoring-draft-v1" as const;

export const VOXEL_AUTHORING_DRAFT_LIMITS = {
  maxBytes: 512 * 1_024,
} as const;

export const VOXEL_AUTHORING_DRAFT_ISSUES = {
  compile: "authoring draft does not compile within spatial-scene-v1 limits",
} as const;

function localizedTextEquals(
  left: { readonly zh: string; readonly en?: string },
  right: { readonly zh: string; readonly en?: string },
): boolean {
  return left.zh === right.zh && left.en === right.en;
}

export const voxelAuthoringDraftSchema = z
  .object({
    draftVersion: z.literal(VOXEL_AUTHORING_DRAFT_VERSION),
    model: voxelSceneAdapterInputSchema,
    lesson: voxelLessonPlanSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    let canCompile = true;
    const predictStep = draft.lesson.steps[0];
    if (predictStep?.kind !== "predict" || !predictStep.teacherPrompt) {
      canCompile = false;
      context.addIssue({
        code: "custom",
        message: "authoring draft predict step requires teacherPrompt",
        path: ["lesson", "steps", 0, "teacherPrompt"],
      });
    } else if (!localizedTextEquals(predictStep.teacherPrompt, draft.model.teacherPrompt)) {
      canCompile = false;
      context.addIssue({
        code: "custom",
        message: "model teacherPrompt must mirror the lesson predict teacherPrompt",
        path: ["model", "teacherPrompt"],
      });
    }

    try {
      const bytes = new TextEncoder().encode(canonicalJsonStringify(draft)).byteLength;
      if (bytes > VOXEL_AUTHORING_DRAFT_LIMITS.maxBytes) {
        canCompile = false;
        context.addIssue({
          code: "custom",
          message: `authoring draft size ${bytes} exceeds ${VOXEL_AUTHORING_DRAFT_LIMITS.maxBytes} bytes`,
          path: [],
        });
      }
    } catch {
      canCompile = false;
      context.addIssue({
        code: "custom",
        message: "authoring draft must contain only canonical JSON values",
        path: [],
      });
    }

    if (canCompile) {
      try {
        compileVoxelLessonScene(draft.model, draft.lesson);
      } catch {
        context.addIssue({
          code: "custom",
          message: VOXEL_AUTHORING_DRAFT_ISSUES.compile,
          path: [],
        });
      }
    }
  });

export type VoxelAuthoringDraft = z.infer<typeof voxelAuthoringDraftSchema>;

export function parseVoxelAuthoringDraft(input: unknown): VoxelAuthoringDraft {
  return voxelAuthoringDraftSchema.parse(input);
}
