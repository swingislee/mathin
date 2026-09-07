/** 课件只携带教学工具；账号草稿、起点库与工作台模式属于独立备课入口。 */
export const CUBE_TOOLBAR_GROUPS = [
  { id: "navigation", tools: ["orbit", "pan", "view-angle", "view-front", "view-left", "view-right", "view-top", "fit", "axis-snap", "axes"] },
  { id: "structure", tools: ["select", "build", "remove", "color", "face", "move", "layer", "cut"] },
  { id: "teaching", tools: ["mark", "number", "transparent", "recording", "undo", "redo", "reset", "metrics"] },
] as const;

export const CUBE_TOOLBAR_IDS = CUBE_TOOLBAR_GROUPS.flatMap((group) => [...group.tools]);
export type CubeToolbarId = (typeof CUBE_TOOLBAR_GROUPS)[number]["tools"][number];

export const CUBE_TOOLBAR_LABELS = {
  orbit: "orbit", pan: "pan", select: "select", build: "build", remove: "remove", color: "color", face: "face", move: "move", layer: "layer", cut: "cut",
  mark: "mark", number: "number", transparent: "transparent", recording: "record", undo: "previous", redo: "next", reset: "restartDemo", metrics: "metrics",
  "view-angle": "angle", "view-front": "front", "view-left": "left", "view-right": "right", "view-top": "top", fit: "fit", "axis-snap": "cellSnap", axes: "showAxes",
} as const satisfies Record<CubeToolbarId, string>;
