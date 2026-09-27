import type { PlanarPoint, PlanarState } from "../planar-kit/contract";
import { addConstruction, constructionObject, constructionObjects, createConstructionState, moveConstruction, parseConstructionTarget, removeConstruction, worldVertices } from "../plane-construction/model";
import { isValidConstructionState } from "../plane-construction/validation";

export const TILING_SCENE = "36-create";

/** 每一片保存自己的真实轮廓；加入新材料不改变已有纸片的形状。 */
export function addRegularTile(state: PlanarState, sides: number): PlanarState {
  if (![3, 4, 5, 6, 8].includes(sides)) return state;
  const radius = 100 / (2 * Math.sin(Math.PI / sides));
  const offset = constructionObjects(state).length % 5 * 25;
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = -Math.PI / 2 + Math.PI / sides + i * 2 * Math.PI / sides;
    return { x: 390 + offset + Math.cos(angle) * radius, y: 310 + offset + Math.sin(angle) * radius };
  });
  const next = addConstruction({ ...state, flags: { ...state.flags, snap: false } }, "polygon", points);
  return { ...next, flags: state.flags };
}

export function createTilingState(): PlanarState {
  const empty = removeConstruction(createConstructionState(TILING_SCENE));
  return addRegularTile({ ...empty, flags: { ...empty.flags, snap: true } }, 3);
}

export function isValidTilingState(state: PlanarState): boolean {
  return state.sceneId === TILING_SCENE && state.phase === 0
    && isValidConstructionState({ ...state, sceneId: "01-create" })
    && constructionObjects(state).every((object) => object.kind < 2 && object.life === 0 && object.detail === 0);
}

/** 本体始终连续移动，松手才吸附到其它纸片顶点，不在拖动中跳网格。 */
export function moveTile(state: PlanarState, target: string, at: PlanarPoint, delta: PlanarPoint): PlanarState {
  const next = moveConstruction({ ...state, flags: { ...state.flags, snap: false } }, target, at, delta);
  return { ...next, flags: state.flags };
}

export function snapTile(state: PlanarState, target: string): PlanarState | null {
  const parsed = parseConstructionTarget(target);
  if (!state.flags.snap || parsed?.type !== "object") return null;
  const tile = constructionObject(state, parsed.id);
  if (!tile) return null;
  let offset: PlanarPoint | null = null, nearest = 16;
  const own = worldVertices(tile);
  for (const other of constructionObjects(state)) {
    if (other.id === tile.id) continue;
    for (const a of own) for (const b of worldVertices(other)) {
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance < nearest) { nearest = distance; offset = { x: b.x - a.x, y: b.y - a.y }; }
    }
  }
  if (!offset) return null;
  const next = { ...state, points: { ...state.points, ["center." + tile.id]: { x: tile.center.x + offset.x, y: tile.center.y + offset.y } } };
  return isValidTilingState(next) ? next : null;
}
