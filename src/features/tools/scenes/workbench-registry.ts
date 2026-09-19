"use client";

import { fractionSceneAdapter } from "../fraction-line/scene-adapter";
import { motionSceneAdapter } from "../motion-lab/scene-adapter";
import { cubeSceneAdapter, cubeRotationSceneAdapter } from "../spatial-lab/cube-scene-adapter";
import { netSceneAdapter } from "../spatial-lab/net-scene-adapter";
import { diceSceneAdapter } from "../spatial-lab/dice-scene-adapter";
import { projectionSceneAdapter } from "../projection/scene-adapter";
import { solidGeometrySceneAdapter } from "../solid-geometry/scene-adapter";
import { netTeachingSceneAdapter } from "../net-teaching/scene-adapter";
import { solidCapacitySceneAdapter } from "../solid-capacity/scene-adapter";
import type { ToolSceneVersion } from "./contract";
import type { ToolWorkbenchAdapter } from "./workbench-adapter";

/** 仅客户端工作台加载接线；公开目录与服务端合同继续使用轻量 registry。 */
const adapters = {
  [cubeSceneAdapter.contentVersion]: cubeSceneAdapter,
  [cubeRotationSceneAdapter.contentVersion]: cubeRotationSceneAdapter,
  [netSceneAdapter.contentVersion]: netSceneAdapter,
  [diceSceneAdapter.contentVersion]: diceSceneAdapter,
  [fractionSceneAdapter.contentVersion]: fractionSceneAdapter,
  [motionSceneAdapter.contentVersion]: motionSceneAdapter,
  [projectionSceneAdapter.contentVersion]: projectionSceneAdapter,
  [solidGeometrySceneAdapter.contentVersion]: solidGeometrySceneAdapter,
  [netTeachingSceneAdapter.contentVersion]: netTeachingSceneAdapter,
  [solidCapacitySceneAdapter.contentVersion]: solidCapacitySceneAdapter,
} satisfies Record<ToolSceneVersion, ToolWorkbenchAdapter>;

export function getToolWorkbenchAdapter(version: ToolSceneVersion): ToolWorkbenchAdapter {
  return adapters[version];
}
