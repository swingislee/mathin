"use client";

import type { ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { usePanelLayout } from "@/hooks/use-panel-layout";
import { useSplitOrientation } from "@/hooks/use-split-orientation";

/**
 * 备课工作区的左右分栏：备课流程条 | 课件区（docs/plan/27 §3 D3）。
 *
 * 替代原来的 `xl:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)]`。那份写法有两个下限：
 * 流程条 384px 不可压缩，右栏又要再切出 272px 的课件目录，1280 视口下 4:3 舞台
 * 只剩约 180×135px。改成拖拽后，教师按当前在做的事分配宽度——读课件时把流程条推窄，
 * 写教案时再推回来——并且下限降到 320px。
 *
 * 并排阈值 880px：流程条 320 + 课件区至少 560（目录与预览并排的下限）+ 分隔条。
 * 低于它改成上下分栏，让课件区拿到完整宽度。
 *
 * 默认 360 而不是原来的 384–480：右边要再切一次目录与预览，左栏每多占 60px，
 * 4:3 舞台的边长就少 60px。教师需要更宽的流程条时拖一下即可，且会被记住。
 */
const SIDE_BY_SIDE_MIN_WIDTH = 880;
const FLOW_MIN_SIZE = 320;
const FLOW_DEFAULT_SIZE = 360;

export function SessionPrepSplit({ flow, courseware }: { flow: ReactNode; courseware: ReactNode }) {
  const [elementRef, orientation] = useSplitOrientation(SIDE_BY_SIDE_MIN_WIDTH);
  const horizontal = orientation === "horizontal";
  const { groupRef, onLayoutChanged } = usePanelLayout(`session-prep:${orientation}`);

  return (
    <ResizablePanelGroup
      elementRef={elementRef}
      groupRef={groupRef}
      orientation={orientation}
      onLayoutChanged={onLayoutChanged}
      // 定高画布之外（窄屏、整页滚动）父级不是 flex，只给 flex-1 会让分栏塌成 0 高。
      // .panel-canvas 在定高档把 min-height 重置为 0 并接管高度，两档各有一份可用高度。
      className="min-h-[36rem] min-w-0 flex-1 panel-canvas"
      data-session-prep-split
      data-orientation={orientation}
    >
      <ResizablePanel
        id="flow"
        minSize={horizontal ? FLOW_MIN_SIZE : "25%"}
        maxSize="55%"
        defaultSize={horizontal ? FLOW_DEFAULT_SIZE : "45%"}
        // 窗口变宽时增量全给课件区：流程条是定宽表单，变宽只是把留白拉长。
        groupResizeBehavior={horizontal ? "preserve-pixel-size" : undefined}
      >
        {flow}
      </ResizablePanel>

      <ResizableHandle withHandle orientation={orientation} className={horizontal ? "mx-2" : "my-2"} />

      <ResizablePanel id="courseware" minSize={horizontal ? 360 : "30%"}>
        {courseware}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
