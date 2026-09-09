/** 播放器应用远端控制后产生的原生事件保持为回放，新的教师操作继续广播。 */
export function isMediaControlEcho(
  action: "play" | "pause" | "seek",
  time: number,
  applied: { action: "play" | "pause" | "seek"; time: number } | undefined,
) {
  return Boolean(applied && Math.abs(time - applied.time) < 0.5 && (action === "seek" || action === applied.action));
}
