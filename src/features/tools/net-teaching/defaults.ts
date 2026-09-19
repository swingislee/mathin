import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest } from "@/features/spatial-math/domain";
import { createCubeNetTeachingSession } from "../spatial-lab/cube-net-teaching-session";
import { createCubeNetWorkbenchResolver } from "../spatial-lab/cube-net-workbench-model";
import { cubeNetTeachingSnapshotSchema } from "../courseware/spatial-teaching-content";
import { createDefaultPaperFoldingSnapshot } from "../paper-folding/contract";
import { createDefaultSolidNetsSnapshot } from "../solid-nets/contract";
import type { NetTeachingInitial, NetTeachingMode } from "./contract";

/** 默认形状从实际构建器得到，与课堂使用的拓扑一致。 */
export async function createNetTeachingInitial(mode: NetTeachingMode): Promise<NetTeachingInitial> {
  if (mode === "free-paper") return { mode, data: createDefaultPaperFoldingSnapshot() };
  if (mode === "solid-net") return { mode, data: createDefaultSolidNetsSnapshot() };
  const entry = createCubeNetGalleryCatalog().entries.find((entry) => entry.classification === "legal")!;
  const build = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id));
  const session = createCubeNetTeachingSession(build.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId));
  return { mode: "standard", data: cubeNetTeachingSnapshotSchema.parse({
    source: { entryId: build.entry.id, cuts: null }, angles: session.angles, anchor: session.anchor, surfaces: session.surfaces,
    labels: {}, cutting: null, faceOffsets: {}, revealEnabled: false, view: "angle", axesVisible: true,
    frame: createCubeNetWorkbenchResolver(build, "en").resolve({}).model.bounds,
  }) };
}
