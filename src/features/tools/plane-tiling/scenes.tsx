import { createConstructionDefinition } from "../plane-construction/scenes";
import { addConstruction, constructionObject, constructionObjects, MAX_CONSTRUCTION_OBJECTS, removeConstruction } from "../plane-construction/model";
import type { PlanarSceneDefinition, PlanarText } from "../planar-kit/types";
import { addRegularTile, createTilingState, moveTile, snapTile, TILING_SCENE } from "./model";

const t = (zh: string, en: string): PlanarText => ({ zh, en });
const base = createConstructionDefinition(TILING_SCENE, "plane-tiling", t("镶嵌与空隙", "Tiling and gaps"));
const sides = [3, 4, 5, 6, 8];
const names = [t("正三角形", "Equilateral triangle"), t("正方形", "Square"), t("正五边形", "Regular pentagon"), t("正六边形", "Regular hexagon"), t("正八边形", "Regular octagon")];

export const planeTilingScene: PlanarSceneDefinition = {
  ...base, create: createTilingState,
  description: t("画出基本片，或添加不同材料；复制、转动、贴合，观察空隙与重叠。", "Draw a tile or add different materials. Copy, turn and join them to observe gaps and overlaps."),
  fields: base.fields?.filter((field) => field.key !== "detail"),
  actions: base.actions?.filter((action) => !["construction-life-outline", "construction-names"].includes(action.id)),
  toggles: [{ key: "snap", label: t("松手吸附到其它纸片顶点", "Snap to other tile vertices on release") }, { key: "ghost", label: t("保留上次变换前的轮廓", "Keep the previous outline") }],
  materials: sides.map((count, index) => {
    const sample = constructionObject(addRegularTile(removeConstruction(createTilingState()), count))!;
    return { id: "tile-" + count, label: names[index], group: t("可混合使用的材料", "Mixable tiles"),
      preview: <svg viewBox="-165 -165 330 330" width="76" height="76" aria-hidden="true"><polygon points={sample.vertices.map((p) => p.x + "," + p.y).join(" ")} fill="var(--leaf)" fillOpacity="0.65" stroke="var(--ink)" strokeWidth="4" /></svg>,
      add: (state) => addRegularTile(state, count),
      disabled: (state) => constructionObjects(state).length >= MAX_CONSTRUCTION_OBJECTS || addRegularTile(state, count).params.nextId === state.params.nextId,
    };
  }),
  construction: { ...base.construction!, tools: base.construction!.tools.filter((tool) => tool.id === "rectangle" || tool.id === "polygon"),
    create: (state, tool, points) => {
      if (tool !== "rectangle" && tool !== "polygon") return null;
      const next = addConstruction({ ...state, flags: { ...state.flags, snap: false } }, tool, points);
      return next.params.nextId === state.params.nextId ? null : { ...next, flags: state.flags };
    },
  },
  drag: moveTile, snap: snapTile,
};
