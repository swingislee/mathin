import { planeGeometryScenes } from "../plane-geometry/scenes";
import { planeAreaScenes } from "../plane-area/scenes";
import { planeMotionScenes } from "../plane-motion/scenes";
import { planePatternsScenes } from "../plane-patterns/scenes";
import { planeShapesScene } from "../plane-shapes/scene";
import { PLANAR_TOOLS, ALL_PLANAR_TOOLS, type PlanarToolId } from "./contract";
import type { PlanarSceneDefinition } from "./types";

const domains = [planeShapesScene, ...planeGeometryScenes, ...planeAreaScenes, ...planeMotionScenes, ...planePatternsScenes];
/** 工程目录按共用数学能力分工，教师入口按教学用途归类，二者相互独立。 */
const allScenes: readonly PlanarSceneDefinition[] = domains.map((scene) => {
  const tool = ALL_PLANAR_TOOLS.find((item) => (item.scenes as readonly string[]).includes(scene.id));
  if (!tool) throw new Error(`Unregistered planar scene: ${scene.id}`);
  return { ...scene, toolId: tool.id };
});
export const planarScenes = allScenes.filter((scene) => PLANAR_TOOLS.some((tool) => (tool.scenes as readonly string[]).includes(scene.id)));
export function scenesForPlanarTool(toolId: PlanarToolId) {
  const tool = ALL_PLANAR_TOOLS.find((item) => item.id === toolId)!;
  return allScenes.filter((scene) => (tool.scenes as readonly string[]).includes(scene.id));
}
export function planarScene(id: string) {
  const scene = allScenes.find((entry) => entry.id === id);
  if (!scene) throw new Error(`Unknown planar scene: ${id}`);
  return scene;
}
