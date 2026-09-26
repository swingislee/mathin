import { planeGeometryScenes } from "../plane-geometry/scenes";
import { planeAreaScenes } from "../plane-area/scenes";
import { planeMotionScenes } from "../plane-motion/scenes";
import { planePatternsScenes } from "../plane-patterns/scenes";
import { PLANAR_TOOLS, type PlanarToolId } from "./contract";
import type { PlanarSceneDefinition } from "./types";

const domains = [...planeGeometryScenes, ...planeAreaScenes, ...planeMotionScenes, ...planePatternsScenes];
/** 工程目录按共用数学能力分工，教师入口按教学用途归类，二者相互独立。 */
export const planarScenes: readonly PlanarSceneDefinition[] = domains.map((scene) => {
  const tool = PLANAR_TOOLS.find((item) => (item.scenes as readonly string[]).includes(scene.id));
  if (!tool) throw new Error(`Unregistered planar scene: ${scene.id}`);
  return { ...scene, toolId: tool.id };
});
export function scenesForPlanarTool(toolId: PlanarToolId) { return planarScenes.filter((scene) => scene.toolId === toolId); }
export function planarScene(id: string) {
  const scene = planarScenes.find((entry) => entry.id === id);
  if (!scene) throw new Error(`Unknown planar scene: ${id}`);
  return scene;
}
