"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, FrontSide, SRGBColorSpace, type Mesh, type MeshBasicMaterial } from "three";

const ignoreRaycast = () => null;
export const SPATIAL_GROUND_LABEL_ROTATION: [number, number, number] = [-Math.PI / 2, 0, Math.PI / 2];

/** 单面的地面标注只从 XZ 平面上方可见；贴近平视时收起像素宽的辅助线。 */
export function spatialGroundVisible(direction: { y: number }) { return direction.y < -.01; }

/** 文字属于模型表面，接受投影与遮挡，不像 Html / sprite 那样始终朝向屏幕。 */
export function SpatialSurfaceLabel({ text, position, rotation, height = .6 }: {
  text: string; position: [number, number, number]; rotation: [number, number, number]; height?: number;
}) {
  const { gl, invalidate } = useThree(), mesh = useRef<Mesh>(null), material = useRef<MeshBasicMaterial>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 128;
    const context = canvas.getContext("2d"), surface = material.current;
    if (!context || !surface) return;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    surface.map = texture; surface.needsUpdate = true;
    let mounted = true;
    const paint = () => {
      if (!mounted) return;
      const style = getComputedStyle(gl.domElement), family = style.fontFamily || "serif";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = "96px " + family;
      const fontSize = Math.min(96, 96 * (canvas.width - 24) / Math.max(1, context.measureText(text).width));
      context.font = fontSize + "px " + family; context.textAlign = "center"; context.textBaseline = "middle";
      context.fillStyle = style.getPropertyValue("--muted").trim() || "#827869";
      context.fillText(text, canvas.width / 2, canvas.height / 2);
      if (mesh.current) { mesh.current.scale.set(canvas.width / canvas.height * height, height, 1); mesh.current.visible = true; }
      texture.needsUpdate = true;
      invalidate();
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const theme = window.matchMedia("(prefers-color-scheme: dark)");
    theme.addEventListener("change", paint);
    // 使用页面已经声明的本地字体，字体就绪后重画，避免首次进入退回默认字体。
    void document.fonts?.load("96px " + (getComputedStyle(gl.domElement).fontFamily || "serif"), text).then(paint, () => {});
    return () => {
      mounted = false; observer.disconnect(); theme.removeEventListener("change", paint);
      if (surface.map === texture) surface.map = null;
      texture.dispose();
    };
  }, [gl, height, invalidate, text]);
  return <mesh ref={mesh} position={position} rotation={rotation} raycast={ignoreRaycast} name="spatial-surface-label" visible={false}>
    <planeGeometry args={[1, 1]} />
    <meshBasicMaterial ref={material} transparent side={FrontSide} depthTest depthWrite={false} toneMapped={false} />
  </mesh>;
}
