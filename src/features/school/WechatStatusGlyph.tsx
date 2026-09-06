import type { CSSProperties } from "react";
import styles from "./followup-micro-interactions.module.css";

type WechatVisualState = "unknown" | "yes" | "no";

function strokeThrough(points: readonly (readonly [number, number])[]): string {
  return `M${points[0].join(" ")}${points.slice(1).map((point, index) => `C${points[index].join(" ")} ${point.join(" ")} ${point.join(" ")}`).join("")}`;
}

// 两条线均保留八段曲线，让对话气泡连续收拢为对勾或交叉线。
const paths: Record<WechatVisualState, readonly [string, string]> = {
  unknown: [
    "M10 3C5.6 3 2 5.6 2 9C2 10.9 3.1 12.7 5 13.8C4.8 14.5 4.5 15.8 4.2 17C5.2 16.5 6.4 15.8 7.5 15.2C8.2 15.4 9 15.5 10 15.5C14.4 15.5 18 12.8 18 9.3C18 5.8 14.4 3 10 3C10 3 10 3 10 3",
    "M16.5 10C13.1 10 10.5 12 10.5 14.5C10.5 17 13.1 19 16.5 19C17.2 19 17.8 18.9 18.4 18.7C19.1 19.1 20 19.6 21 20C20.8 19.2 20.6 18.5 20.4 18C22 17 22.5 15.9 22.5 14.5C22.5 12 19.9 10 16.5 10C16.5 10 16.5 10 16.5 10",
  ],
  yes: [
    strokeThrough([[5, 12], [6, 13], [7, 14], [8, 15], [9, 16], [11.5, 13.5], [14, 11], [16.5, 8.5], [19, 6]]),
    strokeThrough(Array.from({ length: 9 }, () => [9, 16] as const)),
  ],
  no: [
    strokeThrough(Array.from({ length: 9 }, (_, index) => [6 + index * 1.5, 6 + index * 1.5] as const)),
    strokeThrough(Array.from({ length: 9 }, (_, index) => [18 - index * 1.5, 6 + index * 1.5] as const)),
  ],
};

export function WechatStatusGlyph({ state }: { state: WechatVisualState }) {
  return <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-wechat-glyph={state}>
    {paths[state].map((path, index) => <path key={index} d={path} data-wechat-morph={index}
      className={styles.morphPath}
      style={{ d: `path("${path}")`, opacity: index === 1 && state === "yes" ? 0 : 1,
        fill: index === 1 && state === "unknown" ? "var(--card)" : "none" } as CSSProperties} />)}
    <g fill="currentColor" stroke="none" className="transition-opacity duration-200" opacity={state === "unknown" ? 1 : 0}>
      <circle cx="6.5" cy="8.5" r="0.85" /><circle cx="12.5" cy="8.5" r="0.85" />
      <circle cx="14.5" cy="14" r="0.7" /><circle cx="19" cy="14" r="0.7" />
    </g>
  </svg>;
}
