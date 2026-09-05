import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dashboardTableFilterOptions,
  filterAndSortDashboardRows,
  type DashboardTableColumnDefinition,
} from "@/features/school/dashboard-page/useDashboardTableView";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("subject-operations table header controls", () => {
  it("filters and stably sorts a loaded list through shared column definitions", () => {
    type Row = { id: string; name: string; score: number | null; tags: string[] };
    type Column = "name" | "score" | "tags";
    const rows: Row[] = [
      { id: "b", name: "贝贝", score: null, tags: ["新生"] },
      { id: "a", name: "安安", score: 90, tags: ["新生", "重点"] },
      { id: "c", name: "聪聪", score: 70, tags: ["重点"] },
    ];
    const columns: Record<Column, DashboardTableColumnDefinition<Row>> = {
      name: {
        filterValues: (row) => ({ value: row.name, label: row.name }),
        sortValue: (row) => row.name,
      },
      score: {
        filterValues: (row) => ({ value: row.score === null ? "empty" : String(row.score), label: row.score === null ? "未填写" : String(row.score) }),
        sortValue: (row) => row.score,
      },
      tags: {
        filterValues: (row) => row.tags.map((tag) => ({
          value: tag,
          label: tag,
          group: tag === "重点" ? "优先级" : "阶段",
        })),
        sortValue: (row) => row.tags.join(" "),
      },
    };

    expect(dashboardTableFilterOptions(rows, columns, "zh").tags.map((option) => option.value))
      .toEqual(["新生", "重点"]);
    expect(dashboardTableFilterOptions(rows, columns, "zh").tags.map((option) => option.group))
      .toEqual(["阶段", "优先级"]);
    expect(filterAndSortDashboardRows(rows, columns, { tags: "重点" }, null, "zh").map((row) => row.id))
      .toEqual(["a", "c"]);
    expect(filterAndSortDashboardRows(rows, columns, {}, { column: "score", direction: "desc" }, "zh").map((row) => row.id))
      .toEqual(["a", "c", "b"]);
  });

  it("uses one header menu with direct sort choices and grouped filters in every subject-operations data table", () => {
    const sharedHeader = read("src", "features", "school", "dashboard-page", "DashboardTableColumnHeader.tsx");
    expect(sharedHeader).toContain("CommandItem");
    expect(sharedHeader).toContain("chooseFilter(option.value)");
    expect(sharedHeader).toContain('chooseSort("asc")');
    expect(sharedHeader).toContain('chooseSort("desc")');
    expect(sharedHeader).toContain("option.group");
    expect(sharedHeader).toContain("data-dashboard-table-menu");
    expect(sharedHeader.match(/<ListFilter/g)).toHaveLength(1);
    expect(sharedHeader).not.toContain("ArrowUpDown");
    expect(sharedHeader).not.toContain("<SortIcon");
    expect(sharedHeader).not.toContain("nextSortDirection");
    expect(sharedHeader).not.toContain('@/components/ui/select');

    const invitations = read("src", "features", "school", "InvitationCoordinationWorkbench.tsx");
    expect(invitations).toContain('group: tableT("fieldName")');
    expect(invitations).toContain('group: tableT("fieldPhone")');
    expect(invitations).toContain('group: tableT("fieldGrade")');
    expect(invitations).toContain('group: tableT("fieldOwner")');

    const dataTables: Array<[string, number]> = [
      [invitations, 4],
      [read("src", "features", "school", "AssessmentUnifiedWorkbench.tsx"), 7],
      [read("src", "features", "school", "ActivitiesManager.tsx"), 5],
      [read("src", "features", "school", "StudentsTable.tsx"), 6],
      [read("src", "features", "school", "LeadFirstContactWorkbench.tsx"), 4],
      [read("src", "features", "school", "LeadIntakeWorkbench.tsx"), 4],
      [read("src", "features", "school", "ActivityWorkspace.tsx"), 6],
      [read("src", "features", "school", "PublicClassWorkspace.tsx"), 8],
      [read("src", "features", "school", "ImportStudentsPanel.tsx"), 15],
      [read("src", "features", "school", "MofaxiaoStudentImportPanel.tsx"), 21],
      [read("src", "features", "school", "XiaodituiImportPanel.tsx"), 23],
    ];
    for (const [source, count] of dataTables) {
      expect(source.match(/<DashboardTableColumnHeader/g)).toHaveLength(count);
      expect(source).toContain("useDashboardTableView");
    }

    const leads = read("src", "features", "school", "LeadPoolTable.tsx");
    expect(leads).toContain("DashboardTableColumnHeader");
    expect(leads).toContain("filterAndSortLeadRows");
    expect(read("src", "app", "[locale]", "dashboard", "students", "page.tsx")).toContain("<StudentsTable");
  });
});
