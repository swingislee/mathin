import type { ClassroomToolUpdate, CoursewareToolRuntime } from "../courseware/tool-classroom";
import type { ToolScene, ToolSceneVersion } from "./contract";

type StateFor<V extends ToolSceneVersion> = Extract<ClassroomToolUpdate, { contentVersion: V }>["state"];

/** 统一实例状态读写接线；工具只使用自身状态，旧 wire identity 在边界保留。 */
export function toolSceneRuntime<V extends ToolSceneVersion>(
  scene: Pick<Extract<ToolScene, { contentVersion: V }>, "toolId" | "contentVersion">,
  classroom?: CoursewareToolRuntime,
): { state?: StateFor<V>; onChange?: (state: StateFor<V>) => Promise<void> } | undefined {
  if (!classroom) return undefined;
  const current = classroom.state;
  return {
    state: current?.toolId === scene.toolId && current.contentVersion === scene.contentVersion ? current.state as StateFor<V> : undefined,
    onChange: classroom.onChange ? (state) => classroom.onChange!({ toolId: scene.toolId, contentVersion: scene.contentVersion, state } as ClassroomToolUpdate) : undefined,
  };
}
