"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocStageProps } from "@/features/courseware-doc/DocStage";

/**
 * DocStage 的懒加载 client 叶子(games/boards.tsx 模式):渲染器只在预览页
 * 按需下发,不进其他 dashboard 路由的首屏 JS。
 */
const DocStage = dynamic(() => import("@/features/courseware-doc/DocStage"), {
  ssr: false,
  loading: () => <Skeleton className="aspect-video w-full rounded-xl" />,
});

export function StagePreview(props: DocStageProps) {
  return <DocStage {...props} />;
}
