import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest, type CubeNetGalleryFoldingBuild } from "@/features/spatial-math/domain";
import { createCubeNetWorkbenchResolver } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { createCubeNetTeachingSession } from "@/features/tools/spatial-lab/cube-net-teaching-session";
import { createDiceScene } from "@/features/tools/spatial-lab/dice-teaching-model";
import { cubeNetCoursewareToolSchema, diceCoursewareToolSchema } from "@/features/tools/courseware/spatial-teaching-content";

export const legalNetEntries = () => createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal");
export const buildNet = (entryId = legalNetEntries()[0].id) => buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entryId));
export function netTool(build: CubeNetGalleryFoldingBuild) {
  const session = createCubeNetTeachingSession(build.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId));
  return cubeNetCoursewareToolSchema.parse({ toolId: "spatial-lab", contentVersion: "cube-net-lesson-v1", payload: { title: "Net fixture", initial: {
    source: { entryId: build.entry.id, cuts: null }, angles: session.angles, anchor: session.anchor, surfaces: session.surfaces,
    labels: {}, cutting: null, faceOffsets: {}, revealEnabled: false, view: "angle", axesVisible: true,
    frame: createCubeNetWorkbenchResolver(build, "en").resolve({}).model.bounds,
  } } });
}
export function diceTool() {
  const scene = createDiceScene();
  return diceCoursewareToolSchema.parse({ toolId: "spatial-lab", contentVersion: "dice-lesson-v1", payload: { title: "Dice fixture", initial: {
    scene, view: "angle", frame: { center: { x: 0, y: 0.5, z: 0 }, radius: 4 }, axes: false, grid: true, floor: true, arrows: false, selectedId: scene.dice[0].id,
  } } });
}
