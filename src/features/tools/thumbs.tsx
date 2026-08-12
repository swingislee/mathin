import type { ReactNode } from "react";

/** 工具缩略图：几何线稿占位（素材就绪后可换成截图/手绘，颜色只用 token） */
export const toolThumbs: Record<string, ReactNode> = {
  "fraction-line": (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      <line x1={16} y1={62} x2={184} y2={62} stroke="var(--ink)" strokeWidth={1.5} />
      <path d="M178 58 L186 62 L178 66" fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" />
      {[56, 96, 136].map((x) => (
        <line key={x} x1={x} y1={57} x2={x} y2={67} stroke="var(--crater)" strokeWidth={1.5} />
      ))}
      <circle cx={22} cy={62} r={4} fill="var(--rose)" />
      <circle cx={76} cy={62} r={3.5} fill="var(--leaf-deep)" />
      <circle cx={116} cy={62} r={3.5} fill="var(--leaf-deep)" />
      <line x1={70} y1={84} x2={82} y2={84} stroke="var(--leaf-deep)" strokeWidth={1.2} />
      <text x={76} y={81} textAnchor="middle" fontSize={10} fill="var(--leaf-deep)">1</text>
      <text x={76} y={95} textAnchor="middle" fontSize={10} fill="var(--leaf-deep)">2</text>
      <line x1={76} y1={40} x2={76} y2={58} stroke="var(--crater)" strokeWidth={1.2} strokeDasharray="1.5 4" strokeLinecap="round" />
    </svg>
  ),
  "motion-lab": (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      {[52, 92].map((y) => (
        <g key={y}>
          <line x1={20} y1={y} x2={180} y2={y} stroke="var(--crater)" strokeWidth={1.5} />
          <line x1={22} y1={y - 12} x2={22} y2={y + 2} stroke="var(--crater)" strokeWidth={1.5} />
          <line x1={178} y1={y - 12} x2={178} y2={y + 2} stroke="var(--crater)" strokeWidth={1.5} />
        </g>
      ))}
      <circle cx={70} cy={44} r={6} fill="var(--rose)" />
      <rect x={62} y={48} width={16} height={5} rx={2} fill="var(--rose)" opacity={0.55} />
      <circle cx={126} cy={84} r={6} fill="var(--leaf-deep)" />
      <rect x={118} y={88} width={16} height={5} rx={2} fill="var(--leaf-deep)" opacity={0.55} />
      {[70, 126].map((x) => (
        <line key={x} x1={x} y1={16} x2={x} y2={104} stroke="var(--crater)" strokeWidth={1.2} strokeDasharray="1.5 4" strokeLinecap="round" />
      ))}
      <line x1={73} y1={22} x2={123} y2={22} stroke="var(--ink)" strokeWidth={1.2} />
      <line x1={73} y1={18} x2={73} y2={26} stroke="var(--ink)" strokeWidth={1.2} />
      <line x1={123} y1={18} x2={123} y2={26} stroke="var(--ink)" strokeWidth={1.2} />
    </svg>
  ),
  "spatial-lab": (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      <g stroke="var(--ink)" strokeWidth={1.3} strokeLinejoin="round">
        <path d="M44 65 64 54 84 65 64 77Z" fill="var(--leaf)" />
        <path d="M44 65v23l20 12V77Z" fill="var(--moon)" />
        <path d="M84 65v23l-20 12V77Z" fill="var(--leaf-deep)" opacity={0.72} />
        <path d="M78 37 98 26l20 11-20 12Z" fill="var(--leaf)" />
        <path d="M78 37v23l20 12V49Z" fill="var(--moon)" />
        <path d="M118 37v23L98 72V49Z" fill="var(--leaf-deep)" opacity={0.72} />
        <path d="M112 65l20-11 20 11-20 12Z" fill="var(--leaf)" />
        <path d="M112 65v23l20 12V77Z" fill="var(--moon)" />
        <path d="M152 65v23l-20 12V77Z" fill="var(--leaf-deep)" opacity={0.72} />
      </g>
      <path d="M29 101h142" stroke="var(--crater)" strokeWidth={1.2} strokeDasharray="2 5" />
      <circle cx={163} cy={28} r={4} fill="var(--rose)" />
      <path d="m163 18 1.5 6.5L171 26l-6.5 1.5L163 34l-1.5-6.5L155 26l6.5-1.5Z" fill="var(--rose)" opacity={0.35} />
    </svg>
  ),
};
