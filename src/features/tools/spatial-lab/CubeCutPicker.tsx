"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { bindCubeCutPicking, type CubeCutInteraction } from "./cube-structures-cut-controller";

export function CubeCutPicker({ interaction }: { readonly interaction: CubeCutInteraction }) {
  const { gl, get } = useThree();
  const current = useRef(interaction);
  useLayoutEffect(() => { current.current = interaction; }, [interaction]);
  useEffect(() => bindCubeCutPicking(gl.domElement, () => current.current, () => get().camera), [gl, get]);
  return null;
}
