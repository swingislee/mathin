"use client";

import { useRef, type ComponentProps } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cubeNetFaceArrowAngle, type CubeNetRevealFace } from "./cube-net-face-reveal";

type ArrowOcclusion = ComponentProps<typeof Html>["occlude"];
function FaceArrow({ face, onMove, occlude = true }: { readonly face: CubeNetRevealFace; readonly onMove?: (faceId: string) => void; readonly occlude?: ArrowOcclusion }) {
  const t = useTranslations("tools.spatialLab.cubeNet.manual");
  const { camera, size } = useThree();
  const icon = useRef<SVGSVGElement>(null);
  useFrame(() => { if (icon.current) icon.current.style.transform = `rotate(${cubeNetFaceArrowAngle(face, camera, size.width, size.height)}deg)`; });
  return <Html position={face.position} center occlude={occlude} zIndexRange={[10, 4]}>
        <Button type="button" variant="ghost" disabled={!onMove} className="relative h-12 w-12 rounded-full p-0 hover:bg-moon/30"
          data-cube-net-arrow={face.faceId} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
          aria-label={t(face.expanded ? "restoreFace" : "moveFace", { face: face.label })} title={t(face.expanded ? "restoreFace" : "moveFace", { face: face.label })}
          onClick={(event) => { event.stopPropagation(); onMove?.(face.faceId); }}>
          <svg ref={icon} viewBox="0 0 48 48" className="!h-12 !w-12" aria-hidden>
            <path d="M7 21h20v-7l14 10-14 10v-7H7Z" fill={face.expanded ? "var(--leaf)" : "var(--moon)"} stroke="var(--muted)" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </Button>
  </Html>;
}

/** 箭头居中沿真实外法向留距，允许纸面遮挡；保留 48px 点击区，不额外绘制面名或引线。 */
export function CubeNetFaceArrows({ faces, onMove, occlude }: { readonly faces: readonly CubeNetRevealFace[]; readonly onMove?: (faceId: string) => void; readonly occlude?: ArrowOcclusion }) {
  return <group>{faces.map((face) => <FaceArrow key={face.faceId} face={face} onMove={onMove} occlude={occlude} />)}</group>;
}
