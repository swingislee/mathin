/**
 * 知识宇宙注册表（docs/plan/06-knowledge-universe.md）
 * 星系看领域 → 星球看主题 → 岛屿看路径 → 节点学概念 → 图谱看关系。
 * 名称与文案在 messages 的 termsUniverse 命名空间；此处只有结构与 3D 场景参数。
 * 注：以下 hex 为 three.js 场景材质色（非 CSS token），统一高亮为暖金 GOLD。
 */

export type LandmarkKind = "tower" | "tree" | "gear" | "crystal" | "arch" | "flag" | "beacon";

export interface TermIsland {
  id: string;
  /** 球面经纬度（度） */
  lat: number;
  lon: number;
  landmark: LandmarkKind;
}

export interface TermPlanet {
  id: string;
  /** 主色 / 辅色（岛屿、地标用） */
  color: string;
  color2: string;
  /** 星系首页中的位置与大小（纵深 S 形排布，z 越小越远） */
  position: [number, number, number];
  size: number;
  islands: TermIsland[];
}

export const GOLD = "#ffd98a";
export const NIGHT_BG = "#121524";

/**
 * 四座岛屿均匀分布：正四面体顶点的球面坐标（lat ±33.56°，lon 依次错开 90°），
 * 每颗星球加一个 lon 偏移避免千球一面。
 */
const TETRA: { lat: number; lon: number }[] = [
  { lat: 33.6, lon: 45 },
  { lat: -33.6, lon: 135 },
  { lat: 33.6, lon: -135 },
  { lat: -33.6, lon: -45 },
];

function tetraIslands(ids: string[], landmarks: LandmarkKind[], lonOffset: number): TermIsland[] {
  return ids.map((id, i) => ({
    id,
    lat: TETRA[i].lat,
    lon: TETRA[i].lon + lonOffset,
    landmark: landmarks[i],
  }));
}

export const termPlanets: TermPlanet[] = [
  {
    id: "number",
    color: "#8fbf6a",
    color2: "#e9c46a",
    position: [-2.7, -0.85, 1.6],
    size: 1.12,
    islands: tetraIslands(["birth", "notation", "decimals", "fraction-ratio"], ["tree", "tower", "arch", "flag"], -20),
  },
  {
    id: "operations",
    color: "#7fb6d9",
    color2: "#9aa5b1",
    position: [-0.85, 0.9, 0.1],
    size: 0.95,
    islands: tetraIslands(["add-sub", "mul-div", "factors", "rules"], ["gear", "flag", "crystal", "arch"], 15),
  },
  {
    id: "geometry",
    color: "#8e9bc4",
    color2: "#e8e3f5",
    position: [1.75, 1.7, -1.6],
    size: 1.02,
    islands: tetraIslands(["shapes", "lines", "measure", "transform"], ["crystal", "tower", "flag", "beacon"], -40),
  },
  {
    id: "algebra",
    color: "#5fae9e",
    color2: "#bcd8cf",
    position: [5.0, -0.35, -3.3],
    size: 0.9,
    islands: tetraIslands(["patterns", "relations", "equations", "structures"], ["flag", "arch", "gear", "tower"], 30),
  },
  {
    id: "functions",
    color: "#e8a15a",
    color2: "#d9b36c",
    position: [1.35, -1.6, -4.8],
    size: 0.95,
    islands: tetraIslands(["coordinates", "change", "sequences", "calculus"], ["beacon", "tower", "arch", "crystal"], -10),
  },
  {
    id: "data",
    color: "#6aaecf",
    color2: "#c0c8cf",
    position: [-3.7, 1.75, -6.0],
    size: 0.85,
    islands: tetraIslands(["market", "charts", "lighthouse", "chance"], ["flag", "tower", "beacon", "tree"], 25),
  },
  {
    id: "logic",
    color: "#4a5d8a",
    color2: "#e9d9a8",
    position: [8.6, 1.55, -7.6],
    size: 0.82,
    islands: tetraIslands(["logic-lighthouse", "proof-bridge", "set-library", "language"], ["beacon", "arch", "tower", "crystal"], -30),
  },
];

export function getPlanet(id: string): TermPlanet | undefined {
  return termPlanets.find((p) => p.id === id);
}

export function getIsland(planetId: string, islandId: string): TermIsland | undefined {
  return getPlanet(planetId)?.islands.find((i) => i.id === islandId);
}
