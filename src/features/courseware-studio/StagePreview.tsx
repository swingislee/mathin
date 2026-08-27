"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { isAixuexiPageDoc } from "@/features/courseware-doc/aixuexi-schema";
import type { AixuexiStageProps } from "@/features/courseware-doc/AixuexiStage";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { DocStageProps } from "@/features/courseware-doc/DocStage";
import { isGamePageDoc } from "@/features/courseware-doc/game-page-schema";
import type { GamePageStageProps } from "@/features/games/courseware/GamePageStage";
import { isMicrocoursePageDoc } from "@/features/courseware-doc/microcourse-schema";
import type { MicrocourseStageProps } from "@/features/courseware-doc/MicrocourseStage";
import { isSpatialPageDoc } from "@/features/courseware-doc/spatial";
import type { SpatialCoursewareStageProps } from "@/features/courseware-doc/SpatialCoursewareStage";

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

const SpatialCoursewareStage = dynamic<SpatialCoursewareStageProps>(
  () => import("@/features/courseware-doc/SpatialCoursewareStage"),
  {
    ssr: false,
    loading: () => <Skeleton className="aspect-[4/3] w-full rounded-xl" />,
  },
);

const MicrocourseStage = dynamic<MicrocourseStageProps>(
  () => import("@/features/courseware-doc/MicrocourseStage"),
  {
    ssr: false,
    loading: () => <Skeleton className="aspect-[4/3] w-full rounded-xl" />,
  },
);

const GamePageStage = dynamic<GamePageStageProps>(
  () => import("@/features/games/courseware/GamePageStage"),
  {
    ssr: false,
    loading: () => <Skeleton className="aspect-[4/3] w-full rounded-xl" />,
  },
);

export type StagePreviewProps = Omit<DocStageProps, "doc"> & {
  doc: CoursewareDoc;
  onAdvance?: () => void;
};

export function StagePreview(props: StagePreviewProps) {
  if (isGamePageDoc(props.doc)) {
    return <GamePageStage {...props as GamePageStageProps} />;
  }
  if (isMicrocoursePageDoc(props.doc)) {
    return <MicrocourseStage {...props as MicrocourseStageProps} />;
  }
  if (isAixuexiPageDoc(props.doc)) {
    return (
      <AixuexiStage
        key={`${props.doc.source.coursewareId}:${props.doc.source.pageDatabaseId}`}
        {...props as AixuexiStageProps}
      />
    );
  }
  if (isSpatialPageDoc(props.doc)) {
    return <SpatialCoursewareStage doc={props.doc} className={props.className} />;
  }
  return <DocStage {...props as DocStageProps} />;
}
