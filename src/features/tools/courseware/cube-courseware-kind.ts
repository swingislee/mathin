import type { CubeCoursewareTool } from "./cube-structures-content";
import { CUBE_COURSEWARE_CONTENT_VERSION, CUBE_COURSEWARE_LEGACY_VERSION, CUBE_ROTATION_COURSEWARE_VERSION } from "./registry";

/** 只按版本判断立方体课件；分派渲染时不需要加载立方体合同与空间几何内核。 */
export function isCubeCoursewareTool(tool: { contentVersion: string }): tool is CubeCoursewareTool {
  return tool.contentVersion === CUBE_COURSEWARE_CONTENT_VERSION || tool.contentVersion === CUBE_COURSEWARE_LEGACY_VERSION || tool.contentVersion === CUBE_ROTATION_COURSEWARE_VERSION;
}
