import type { StrokeSample } from "./types";

type Position = readonly number[];
interface PressureState { pressure: number; speed: number | null; real: boolean }

const INITIAL_PRESSURE = 0.5;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const blend = (elapsed: number, tau: number) => 1 - Math.exp(-Math.min(elapsed, 32) / tau);
function validPressure(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** 仅平滑粗细；坐标原样交给 PF，最新落点不等待滤波或未来样本。 */
function nextPressure(previous: PressureState | undefined, distance: number, elapsed: number,
  raw: number | null | undefined, size: number): PressureState {
  const real = (previous?.real ?? false) || (validPressure(raw) && Math.abs(raw - 0.5) > 0.001);
  if (!previous) return { pressure: real && validPressure(raw) ? raw : INITIAL_PRESSURE, speed: null, real };
  let { pressure, speed } = previous;
  if (real) {
    // 设备一旦提供非默认压力，此笔后续使用实测值；历史点的压力保持原样。
    if (validPressure(raw)) pressure += (raw - pressure) * blend(elapsed > 0 ? elapsed : 8, 12);
  } else if (elapsed > 0 && distance > 0) {
    // 速度按笔宽归一化：缩放、学生端和导出按同一比例重放。
    const velocity = distance / size / elapsed;
    speed = speed === null ? velocity : speed + (velocity - speed) * blend(elapsed, 24);
    // 慢写较饱满、快写较细；两端渐近，避免跨过速度阈值后突然变粗/变细。
    const target = 0.18 + 0.6 / (1 + (speed * 10) ** 2);
    const change = (target - pressure) * blend(elapsed, 24);
    // 限制每段轮廓的宽度斜率，鼠标停顿后的小位移也能平滑衔接。
    const limit = distance / size * 0.12;
    pressure += clamp(change, -limit, limit);
  }
  // 缺少有效时间的普通输入沿用已有粗细，静止鼠标不会因等待而鼓包。
  return { pressure: clamp(pressure, 0, 1), speed, real };
}

/**
 * 每条活动笔画缓存因果压力状态。点和样本元组按输入/同步合同只追加或替换。
 * 预览尾点替换时回退到共同前缀；新样本才运行滤波，稳定前缀复用像素点。
 */
export class InkPressureCache {
  private dimensions = "";
  private positions: Position[] = [];
  private samples: Array<StrokeSample | undefined> = [];
  private states: PressureState[] = [];
  private points: number[][] = [];

  update(positions: readonly Position[], samples: readonly StrokeSample[] | undefined,
    w: number, h: number, size: number): number[][] {
    const dimensions = `${w}:${h}:${size}`;
    let prefix = 0;
    if (this.dimensions === dimensions) {
      while (prefix < positions.length && prefix < this.positions.length
        && this.positions[prefix] === positions[prefix] && this.samples[prefix] === samples?.[prefix]) prefix++;
    }
    this.dimensions = dimensions;
    this.positions.length = this.samples.length = this.states.length = this.points.length = prefix;
    for (let index = prefix; index < positions.length; index++) {
      const position = positions[index], sample = samples?.[index];
      const x = position[0] * w, y = position[1] * h;
      const previous = this.points[index - 1];
      const time = sample?.[0], previousTime = samples?.[index - 1]?.[0];
      const elapsed = time != null && previousTime != null && Number.isFinite(time) && Number.isFinite(previousTime)
        ? Math.max(0, time - previousTime) : 0;
      const distance = previous ? Math.hypot(x - previous[0], y - previous[1]) : 0;
      const state = nextPressure(this.states[index - 1], distance, elapsed, sample?.[1], Math.max(size, 0.001));
      this.positions.push(position); this.samples.push(sample); this.states.push(state);
      this.points.push([x, y, state.pressure]);
    }
    return this.points;
  }
}
