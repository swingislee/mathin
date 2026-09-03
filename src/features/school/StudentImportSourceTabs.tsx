"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MofaxiaoStudentImportBatchSummary } from "./actions/types";
import { ImportStudentsPanel } from "./ImportStudentsPanel";
import { MofaxiaoStudentImportPanel } from "./MofaxiaoStudentImportPanel";

export function StudentImportSourceTabs({
  mofaxiaoBatches,
}: {
  mofaxiaoBatches: MofaxiaoStudentImportBatchSummary[];
}) {
  const t = useTranslations("school.students");

  return (
    <Tabs defaultValue="mofaxiao" className="space-y-8">
      <TabsList aria-label={t("importSourceType")}>
        <TabsTrigger value="mofaxiao">{t("importSourceMofaxiao")}</TabsTrigger>
        <TabsTrigger value="generic">{t("importSourceGeneric")}</TabsTrigger>
      </TabsList>
      <TabsContent value="mofaxiao">
        <MofaxiaoStudentImportPanel recentBatches={mofaxiaoBatches} />
      </TabsContent>
      <TabsContent value="generic">
        <ImportStudentsPanel />
      </TabsContent>
    </Tabs>
  );
}
