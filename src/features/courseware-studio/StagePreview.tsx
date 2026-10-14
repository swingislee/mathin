"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { SectionLoading } from "@/components/section-loading";
import {
  isAixuexiPageDoc,
  isCoursewareCompositionPage,
  isGamePageDoc,
  isMicrocoursePageDoc,
  isSourceRuntimePageDoc,
} from "@/features/courseware-doc/page-kind";
import type { AixuexiStageProps } from "@/features/courseware-doc/AixuexiStage";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { CoursewareCompositionStageProps } from "@/features/courseware-doc/CoursewareCompositionStage";
import type { DocStageProps } from "@/features/courseware-doc/DocStage";
import type { GamePageStageProps } from "@/features/games/courseware/GamePageStage";
import type { MicrocourseStageProps } from "@/features/courseware-doc/MicrocourseStage";
import { isSpatialPageDoc } from "@/features/courseware-doc/spatial";
import type { SpatialCoursewareStageProps } from "@/features/courseware-doc/SpatialCoursewareStage";
import type { SourceRuntimeStageProps } from "@/features/courseware-doc/SourceRuntimeStage";
import type { GameMirrorState } from "@/features/games/types";
import type { ClassroomToolRuntime } from "@/features/tools/courseware/tool-classroom";

/** 舞台代码按需下载期间占住画幅，并写明正在加载课件页面。 */
function StageLoading({ ratio }: { ratio: "aspect-video" | "aspect-[4/3]" }) {
  const t = useTranslations("common");
  return <div className={`${ratio} w-full rounded-xl bg-line/10`}><SectionLoading label={t("loadingCourseware")} className="h-full py-0" /></div>;
}

/**
 * DocStage 的懒加载 client 叶子(games/boards.tsx 模式):渲染器只在预览页
 * 按需下发,不进其他 dashboard 路由的首屏 JS。
 */
const DocStage = dynamic<DocStageProps>(() => import("@/features/courseware-doc/DocStage"), {
  ssr: false,
  loading: () => <StageLoading ratio="aspect-video" />,
});

const AixuexiStage = dynamic<AixuexiStageProps>(() => import("@/features/courseware-doc/AixuexiStage"), {
  ssr: false,
  loading: () => <StageLoading ratio="aspect-video" />,
});

const SourceRuntimeStage = dynamic<SourceRuntimeStageProps>(
  () => import("@/features/courseware-doc/SourceRuntimeStage"),
  {
    ssr: false,
    loading: () => <StageLoading ratio="aspect-video" />,
  },
);

const SpatialCoursewareStage = dynamic<SpatialCoursewareStageProps>(
  () => import("@/features/courseware-doc/SpatialCoursewareStage"),
  {
    ssr: false,
    loading: () => <StageLoading ratio="aspect-[4/3]" />,
  },
);

const MicrocourseStage = dynamic<MicrocourseStageProps>(
  () => import("@/features/courseware-doc/MicrocourseStage"),
  {
    ssr: false,
    loading: () => <StageLoading ratio="aspect-[4/3]" />,
  },
);

const CoursewareCompositionStage = dynamic<CoursewareCompositionStageProps>(
  () => import("@/features/courseware-doc/CoursewareCompositionStage"),
  {
    ssr: false,
    loading: () => <StageLoading ratio="aspect-[4/3]" />,
  },
);

const GamePageStage = dynamic<GamePageStageProps>(
  () => import("@/features/games/courseware/GamePageStage"),
  {
    ssr: false,
    loading: () => <StageLoading ratio="aspect-[4/3]" />,
  },
);

export type StagePreviewProps = Omit<DocStageProps, "doc"> & {
  doc: CoursewareDoc;
  onAdvance?: () => void;
  gameMirror?: GameMirrorState | null;
  onGameMirror?: (state: GameMirrorState) => void;
  classroomTools?: ClassroomToolRuntime;
  sourceRuntimeFourByThreeMode?: SourceRuntimeStageProps["sourceRuntimeFourByThreeMode"];
  sourceRuntimeEditor?: SourceRuntimeStageProps["editor"];
};

export function StagePreview(props: StagePreviewProps) {
  if (isCoursewareCompositionPage(props.doc)) {
    return <CoursewareCompositionStage {...props as CoursewareCompositionStageProps} />;
  }
  if (isSourceRuntimePageDoc(props.doc)) {
    return (
      <SourceRuntimeStage
        {...props as SourceRuntimeStageProps}
        editor={props.sourceRuntimeEditor}
      />
    );
  }
  if (isGamePageDoc(props.doc)) {
    return (
      <GamePageStage
        {...props as GamePageStageProps}
        mirror={props.gameMirror}
        onMirror={props.onGameMirror}
      />
    );
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
