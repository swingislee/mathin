/** 对象动作只接管命中的部位；未命中的手势继续交给共用相机。 */
export function spatialDirectManipulation(tool: string): boolean {
  return tool === "orbit" || tool === "move";
}

export const SPATIAL_ACTION_DURATION_MS = 650;
export const SPATIAL_REDUCED_ACTION_DURATION_MS = 240;

export function spatialActionProgress(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

/** 从首个绘制帧计时，编译或 demand 画布的等待时间不消耗演示过程。 */
export function animateSpatialAction(durationMs: number, sample: (progress: number) => void): () => void {
  let request = 0, started: number | null = null;
  const tick = (now: number) => {
    started ??= now;
    const progress = durationMs <= 0 ? 1 : Math.min(1, (now - started) / durationMs);
    sample(progress);
    if (progress < 1) request = requestAnimationFrame(tick);
  };
  request = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(request);
}
