"use client"

import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

/*
 * react-resizable-panels v4 的导出是 Group / Panel / Separator，且原生支持像素约束
 * （`minSize={320}` 就是 320px）。shadcn registry 生成的封装仍是 v2 的
 * PanelGroup / PanelResizeHandle + 百分比模型，在 v4 上直接报错，因此这份封装按 v4
 * 重写，只保留 shadcn 的三个导出名与 Mathin token。
 *
 * 分隔条的命中区用 ::before 向两侧各扩 8px：视觉上仍是 1px 的线，手指和触控笔却有
 * 17px 可抓——这条线在 iPad 上要能被拖动，而 1px 在粗指针下等于不可命中。
 */

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) => (
  <ResizablePrimitive.Group
    className={cn("flex min-h-0 min-w-0", className)}
    {...props}
  />
)

const ResizablePanel = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) => (
  <ResizablePrimitive.Panel
    className={cn("flex min-h-0 min-w-0 flex-col", className)}
    {...props}
  />
)

const ResizableHandle = ({
  withHandle,
  orientation = "horizontal",
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
  /** 所属 Group 的方向；决定命中区往哪一轴扩张与光标形状。 */
  orientation?: "horizontal" | "vertical"
}) => (
  <ResizablePrimitive.Separator
    className={cn(
      "group/handle relative flex touch-none select-none items-center justify-center bg-line/70 transition-colors hover:bg-crater/60 focus-visible:bg-crater focus-visible:outline-none data-[disabled]:cursor-default data-[disabled]:hover:bg-line/70",
      orientation === "horizontal"
        ? "w-px cursor-col-resize before:absolute before:-inset-x-2 before:inset-y-0 before:content-['']"
        : "h-px cursor-row-resize before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']",
      className
    )}
    {...props}
  >
    {withHandle ? (
      <div
        className={cn(
          "z-10 flex items-center justify-center rounded-full border border-line bg-card text-muted opacity-0 transition-opacity group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100",
          orientation === "horizontal" ? "h-6 w-3" : "h-3 w-6 rotate-90"
        )}
      >
        <GripVertical size={10} />
      </div>
    ) : null}
  </ResizablePrimitive.Separator>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
