import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

function filesUnder(directory: string): string[] {
  const absoluteDirectory = path.join(root, directory);
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(relative) : [relative];
  });
}

describe("Dashboard table and divider semantics", () => {
  it("routes every Dashboard shadcn table through the shared table shell", () => {
    const files = [
      ...filesUnder("src/app/[locale]/dashboard"),
      ...filesUnder("src/features/school"),
      ...filesUnder("src/features/courseware-studio"),
    ].filter((file) => file.endsWith(".tsx") && read(file).includes("<Table"));

    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = read(file);
      expect(source, file).toContain("DashboardTableShell");
      expect(source, file).not.toMatch(/<TableBody[^>]*divide-y/);
    }
  });

  it("keeps the full table boundary and row separators in their shared primitives", () => {
    const shell = read("src/features/school/dashboard-page/DashboardCard.tsx");
    const table = read("src/components/ui/table.tsx");

    expect(shell).toContain("data-dashboard-table-shell");
    expect(shell).toContain("overflow-hidden rounded-2xl border border-line bg-card");
    expect(table).toContain('TableHeader({ className,...props }');
    expect(table).toContain('cn("border-b border-line",className)');
    expect(table).toContain('cn("divide-y divide-line",className)');
  });

  it("uses one page-header divider and keeps horizontal navigation attached to its content", () => {
    const header = read("src/features/school/dashboard-page/DashboardPageHeader.tsx");
    const commandPanel = read("src/features/school/dashboard-page/DashboardCommandPanel.tsx");
    const routeTabs = read("src/features/school/navigation/RouteTabs.tsx");

    expect(header).toContain("border-b border-line/60");
    expect(commandPanel).not.toMatch(/\bborder-[tb]\b/);
    expect(routeTabs).not.toMatch(/\bborder-[tb]\b/);
  });

  it("does not draw separators between settings fields or activity items", () => {
    const organization = read("src/features/school/OrganizationProfileForm.tsx");
    const scheduleDefaults = read("src/features/school/ScheduleDefaultsForm.tsx");
    const academicYears = read("src/app/[locale]/dashboard/academic-years/page.tsx");
    const activities = read("src/features/school/ActivitiesManager.tsx");
    const classroomList = read("src/features/school/ClassroomList.tsx");

    for (const source of [organization, scheduleDefaults, academicYears, activities]) {
      expect(source).not.toContain("border-y");
      expect(source).not.toContain("divide-y");
    }
    expect(organization).not.toContain("border-t");
    expect(classroomList).not.toContain("divide-x divide-line");
    expect(classroomList).not.toContain("border-y border-line");
  });
});
