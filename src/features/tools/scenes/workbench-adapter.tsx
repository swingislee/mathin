"use client";

import { createElement, type ComponentType, type ReactNode } from "react";
import type { ToolScene, ToolSceneVersion } from "./contract";
import type { CoursewareToolRuntime } from "../courseware/tool-classroom";

export type SceneOf<V extends ToolSceneVersion> = Extract<ToolScene, { contentVersion: V }>;
export interface ToolPreparationProps<V extends ToolSceneVersion = ToolSceneVersion> {
  existing?: SceneOf<V>;
  title: string;
  fullHeight: boolean;
  /** null 表示正在交互或构建，候选现场由共用宿主执行严格校验。 */
  onChange: (candidate: unknown | null) => void;
}
export interface ToolPresentationProps<V extends ToolSceneVersion = ToolSceneVersion> {
  scene: SceneOf<V>;
  classroom?: CoursewareToolRuntime;
}
export interface ToolSceneImportProps { onOpen: (scene: ToolScene) => void }

/** 工具的宿主接线只登记一次，备课和课堂复用工具原组件。 */
export interface ToolWorkbenchAdapter {
  contentVersion: ToolSceneVersion;
  Preparation: ComponentType<ToolPreparationProps>;
  Presentation: ComponentType<ToolPresentationProps>;
  Import?: ComponentType<ToolSceneImportProps>;
}

function matchesVersion<V extends ToolSceneVersion>(scene: ToolScene, version: V): scene is SceneOf<V> {
  return scene.contentVersion === version;
}

export function defineToolWorkbenchAdapter<V extends ToolSceneVersion>(adapter: {
  contentVersion: V;
  Preparation: ComponentType<ToolPreparationProps<V>>;
  Presentation: ComponentType<ToolPresentationProps<V>>;
  Import?: ComponentType<ToolSceneImportProps>;
}): ToolWorkbenchAdapter & { contentVersion: V } {
  return {
    contentVersion: adapter.contentVersion,
    Preparation(props) {
      const existing = props.existing;
      if (existing && !matchesVersion(existing, adapter.contentVersion)) throw new Error("TOOL_SCENE_ADAPTER_MISMATCH");
      return createElement(adapter.Preparation, { ...props, existing });
    },
    Presentation(props) {
      const scene = props.scene;
      if (!matchesVersion(scene, adapter.contentVersion)) throw new Error("TOOL_SCENE_ADAPTER_MISMATCH");
      return createElement(adapter.Presentation, { ...props, scene });
    },
    Import: adapter.Import,
  };
}

/** 统一舞台尺寸；工具专属备课选项在舞台外，不占用插入组件的画布。 */
export function ToolPreparationStage({ version, fullHeight, controls, children }: {
  version: ToolSceneVersion; fullHeight: boolean; controls?: ReactNode; children: ReactNode;
}) {
  return <div className={fullHeight ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}>
    {controls}
    <div className={fullHeight ? "flex min-h-0 flex-1" : "flex aspect-[4/3] min-h-0 w-full"} data-tool-scene-editor={version}>{children}</div>
  </div>;
}
