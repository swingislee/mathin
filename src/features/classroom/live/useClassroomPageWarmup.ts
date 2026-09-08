"use client";

import { useEffect, useRef } from "react";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { warmCoursewareImage } from "@/features/courseware-preview/preload";
import type { SessionPageDoc } from "../courseware/session-assets";
import type { CoursewarePage } from "../types";
import { classroomWarmImageUrls, createClassroomImageWarmup } from "./classroom-page-presentation";

/** 图片解码在后台推进；翻页、事件持久化和课堂同步沿用原有时序。 */
export function useClassroomPageWarmup(
  pages: readonly CoursewarePage[],
  currentPage: number,
  docs: readonly SessionPageDoc[] | null,
  bindingUrls: ResolvedBindingUrls,
  assetUrls: Readonly<Record<string, string>>,
) {
  const warmup = useRef<ReturnType<typeof createClassroomImageWarmup> | null>(null);
  useEffect(() => {
    const queue = createClassroomImageWarmup(warmCoursewareImage);
    warmup.current = queue;
    return () => {
      queue.dispose();
      warmup.current = null;
    };
  }, []);
  useEffect(() => {
    warmup.current?.update(classroomWarmImageUrls(pages, currentPage, docs, bindingUrls, assetUrls));
  }, [assetUrls, bindingUrls, currentPage, docs, pages]);
}
