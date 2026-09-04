"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LeadImportBatchSummary, MofaxiaoStudentImportBatchSummary } from "./actions/types";
import { ImportStudentsPanel } from "./ImportStudentsPanel";
import { MofaxiaoStudentImportPanel } from "./MofaxiaoStudentImportPanel";
import { XiaodituiImportPanel } from "./XiaodituiImportPanel";

export function StudentImportSourceTabs({
  leadBatches,
  mofaxiaoBatches,
}: {
  leadBatches: LeadImportBatchSummary[];
  mofaxiaoBatches: MofaxiaoStudentImportBatchSummary[];
}) {
  const t = useTranslations("school.students");

  return (
    <Tabs defaultValue="xiaoditui" className="space-y-8">
      <TabsList aria-label={t("importSourceType")}>
        <TabsTrigger value="xiaoditui">{t("importSourceXiaoditui")}</TabsTrigger>
        <TabsTrigger value="mofaxiao">{t("importSourceMofaxiao")}</TabsTrigger>
        <TabsTrigger value="generic">{t("importSourceGeneric")}</TabsTrigger>
      </TabsList>
      <TabsContent value="xiaoditui">
        <XiaodituiImportPanel recentBatches={leadBatches} />
      </TabsContent>
      <TabsContent value="mofaxiao">
        <MofaxiaoStudentImportPanel recentBatches={mofaxiaoBatches} />
      </TabsContent>
      <TabsContent value="generic">
        <ImportStudentsPanel />
      </TabsContent>
    </Tabs>
  );
}
