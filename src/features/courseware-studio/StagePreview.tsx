"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { isAixuexiPageDoc } from "@/features/courseware-doc/aixuexi-schema";
import type { AixuexiStageProps } from "@/features/courseware-doc/AixuexiStage";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { DocStageProps } from "@/features/courseware-doc/DocStage";

/**
 * DocStage 的懒加载 client 叶子(games/boards.tsx 模式):渲染器只在预览页
 * 按需下发,不进其他 dashboard 路由的首屏 JS。
 */
const DocStage = dynamic<DocStageProps>(() => import("@/features/courseware-doc/DocStage"), {
  ssr: false,
  loading: () => <Skeleton className="aspect-video w-full rounded-xl" />,
});

const AixuexiStage = dynamic<AixuexiStageProps>(() => import("@/features/courseware-doc/AixuexiStage"), {
  ssr: false,
  loading: () => <Skeleton className="aspect-video w-full rounded-xl" />,
});

export type StagePreviewProps = Omit<DocStageProps, "doc"> & {
  doc: CoursewareDoc;
  onAdvance?: () => void;
};

export function StagePreview(props: StagePreviewProps) {
  if (isAixuexiPageDoc(props.doc)) {
    return (
      <AixuexiStage
        key={`${props.doc.source.coursewareId}:${props.doc.source.pageDatabaseId}`}
        {...props as AixuexiStageProps}
      />
    );
  }
  return <DocStage {...props as DocStageProps} />;
}
