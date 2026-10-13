import { getTranslations } from "next-intl/server";
import { Input } from "@/components/ui/input";
import {
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardEmptyCard,
} from "@/features/school/dashboard-page";
import { FilterBar, FilterBarSubmit, FilterSearchInput } from "@/features/school/FilterBar";
import {
  COURSEWARE_TASK_TABS,
  type CoursewareTaskItem,
  type CoursewareTaskTab,
} from "./data";
import { CoursewareTaskGroups } from "./CoursewareTaskGroups";
import { groupCoursewareTasks } from "./task-groups";

type Props = {
  locale: string;
  tab: CoursewareTaskTab;
  query: string;
  tasks: CoursewareTaskItem[];
  canEditCourseware: boolean;
};

export function hrefFor(tab: CoursewareTaskTab, query: string) {
  const search = new URLSearchParams({ tab });
  if (query) search.set("q", query);
  return `/dashboard/courseware?${search.toString()}`;
}

async function taskTabLabels() {
  const t = await getTranslations("coursewareStudio");
  const labels: Record<CoursewareTaskTab, string> = {
    incomplete: t("tabIncomplete"),
    recent: t("tabRecent"),
    publish: t("tabPublish"),
  };
  return labels;
}

export async function CoursewareTaskCommandPanel({ tab, query }: { tab: CoursewareTaskTab; query: string }) {
  const [t, tabLabels] = await Promise.all([getTranslations("coursewareStudio"), taskTabLabels()]);
  return (
    <DashboardCommandPanel>
      <DashboardCommandState>
        <DashboardCommandTabs
          ariaLabel={t("workbenchTitle")}
          activeValue={tab}
          items={COURSEWARE_TASK_TABS.map((item) => ({ value: item, label: tabLabels[item], href: hrefFor(item, query) }))}
        />
      </DashboardCommandState>
      <DashboardCommandFilters>
        <FilterBar aria-label={t("taskSearch")}>
          <Input type="hidden" name="tab" value={tab} readOnly />
          <FilterSearchInput defaultValue={query} name="q" placeholder={t("taskSearchPlaceholder")} aria-label={t("taskSearch")} />
          <FilterBarSubmit>{t("taskSearch")}</FilterBarSubmit>
        </FilterBar>
      </DashboardCommandFilters>
    </DashboardCommandPanel>
  );
}

export async function CoursewareTaskQueue({ locale, tab, query, tasks, canEditCourseware }: Props) {
  const t = await getTranslations("coursewareStudio");
  if (tasks.length === 0) return <DashboardEmptyCard>{t("taskQueueEmpty")}</DashboardEmptyCard>;
  return <section>
    <CoursewareTaskGroups key={`${tab}:${query}`} groups={groupCoursewareTasks(tasks, tab)} locale={locale}
      baseHref={hrefFor(tab, query)} canEditCourseware={canEditCourseware} expandAll={Boolean(query)} />
    {tasks.length >= 60 && <p className="mt-3 text-xs text-muted">{t("taskQueueLimitHint")}</p>}
  </section>;
}
