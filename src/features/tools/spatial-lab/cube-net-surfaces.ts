import type { PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { CUBE_COLORS, type CubeColor, type CubeMarkShape } from "./cube-structures-contract";

export type CubeNetSurfaceTool = "face" | "transparent" | "mark" | "number";
export type CubeNetMark = { readonly kind: "letter" | CubeMarkShape; readonly color: CubeColor } | null;
export interface CubeNetFaceStyle {
  readonly color: CubeColor;
  readonly opacity: number;
  readonly mark: CubeNetMark;
  readonly number: { readonly value: number; readonly color: CubeColor } | null;
}
/** 键为随纸片移动的稳定身份，不使用当前拓扑面 ID，也不使用用户可编辑的标记。 */
export interface CubeNetSurfaces {
  readonly faces: Readonly<Record<string, CubeNetFaceStyle>>;
  readonly nextNumber: number;
}
export const createCubeNetSurfaces = (): CubeNetSurfaces => ({ faces: {}, nextNumber: 1 });
export const DEFAULT_CUBE_NET_FACE_STYLE: CubeNetFaceStyle = { color: CUBE_COLORS[0], opacity: 1, mark: { kind: "letter", color: CUBE_COLORS[5] }, number: null };
export const cubeNetFaceStyle = (state: CubeNetSurfaces, identity: string): CubeNetFaceStyle => state.faces[identity] ?? DEFAULT_CUBE_NET_FACE_STYLE;
export type CubeNetSurfaceOperation =
  | { readonly kind: "paint"; readonly ids: readonly string[]; readonly color: CubeColor }
  | { readonly kind: "opacity"; readonly ids: readonly string[]; readonly opacity: number }
  | { readonly kind: "mark"; readonly ids: readonly string[]; readonly mark: CubeNetMark }
  | { readonly kind: "number"; readonly id: string; readonly color: CubeColor }
  | { readonly kind: "clear-numbers"; readonly ids: readonly string[] }
  | { readonly kind: "restart-numbering" };

export function reduceCubeNetSurfaces(state: CubeNetSurfaces, operation: CubeNetSurfaceOperation): CubeNetSurfaces {
  if (operation.kind === "opacity" && (!Number.isFinite(operation.opacity) || operation.opacity < 0 || operation.opacity > 1)) throw new Error("INVALID_FACE_OPACITY");
  const faces = { ...state.faces };
  let nextNumber = state.nextNumber;
  const ids = operation.kind === "restart-numbering" ? Object.keys(faces) : operation.kind === "number" ? [operation.id] : operation.ids;
  for (const id of ids) {
    const before = cubeNetFaceStyle(state, id);
    switch (operation.kind) {
      case "paint": faces[id] = { ...before, color: operation.color }; break;
      case "opacity": faces[id] = { ...before, opacity: operation.opacity }; break;
      case "mark": faces[id] = { ...before, mark: operation.mark }; break;
      case "number": if (!before.number && nextNumber <= 9999) faces[id] = { ...before, number: { value: nextNumber++, color: operation.color } }; break;
      case "clear-numbers": case "restart-numbering": faces[id] = { ...before, number: null }; break;
    }
  }
  if (operation.kind === "restart-numbering") nextNumber = 1;
  const changed = ids.some((id) => JSON.stringify(cubeNetFaceStyle(state, id)) !== JSON.stringify(faces[id] ?? cubeNetFaceStyle(state, id)));
  return changed || nextNumber !== state.nextNumber ? { faces, nextNumber } : state;
}

/** 仅在最终绘制时应用样式，数学与换图交接仍保留独立的纸片身份。 */
export function styleCubeNetModel(model: PolyhedronFoldRenderModel, surfaces: CubeNetSurfaces): PolyhedronFoldRenderModel {
  return { ...model, faces: model.faces.map((face) => {
    const style = cubeNetFaceStyle(surfaces, face.label);
    return { ...face, label: "", materialToken: style.color, opacity: style.opacity };
  }) };
}
