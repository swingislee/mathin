"use client";

import { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { layoutCubeNetFaceArrows, type CubeNetRevealFace } from "./cube-net-face-reveal";

const overlayOrigin = (): [number, number] => [0, 0];

/** 完整显示的扁平面箭头；三维外法向负责方向，按钮层负责触摸与键盘。 */
export function CubeNetFaceArrows({ faces, onMove }: { readonly faces: readonly CubeNetRevealFace[]; readonly onMove?: (faceId: string) => void }) {
  const t = useTranslations("tools.spatialLab.cubeNet.manual");
  const { camera, size, invalidate } = useThree();
  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const icons = useRef(new Map<string, SVGSVGElement>());
  const leaders = useRef(new Map<string, SVGLineElement>());
  const origin = faces.reduce((sum, face) => sum.map((value, index) => value + face.center.getComponent(index) / faces.length) as [number, number, number], [0, 0, 0] as [number, number, number]);
  useFrame(() => {
    for (const layout of layoutCubeNetFaceArrows(faces, camera, size.width, size.height)) {
      const wrapper = wrappers.current.get(layout.faceId), icon = icons.current.get(layout.faceId), leader = leaders.current.get(layout.faceId);
      if (wrapper) { wrapper.style.transform = `translate(${layout.x - 24}px, ${layout.y - 24}px)`; wrapper.style.visibility = "visible"; }
      if (icon) icon.style.transform = `rotate(${layout.angle}deg)`;
      if (leader) { leader.setAttribute("x1", String(layout.center.x - layout.x + 24)); leader.setAttribute("y1", String(layout.center.y - layout.y + 24)); }
    }
  });
  return <Html position={origin} calculatePosition={overlayOrigin} zIndexRange={[10, 4]} style={{ pointerEvents: "none" }}>
    <div role="group" aria-label={t("faceReveal")} data-cube-net-face-arrows>
      {faces.map((face) => <div key={face.faceId} ref={(element) => { if (element) { wrappers.current.set(face.faceId, element); invalidate(); } else wrappers.current.delete(face.faceId); }}
        className="absolute h-12 w-12" style={{ visibility: "hidden", pointerEvents: "none" }}>
        <svg width="48" height="48" className="pointer-events-none absolute overflow-visible" aria-hidden>
          <line ref={(element) => { if (element) leaders.current.set(face.faceId, element); else leaders.current.delete(face.faceId); }} x2="24" y2="24" stroke="var(--crater)" strokeWidth="1" strokeDasharray="3 4" opacity="0.7" />
        </svg>
        <Button type="button" variant="ghost" disabled={!onMove} className="relative h-12 w-12 rounded-full p-0 hover:bg-moon/30" style={{ pointerEvents: "auto" }}
          data-cube-net-arrow={face.faceId} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
          aria-label={t(face.expanded ? "restoreFace" : "moveFace", { face: face.label })} title={t(face.expanded ? "restoreFace" : "moveFace", { face: face.label })}
          onClick={(event) => { event.stopPropagation(); onMove?.(face.faceId); }}>
          <svg ref={(element) => { if (element) icons.current.set(face.faceId, element); else icons.current.delete(face.faceId); }} viewBox="0 0 48 48" className="!h-12 !w-12" aria-hidden>
            <path d="M7 21h20v-7l14 10-14 10v-7H7Z" fill={face.expanded ? "var(--leaf)" : "var(--moon)"} stroke="var(--muted)" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span className="absolute -bottom-2 rounded-full bg-paper px-1 text-[10px] leading-4 text-muted">{face.label}</span>
        </Button>
      </div>)}
    </div>
  </Html>;
}
