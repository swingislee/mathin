import { cn } from "@/lib/utils";

/**
 * 星轨虚线：全站视觉母题（docs/plan/01-3）。
 * 圆点虚线，默认陨石棕；传 SVG path 的 d 与 viewBox 使用。
 */
export function StarPath({ d, viewBox, className, strokeWidth = 2 }: { d: string; viewBox: string; className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden viewBox={viewBox} fill="none" preserveAspectRatio="none" className={cn("text-crater", className)}>
      <path d={d} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray="0.5 9" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
