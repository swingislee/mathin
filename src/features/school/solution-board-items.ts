import { parseBoardItems } from "@/features/classroom/checkpoint/parse";
import type { BoardItem } from "@/features/whiteboard/types";
import { annotationContentSchema } from "./teacher-preparation-contract";

/** 课堂归档保留笔刷版本，同时兼容旧解析中允许的长笔迹。 */
export function parseSolutionBoardItems(value: unknown): BoardItem[] | null {
  try {
    return parseBoardItems(value);
  } catch {
    const legacy = annotationContentSchema.safeParse(value);
    return legacy.success ? legacy.data : null;
  }
}
