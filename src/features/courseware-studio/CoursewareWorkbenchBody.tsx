"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CoursewarePageEditor } from "./CoursewarePageEditor";
import type { CoursewareReviewViewport } from "./CoursewareReviewViewport";

const ReviewViewport = dynamic(
  () => import("./CoursewareReviewViewport").then((module) => module.CoursewareReviewViewport),
  { ssr: false, loading: () => <WorkbenchSkeleton /> },
);

const PageEditor = dynamic(
  () => import("./CoursewarePageEditor").then((module) => module.CoursewarePageEditor),
  { ssr: false, loading: () => <WorkbenchSkeleton /> },
);

type Props = {
  mode: "preview" | "edit";
  review: ComponentProps<typeof CoursewareReviewViewport> | null;
  editor: ComponentProps<typeof CoursewarePageEditor> | null;
};

/** P4H-6：只在选定模式下载 P6 的预览器或编辑器，server shell 保持轻量。 */
export function CoursewareWorkbenchBody({ mode, review, editor }: Props) {
  if (mode === "edit" && editor) return <PageEditor {...editor} />;
  if (review) return <ReviewViewport {...review} />;
  return null;
}

function WorkbenchSkeleton() {
  return <div className="mt-4 grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_20rem]">
    <Skeleton className="h-96 rounded-2xl" />
    <Skeleton className="aspect-video rounded-2xl" />
    <Skeleton className="h-96 rounded-2xl" />
  </div>;
}
