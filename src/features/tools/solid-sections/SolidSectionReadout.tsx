"use client";

import { useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { SolidEntity } from "../solid-geometry/solid-geometry-contract";
import type { SolidSectionPlane, SolidSectionResult } from "./solid-sections";
import { sectionReadoutLayout, sectionReadoutPoints } from "./solid-section-readout";
import { solidSectionsMessages } from "./solid-sections-messages";

const canvasOrigin = () => [0, 0] as [number, number];
/** 画布上的几何注解，与真实截口同色、引线相连；不占布局，也不接管相机事件。 */
export function SolidSectionReadout({ entity, plane, result, locale, opacity }: {
  entity: SolidEntity; plane: SolidSectionPlane; result: SolidSectionResult; locale: string; opacity: number;
}) {
  const { size } = useThree(), group = useRef<SVGGElement>(null), diagram = useRef<SVGGElement>(null), line = useRef<SVGLineElement>(null), dot = useRef<SVGCircleElement>(null);
  const points = useMemo(() => sectionReadoutPoints(entity, plane, result).map((point) => `${point.x},${point.y}`).join(" "), [entity, plane, result]);
  const m = solidSectionsMessages(locale), caption = result.kind === "polygon" ? `${m.preview} · ${result.points.length} ${m.polygon}` : m[result.kind];
  useFrame(({ camera, size }) => {
    const layout = sectionReadoutLayout(entity, plane, result, camera, size);
    group.current?.setAttribute("visibility", layout.visible ? "visible" : "hidden");
    diagram.current?.setAttribute("transform", `translate(${layout.left}, ${layout.top}) scale(${layout.width / 120})`);
    line.current?.setAttribute("x1", String(layout.source.x)); line.current?.setAttribute("y1", String(layout.source.y));
    line.current?.setAttribute("x2", String(layout.end.x)); line.current?.setAttribute("y2", String(layout.end.y));
    dot.current?.setAttribute("cx", String(layout.source.x)); dot.current?.setAttribute("cy", String(layout.source.y));
  });
  return <Html calculatePosition={canvasOrigin} zIndexRange={[5, 0]} style={{ pointerEvents: "none", width: size.width, height: size.height }}>
    <svg width={size.width} height={size.height} role="img" aria-label={caption} className="pointer-events-none absolute inset-0 overflow-hidden text-rose" data-solid-section-readout>
      <g ref={group} opacity={Math.min(1, opacity / 0.82)} visibility="hidden">
        {result.kind !== "empty" && <><line ref={line} stroke="currentColor" strokeWidth="1.3" strokeDasharray="4 5" /><circle ref={dot} r="3" fill="currentColor" /></>}
        <g ref={diagram} data-solid-section-preview>
          <rect width="120" height="120" rx="12" fill="var(--paper)" fillOpacity=".88" />
          {result.kind === "polygon" ? <polygon points={points} fill="currentColor" fillOpacity=".2" stroke="currentColor" strokeWidth="2" />
            : result.kind === "segment" ? <polyline points={points} stroke="currentColor" strokeWidth="2" />
              : result.kind === "point" ? <circle cx="60" cy="60" r="3" fill="currentColor" /> : null}
          <text x="60" y="130" textAnchor="middle" fontSize="10" fill="var(--ink)" stroke="var(--paper)" strokeWidth="3" paintOrder="stroke">{caption}</text>
        </g>
      </g>
    </svg>
  </Html>;
}
