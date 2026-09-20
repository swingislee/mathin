"use client";

import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { SpatialArcball } from "./arcball";

/** 提示本次抓取所使用的球面，纯显示，不截获球外/空白区域的相机手势。 */
export function SpatialArcballGuide({ ball }: { ball: SpatialArcball }) {
  const canvas = useThree((state) => state.gl.domElement);
  return <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }} calculatePosition={() => {
    const rect = canvas.getBoundingClientRect(); return [ball.center.x - rect.left, ball.center.y - rect.top];
  }}>
    <div aria-hidden className="pointer-events-none rounded-full border border-ink/25" style={{ width: ball.radius * 2, height: ball.radius * 2 }} />
  </Html>;
}
