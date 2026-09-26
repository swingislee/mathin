import { z } from "zod";
import { interpolatePlanePoint, type PlanePoint } from "../planar-interaction/geometry";

export const PLANE_DISSECTION_PREVIEW_VERSION = "plane-dissection-preview-v1" as const;
const pointSchema = z.object({ x: z.number().finite().min(-12).max(12), y: z.number().finite().min(-8).max(8) }).strict();
export const planeDissectionSchema = z.object({
  version: z.literal(PLANE_DISSECTION_PREVIEW_VERSION),
  base: z.number().finite().min(3).max(8), height: z.number().finite().min(1.5).max(5),
  slant: z.number().finite().min(0.5).max(2.5), cut: z.boolean(),
  body: pointSchema, offcut: pointSchema,
  snap: z.boolean(), showOrigin: z.boolean(), showMeasures: z.boolean(), showArea: z.boolean(), showGrid: z.boolean(),
}).strict();
export type PlaneDissectionScene = z.infer<typeof planeDissectionSchema>;
export type PaperId = "body" | "offcut";
export interface PaperSnap { position: PlanePoint; kind: "rectangle" | "origin" }
export function defaultPlaneDissection(): PlaneDissectionScene {
  return { version: PLANE_DISSECTION_PREVIEW_VERSION, base: 6, height: 3, slant: 1.5, cut: false,
    body: { x: 0, y: 0 }, offcut: { x: 0, y: 0 }, snap: true, showOrigin: true, showMeasures: true, showArea: false, showGrid: false };
}
export function paperPolygons(scene: PlaneDissectionScene) {
  const { base: b, height: h, slant: s } = scene;
  return {
    whole: [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: b + s, y: -h }, { x: s, y: -h }],
    body: [{ x: s, y: 0 }, { x: b, y: 0 }, { x: b + s, y: -h }, { x: s, y: -h }],
    offcut: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: -h }],
  };
}
export function movePaper(scene: PlaneDissectionScene, id: PaperId, delta: PlanePoint): PlaneDissectionScene {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const rightExtent = id === "body" ? scene.base + scene.slant : scene.slant;
  const position = { x: clamp(scene[id].x + delta.x, -2, 12 - rightExtent), y: clamp(scene[id].y + delta.y, scene.height - 6.5, 3) };
  return { ...scene, [id]: position };
}
export function closestPaperSnap(scene: PlaneDissectionScene, id: PaperId, threshold: number): PaperSnap | null {
  if (!scene.cut || !scene.snap) return null;
  const other = scene[id === "body" ? "offcut" : "body"], sign = id === "body" ? -1 : 1;
  const targets: PaperSnap[] = [
    { kind: "rectangle", position: { x: other.x + sign * scene.base, y: other.y } },
    { kind: "origin", position: { ...other } },
  ];
  const distance = (p: PlanePoint) => Math.hypot(p.x - scene[id].x, p.y - scene[id].y);
  targets.sort((a, b) => distance(a.position) - distance(b.position));
  return distance(targets[0].position) <= threshold ? targets[0] : null;
}
export function interpolatePaperScene(from: PlaneDissectionScene, to: PlaneDissectionScene, progress: number): PlaneDissectionScene {
  return { ...from, body: interpolatePlanePoint(from.body, to.body, progress), offcut: interpolatePlanePoint(from.offcut, to.offcut, progress), cut: progress < 1 ? from.cut || to.cut : to.cut };
}
export interface PaperHistory { past: PlaneDissectionScene[]; present: PlaneDissectionScene; future: PlaneDissectionScene[] }
export function commitPaperScene(history: PaperHistory, scene: PlaneDissectionScene): PaperHistory {
  const next = planeDissectionSchema.parse(scene);
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history;
  return { past: [...history.past, history.present].slice(-60), present: next, future: [] };
}
export function stepPaperHistory(history: PaperHistory, direction: "undo" | "redo"): PaperHistory {
  if (direction === "undo") {
    const last = history.past.at(-1);
    return last ? { past: history.past.slice(0, -1), present: last, future: [history.present, ...history.future] } : history;
  }
  const first = history.future[0];
  return first ? { past: [...history.past, history.present], present: first, future: history.future.slice(1) } : history;
}
