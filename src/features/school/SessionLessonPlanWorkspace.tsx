"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionResult } from "@/lib/action-result";
import type { SessionLessonPlan, TeachingLessonPlan } from "./teacher-preparation-contract";
import type { LessonPlanSaveResult, TeachingLessonPlanSaveInput } from "./SessionLessonPlanEditor";

const SessionLessonPlanEditor = dynamic(
  () => import("./SessionLessonPlanEditor").then((module) => module.SessionLessonPlanEditor),
  { ssr: false, loading: () => <Skeleton className="h-full min-h-96 w-full rounded-2xl" /> },
);

const TeachingLessonPlanEditor = dynamic(
  () => import("./SessionLessonPlanEditor").then((module) => module.TeachingLessonPlanEditor),
  { ssr: false, loading: () => <Skeleton className="h-full min-h-96 w-full rounded-2xl" /> },
);

const LessonPlanDocumentView = dynamic(
  () => import("./SessionLessonPlanEditor").then((module) => module.LessonPlanDocumentView),
  { ssr: false, loading: () => <Skeleton className="h-72 w-full rounded-2xl" /> },
);

export function SessionLessonPlanWorkspace(props: {
  lessonPlan: SessionLessonPlan;
  readOnly: boolean;
}) {
  return <SessionLessonPlanEditor key={`${props.lessonPlan.id ?? "new"}:${props.lessonPlan.revision}`} {...props} />;
}

export function TeachingLessonPlanWorkspace(props: {
  lessonPlan: TeachingLessonPlan;
  readOnly: boolean;
  saveLessonPlan: (input: TeachingLessonPlanSaveInput) => Promise<ActionResult<LessonPlanSaveResult>>;
}) {
  return (
    <TeachingLessonPlanEditor
      key={`${props.lessonPlan.id ?? "new"}:${props.lessonPlan.revision}`}
      {...props}
    />
  );
}

export function SessionLessonPlanReview({ content, revision }: { content: unknown[]; revision: number }) {
  return <LessonPlanDocumentView key={revision} content={content} />;
}
