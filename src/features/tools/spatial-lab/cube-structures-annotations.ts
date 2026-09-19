import { FACE_OFFSETS, type VoxelCoordinate } from "@/features/spatial-math/domain";
import { cubeDisplayPosition, type CubeLabelStyle, type CubeMarkShape, type StructureCube } from "./cube-structures-contract";
import { cubeLabelLaneDirection } from "./cube-structures-rotation";

/** 工具按钮、悬浮预览和场景纹理复用同一份 SVG 路径。 */
export const CUBE_MARK_PATHS: Record<CubeMarkShape, string> = {
  circle: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18",
  triangle: "M12 3 22 21H2Z",
  square: "M4 4H20V20H4Z",
  star: "m12 2 3 6.5 7 1-5 5 1.2 7-6.2-3.3-6.2 3.3 1.2-7-5-5 7-1Z",
  diamond: "M12 2 22 12 12 22 2 12Z",
  cross: "M8 2H16V8H22V16H16V22H8V16H2V8H8Z",
};

export function cubeAnnotationSvg(label: { readonly color: string; readonly shape?: CubeMarkShape; readonly value?: number; readonly text?: string }): string {
  const text = (label.text ?? String(label.value ?? 1)).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const body = label.shape ? `<path d="${CUBE_MARK_PATHS[label.shape]}" fill="${label.color}" stroke="#211e1a" stroke-width="1.2"/>`
    : `<circle cx="12" cy="12" r="11" fill="white" fill-opacity=".94" stroke="${label.color}" stroke-width="1.2"/><text x="12" y="16.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="${text.length > 2 ? 10 : 14}" font-weight="700" fill="#211e1a">${text}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24">${body}</svg>`;
}

export function cubeLabelAnchor(cube: Pick<StructureCube, "position" | "displayOffset">, label: CubeLabelStyle, lane: -1 | 0 | 1 = 0): VoxelCoordinate {
  const position = cubeDisplayPosition(cube);
  const normal = FACE_OFFSETS[label.direction];
  const distance = label.placement === "center" ? 0 : label.placement === "side" ? 0.95 : 0.508;
  // 符号和编号同时存在时在面内并排；中心及旁注也保留各自可读空间。
  const tangent = FACE_OFFSETS[label.placement === "face" ? cubeLabelLaneDirection(label) : label.direction[0] === "x" ? "z+" : "x+"];
  const shift = { x: tangent.x * 0.24 * lane, y: tangent.y * 0.24 * lane, z: tangent.z * 0.24 * lane };
  return { x: position.x + normal.x * distance + shift.x, y: position.y + normal.y * distance + shift.y, z: position.z + normal.z * distance + shift.z };
}
