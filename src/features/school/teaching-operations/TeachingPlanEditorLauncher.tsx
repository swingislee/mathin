"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CourseFamilyDetail } from "./course-family-detail";
import type { CourseScope } from "./types";

const TeachingPlanEditor = dynamic(() => import("./TeachingPlanEditor").then((module) => module.TeachingPlanEditor), { ssr: false });

export function TeachingPlanEditorLauncher({
  familyId,
  scope,
  selectedVariant,
  lectures,
  canEditCourseware,
  label,
}: {
  familyId: string;
  scope: CourseScope;
  selectedVariant: CourseFamilyDetail["selectedVariant"];
  lectures: CourseFamilyDetail["teachingPlan"];
  canEditCourseware: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" size="sm" onClick={() => setOpen(true)}>{label}</Button>
    {open && <TeachingPlanEditor familyId={familyId} scope={scope} selectedVariant={selectedVariant} lectures={lectures} canEditCourseware={canEditCourseware} onClose={() => setOpen(false)} />}
  </>;
}
