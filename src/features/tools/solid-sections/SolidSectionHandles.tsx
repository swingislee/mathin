"use client";

import { SpatialActionIcon } from "../spatial-interaction/SpatialActionIcon";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { SolidSectionSettings } from "./solid-sections-contract";
import { bindSolidSectionDrag, sectionDragHandles, type SectionDragInteraction } from "./solid-section-drag";
import { solidSectionsMessages } from "./solid-sections-messages";
import { beginSpatialObjectGesture } from "@/features/spatial-math/renderer-r3f/spatial-object-gesture";

export function SolidSectionHandles({ interaction, displayed, locale, onPreview, onDragging }: {
  interaction: SectionDragInteraction | null; displayed: SolidSectionSettings; locale: string;
  onPreview: (settings: SolidSectionSettings | null) => void; onDragging: (active: boolean) => void;
}) {
  const { gl, get } = useThree(), current = useRef({ interaction, onPreview, onDragging });
  useLayoutEffect(() => { current.current = { interaction, onPreview, onDragging }; }, [interaction, onPreview, onDragging]);
  useEffect(() => bindSolidSectionDrag(gl.domElement, () => current.current.interaction, () => get().camera,
    (next) => current.current.onPreview(next), (active) => {
      // 沿用共享轴拖动的相机手势边界，接管未完成的视角动画。
      if (active) beginSpatialObjectGesture(gl.domElement);
      current.current.onDragging(active);
    }), [gl, get]);
  if (!interaction) return null;
  const handles = sectionDragHandles(interaction.entity, displayed), m = solidSectionsMessages(locale);
  const axes = displayed.axis === "x" ? ["Y", "Z"] : displayed.axis === "y" ? ["X", "Z"] : ["X", "Y"];
  return <group name="solid-section-handles">
    {(["offset", "tiltA", "tiltB"] as const).map((part, index) => {
      const anchor = handles[part], label = part === "offset" ? m.dragPlane : `${m.tilt} ${axes[index - 1]}`;
      return <Html key={part} position={[anchor.x, anchor.y, anchor.z]} center zIndexRange={[7, 0]} style={{ pointerEvents: "none" }}>
        <span className="flex size-9 items-center justify-center rounded-full border border-crater bg-paper text-ink shadow-sm" title={label} aria-hidden="true">
          <SpatialActionIcon action={part === "offset" ? "sectionOffset" : "rotate"} className={`size-4 ${part === "tiltB" ? "-scale-x-100" : ""}`} />
        </span>
      </Html>;
    })}
  </group>;
}
