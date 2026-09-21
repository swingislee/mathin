import type { ReactNode } from "react";
import { SomaPieceIcon } from "./soma-cube/SomaPieceIcon";
import { SOMA_IDS } from "./soma-cube/pieces";

/** 工具缩略图：几何线稿占位（素材就绪后可换成截图/手绘，颜色只用 token） */
export const toolThumbs: Record<string, ReactNode> = {
  "soma-cube": <div className="flex h-full w-full flex-wrap items-center justify-center gap-1 p-4" aria-hidden>
    {SOMA_IDS.map((id) => <SomaPieceIcon key={id} id={id} />)}
  </div>,
  "solid-capacity": (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      <g stroke="var(--ink)" strokeWidth={1.3} strokeLinejoin="round">
        <path d="M23 27 50 103 77 27" fill="var(--moon)" fillOpacity={0.5} /><ellipse cx={50} cy={27} rx={27} ry={9} fill="var(--moon)" />
        <path d="m30 46 20 57 20-57c-5 7-35 7-40 0Z" fill="var(--cheek)" />
        <path d="M123 27v66c0 14 54 14 54 0V27" fill="var(--moon)" fillOpacity={0.5} />
        <ellipse cx={150} cy={27} rx={27} ry={9} fill="var(--moon)" />
        <path d="M123 70v23c0 14 54 14 54 0V70" fill="var(--leaf)" /><ellipse cx={150} cy={70} rx={27} ry={9} fill="var(--leaf)" />
        <path d="M84 61h25m-7-6 7 6-7 6" fill="none" stroke="var(--crater)" />
      </g>
    </svg>
  ),
  "solid-geometry": (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      <g stroke="var(--ink)" strokeWidth={1.3} strokeLinejoin="round">
        <path d="m20 50 25-14 26 14-26 15Zm0 0v36l25 15V65m26-15v36l-26 15" fill="var(--leaf)" />
        <path d="M83 48v39c0 14 40 14 40 0V48" fill="var(--moon)" />
        <ellipse cx={103} cy={48} rx={20} ry={9} fill="var(--moon)" />
        <path d="m138 91 22-57 22 57c-5 11-39 11-44 0Z" fill="var(--cheek)" />
        <path d="M138 91c5-8 39-8 44 0" fill="none" strokeDasharray="2 3" />
      </g>
    </svg>
  ),
  projection: (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      <g stroke="var(--crater)" strokeWidth={1.2} strokeLinejoin="round">
        <path d="M28 28h34v48H28Z" fill="var(--cheek)" />
        <path d="m74 93 32 18 44-23-32-18Z" fill="var(--moon)" />
        <path d="M154 28h25v48h-25Z" fill="var(--leaf)" />
        <path d="M65 44 98 25l32 19-32 18ZM65 44v38l33 18V62m32-18v38l-32 18" fill="var(--leaf)" stroke="var(--ink)" />
        <path d="m65 44-20-6m85 6 33-6M98 100v9" fill="none" strokeDasharray="2 3" />
      </g>
    </svg>
  ),
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
  "cube-structures": (
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
  "cube-net": (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      {[[1, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={52 + x * 24} y={24 + y * 24} width={24} height={24}
          fill={x === 1 && y === 1 ? "var(--leaf)" : "var(--moon)"} stroke="var(--ink)" strokeWidth={1.3} />
      ))}
    </svg>
  ),
  "solid-nets": (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      <g stroke="var(--ink)" strokeWidth={1.3} strokeLinejoin="round">
        {[[32, 50, 26, 18], [16, 50, 16, 18], [58, 50, 16, 18], [32, 34, 26, 16], [32, 68, 26, 16], [32, 84, 26, 18]].map(([x, y, width, height]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={width} height={height} fill={y === 50 ? "var(--leaf)" : "var(--moon)"} />
        ))}
        <rect x={118} y={40} width={18} height={34} fill="var(--moon)" />
        <rect x={136} y={40} width={26} height={34} fill="var(--leaf)" />
        <rect x={162} y={40} width={18} height={34} fill="var(--moon)" />
        <path d="m136 40 13-13 13 13Zm0 34 13 13 13-13Z" fill="var(--cheek)" />
      </g>
    </svg>
  ),
  dice: (
    <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
      <g stroke="var(--ink)" strokeWidth={1.3} strokeLinejoin="round">
        <path d="M62 41 Q62 36 67 33 L94 19 Q100 16 106 19 L133 33 Q138 36 138 41 V79 Q138 84 133 87 L106 103 Q100 106 94 103 L67 87 Q62 84 62 79Z" fill="var(--paper)" />
        <path d="M63 38 100 59 137 38 M100 59V104" fill="none" />
      </g>
      <ellipse cx={100} cy={38} rx={5} ry={3} fill="var(--rose)" />
      {[[74, 60], [87, 84]].map(([x, y]) => <ellipse key={x} cx={x} cy={y} rx={3} ry={4} fill="var(--ink)" />)}
      {[[111, 83], [119, 71], [128, 58]].map(([x, y]) => <ellipse key={x} cx={x} cy={y} rx={3} ry={4} fill="var(--ink)" />)}
    </svg>
  ),
};
// 旧概念页引用继续使用同一份结构线稿。
toolThumbs["spatial-lab"] = toolThumbs["cube-structures"];
