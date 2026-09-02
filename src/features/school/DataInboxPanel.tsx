"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LeadImportBatchSummary, StudentImportBatchSummary } from "./actions/types";
import { ImportStudentsPanel } from "./ImportStudentsPanel";
import { XiaodituiImportPanel } from "./XiaodituiImportPanel";

export function DataInboxPanel({
  leadBatches,
  studentBatches,
}: {
  leadBatches: LeadImportBatchSummary[];
  studentBatches: StudentImportBatchSummary[];
}) {
  const t = useTranslations("school.students");
  return (
    <Tabs defaultValue="xiaoditui" className="space-y-8">
      <TabsList aria-label={t("importSourceType")}>
        <TabsTrigger value="xiaoditui">{t("importSourceXiaoditui")}</TabsTrigger>
        <TabsTrigger value="generic">{t("importSourceGeneric")}</TabsTrigger>
      </TabsList>
      <TabsContent value="xiaoditui"><XiaodituiImportPanel recentBatches={leadBatches} /></TabsContent>
      <TabsContent value="generic"><ImportStudentsPanel recentBatches={studentBatches} /></TabsContent>
    </Tabs>
  );
}
