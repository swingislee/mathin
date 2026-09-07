/** 原粗棱边材质只改变被遮挡片段的连续性；可见片段的宽度、颜色保持原样。 */
export function voxelHiddenEdgeShaders(vertexShader: string, fragmentShader: string, axis: "x" | "y" | "z") {
  return {
    vertexShader: vertexShader.replace("#include <common>", "#include <common>\nvarying float vVoxelEdgeDistance;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvVoxelEdgeDistance = (position.${axis} + 0.5) * 1.035;`),
    fragmentShader: fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uVoxelFrontDepth;\nuniform vec2 uVoxelDepthSize;\nuniform float uVoxelDepthBias;\nvarying float vVoxelEdgeDistance;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        float voxelFrontDepth = texture2D(uVoxelFrontDepth, gl_FragCoord.xy / uVoxelDepthSize).x;
        if (gl_FragCoord.z > voxelFrontDepth + uVoxelDepthBias && mod(vVoxelEdgeDistance, 0.2) > 0.11) discard;`),
  };
}
