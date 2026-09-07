"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function StaffOverviewCapacityTabs({ teacherLabel, gradeLabel, teachers, grades, classroomLabel, classrooms }: {
  teacherLabel: string; gradeLabel: string; teachers: ReactNode; grades: ReactNode;
  classroomLabel?: string; classrooms?: ReactNode;
}) {
  return <Tabs defaultValue="teachers" className="flex min-h-0 flex-1 flex-col gap-0">
    <TabsList className="m-2 h-8 max-w-full shrink-0 self-start">
      <TabsTrigger value="teachers" className="px-3 py-1 text-xs">{teacherLabel}</TabsTrigger>
      <TabsTrigger value="grades" className="px-3 py-1 text-xs">{gradeLabel}</TabsTrigger>
      {classrooms ? <TabsTrigger value="classrooms" className="px-3 py-1 text-xs">{classroomLabel}</TabsTrigger> : null}
    </TabsList>
    <TabsContent value="teachers" className="mt-0 flex min-h-0 flex-1 flex-col">{teachers}</TabsContent>
    <TabsContent value="grades" className="mt-0 flex min-h-0 flex-1 flex-col">{grades}</TabsContent>
    {classrooms ? <TabsContent value="classrooms" className="mt-0 flex min-h-0 flex-1 flex-col">{classrooms}</TabsContent> : null}
  </Tabs>;
}
