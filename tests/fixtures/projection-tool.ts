import { createProjectionInitial, projectionToolSchema } from "@/features/tools/projection/projection-contract";

export function projectionTool() {
  return projectionToolSchema.parse({ toolId: "projection", contentVersion: "projection-lesson-v1", payload: { title: "Projection", initial: createProjectionInitial() } });
}
