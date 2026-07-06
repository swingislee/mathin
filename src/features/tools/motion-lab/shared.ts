export type SolveKey = "distance" | "time" | "speed";

export interface Runway {
  id: number;
  head: string;
  vehicle: string;
  facingRight: boolean;
  /** 当前位置（米，自左侧起点柱） */
  x: number;
  solve: SolveKey;
  distance: number;
  time: number;
  speed: number;
}

/** 起点/终点柱距轨道区边缘的像素 */
export const POST_PAD = 28;
/** 每条跑道左侧 D/T/S 面板宽度（px），测距尺覆盖层以此对齐 */
export const PANEL_W = 208;

export const VEHICLES = ["01-walk", "02-bicycle", "03-car", "04-plane", "05-rocket", "06-cloud", "07-wormhole"].map(
  (n) => `/assets/tools/motion/${n}.png`,
);
export const DEFAULT_HEAD = "/assets/tools/motion/head.png";
export const DEFAULT_VEHICLE = VEHICLES[0];
export const MAX_RUNWAYS = 12;

/** 换载具＝换默认速度（m/s），可再手动修改；数值供教学用，可按需调整 */
export const VEHICLE_SPEEDS: Record<string, number> = {
  [VEHICLES[0]]: 1.2, // 步行
  [VEHICLES[1]]: 4, // 自行车
  [VEHICLES[2]]: 15, // 汽车
  [VEHICLES[3]]: 250, // 飞机
  [VEHICLES[4]]: 3000, // 火箭
  [VEHICLES[5]]: 600, // 筋斗云
  [VEHICLES[6]]: 30000, // 虫洞
};

export function fmt(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a > 0 && a < 1) return parseFloat(v.toPrecision(2));
  return parseFloat(v.toFixed(2));
}

/** 依据总长选择"好看"的刻度间隔（沿用原 demo 算法） */
export function getTickInterval(value: number): number {
  const power = Math.floor(Math.log10(Math.abs(value)));
  const leading = value / Math.pow(10, power);
  if (leading < 1.4) return Math.pow(10, power - 1);
  if (leading < 2.8) return 2 * Math.pow(10, power - 1);
  if (leading < 7) return 5 * Math.pow(10, power - 1);
  return Math.pow(10, power);
}

/** 已知其中两项，求解 solve 指定的第三项，保持三元组一致 */
export function recompute(r: Runway): Runway {
  if (r.solve === "speed") return { ...r, speed: fmt(r.time > 0 ? r.distance / r.time : 0) };
  if (r.solve === "time") return { ...r, time: fmt(r.speed > 0 ? r.distance / r.speed : 0) };
  return { ...r, distance: fmt(r.speed * r.time) };
}

/**
 * 原版交互逻辑：任意字段都可编辑；若编辑的恰是当前被求解的量，
 * 求解目标自动轮转（路程→时间→速度→路程），随后重算。
 */
export function editField(r: Runway, field: SolveKey, value: number): Runway {
  const next: Runway = { ...r, [field]: fmt(value) };
  if (r.solve === field) {
    next.solve = field === "distance" ? "time" : field === "time" ? "speed" : "distance";
  }
  return recompute(next);
}
