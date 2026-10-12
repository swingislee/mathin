import { z } from "zod";
import { TASK_IMAGE_BYTES, TASK_VIDEO_BYTES } from "../../../contracts/participant-api/task-submission";
export const taskSubmissionRulesSchema = z.object({ version: z.literal(1), mediaTypes: z.array(z.enum(["image", "video"])).max(2).refine(v => new Set(v).size === v.length),
  minFiles: z.number().int().min(0).max(9), maxFiles: z.number().int().min(0).max(9), noteRequired: z.boolean(), maxNoteLength: z.number().int().min(1).max(2000),
  imageMaxBytes: z.number().int().min(1).max(TASK_IMAGE_BYTES), videoMaxBytes: z.number().int().min(1).max(TASK_VIDEO_BYTES),
}).strict().refine(v => v.minFiles <= v.maxFiles && (v.maxFiles === 0 ? v.mediaTypes.length === 0 && v.noteRequired : v.mediaTypes.length > 0));
