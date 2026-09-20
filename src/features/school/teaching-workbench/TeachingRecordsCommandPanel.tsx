import { Ellipsis } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { ClassWorkspaceCommandPanel } from "../ClassWorkspaceCommandPanel";
import { RouteTabs, type RouteTab } from "../navigation/RouteTabs";
import type { TeachingGrouping } from "./teaching-grouping-contract";
import type { TeachingTerm, TeachingTimeGrain, TeachingTimeWindow } from "./teaching-period-contract";
import { TeachingPeriodPicker } from "./TeachingPeriodPicker";

/** 正式记录与本地复现共用同一套分组、时间和紧凑布局。 */
export function TeachingRecordsCommandPanel({ groupBy, grain, window, baseHref, terms, today, selection, links = [], navigation }: {
  groupBy: TeachingGrouping; grain: TeachingTimeGrain; window: TeachingTimeWindow | null;
  baseHref: string; terms: TeachingTerm[]; today: string; selection: string; links?: RouteTab[];
  navigation?: ReactNode;
}) {
  const t = useTranslations("school.teachingWorkbench");
  const groupHref = (group: TeachingGrouping) => {
    const [path, raw] = baseHref.split("?");
    const params = new URLSearchParams(raw);
    params.set("group", group);
    return `${path}?${params}`;
  };
  return <ClassWorkspaceCommandPanel navigation={navigation} grouping={<RouteTabs ariaLabel={t("grouping.title")} activeValue={groupBy} items={([
      "grade", "teacher",
    ] as const).map(group => ({ value: group, label: t(group === "grade" ? "grouping.byGrade" : "grouping.byTeacher"), href: groupHref(group) }))} />}
    period={<TeachingPeriodPicker key={`${grain}:${selection}:${window?.termId ?? ""}`} grain={grain} window={window} baseHref={baseHref} terms={terms} today={today} />}
    actions={links.length > 0 ?
      <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="size-8 p-0" aria-label={t("views")} title={t("views")}><Ellipsis className="size-4" aria-hidden /></Button></PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1"><nav aria-label={t("views")} className="flex flex-col">{links.map(link => <Link key={link.value} prefetch={false} href={link.href} className={buttonVariants({ variant: "ghost", size: "sm", className: "justify-start" })}>{link.label}</Link>)}</nav></PopoverContent>
      </Popover>
    : null} />;
}
