"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import { bulkArchiveClassroomsAction } from "./actions/testdata";
import { cn } from "@/lib/utils";
import type { ClassroomListItem } from "./teaching-operations/classroom-queries";

/**
 * test scope 的使用场景是批量整理而非浏览，所以用紧凑表格+勾选代替 ClassroomList 的卡片视图。
 */
export function ClassroomTestBulkPanel({ classrooms }: { classrooms: ClassroomListItem[] }) {
  const t = useTranslations("school.testdata");
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const archiveRun = useAction(bulkArchiveClassroomsAction, {
    successMessage: t("bulkArchiveSuccess"),
    errorMessage: { default: t("bulkArchiveFailed") },
    onSuccess: () => { setSelected(new Set()); router.refresh(); },
  });

  const allSelected = classrooms.length > 0 && selected.size === classrooms.length;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(classrooms.map((c) => c.id)));
  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (classrooms.length === 0) {
    return <p className="mt-6 rounded-2xl border border-dashed border-line bg-card p-8 text-center text-sm text-muted">{t("bulkPanelEmpty")}</p>;
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3">
        <p className="text-sm text-muted">{t("bulkSelectedCount", { count: selected.size })}</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={selectedIds.length === 0 || archiveRun.pending}
            onClick={() => archiveRun.run(selectedIds, true)}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "disabled:opacity-40")}
          >
            {t("bulkArchiveSelected")}
          </button>
          <button
            type="button"
            disabled={selectedIds.length === 0 || archiveRun.pending}
            onClick={() => archiveRun.run(selectedIds, false)}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "disabled:opacity-40")}
          >
            {t("bulkUnarchiveSelected")}
          </button>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
        <Table className="w-full text-left text-sm">
          <TableHeader className="border-b border-line text-xs text-muted">
            <TableRow>
              <TableHead className="w-10 px-4 py-3"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
              <TableHead className="px-4 py-3 font-medium">{t("bulkColName")}</TableHead>
              <TableHead className="px-4 py-3 font-medium">{t("bulkColStatus")}</TableHead>
              <TableHead className="px-4 py-3 font-medium">{t("bulkColArchived")}</TableHead>
              <TableHead className="px-4 py-3 font-medium"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-line">
            {classrooms.map((classroom) => (
              <TableRow key={classroom.id}>
                <TableCell className="px-4 py-3"><Checkbox checked={selected.has(classroom.id)} onCheckedChange={() => toggleOne(classroom.id)} /></TableCell>
                <TableCell className="px-4 py-3 font-medium">{classroom.name}</TableCell>
                <TableCell className="px-4 py-3 text-muted">{classroom.operationalStatus}</TableCell>
                <TableCell className="px-4 py-3">
                  {classroom.archivedAt ? <Badge variant="outline">{t("bulkArchivedBadge")}</Badge> : <span className="text-muted">—</span>}
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <Link href={`/dashboard/classes/${classroom.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                    {t("bulkOpenClassroom")}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
