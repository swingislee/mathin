import type { RenderProps } from "@react-three/fiber";

/** 全仓 3D 画布共用受支持的阴影配置；关闭阴影与启用 PCF 保持显式区分。 */
export const THREE_SHADOWS = {
  disabled: false,
  filtered: "percentage",
} as const satisfies Record<string, RenderProps<HTMLCanvasElement>["shadows"]>;
