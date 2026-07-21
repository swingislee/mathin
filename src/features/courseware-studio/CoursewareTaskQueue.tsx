import { Clock3, ExternalLink, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  COURSEWARE_TASK_TABS,
  loadCoursewareTaskQueue,
  type CoursewareTaskItem,
  type CoursewareTaskTab,
} from "@/features/courseware-studio/data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Props = {
  locale: string;
  tab: CoursewareTaskTab;
  query: string;
};

function hrefFor(tab: CoursewareTaskTab, query: string) {
  const search = new URLSearchParams({ tab });
  if (query) search.set("q", query);
  return `/dashboard/courseware?${search.toString()}`;
}

function workbenchHref(item: CoursewareTaskItem) {
  return `/dashboard/curriculum/lectures/${item.lectureId}?track=${item.track}`;
}

export async function CoursewareTaskQueue({ locale, tab, query }: Props) {
  const [t, tasks] = await Promise.all([
    getTranslations("coursewareStudio"),
    loadCoursewareTaskQueue(tab, query),
  ]);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const tabLabels: Record<CoursewareTaskTab, string> = {
    incomplete: t("tabIncomplete"),
    recent: t("tabRecent"),
    publish: t("tabPublish"),
  };

  return (
    <section className="mt-6">
      <div className="rounded-2xl border border-line bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-ink">{t("taskQueueTitle")}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{t("taskQueueIntro")}</p>
          </div>
          <form className="flex w-full gap-2 sm:w-auto" method="get">
            <Input type="hidden" name="tab" value={tab} readOnly />
            <Input
              className="min-w-0 sm:w-72"
              defaultValue={query}
              name="q"
              placeholder={t("taskSearchPlaceholder")}
              aria-label={t("taskSearch")}
            />
            <Button type="submit" variant="secondary" size="sm"><Search className="size-4" />{t("taskSearch")}</Button>
          </form>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2" aria-label={t("taskQueueTitle")}>
          {COURSEWARE_TASK_TABS.map((item) => (
            <Link
              key={item}
              href={hrefFor(item, query)}
              aria-current={item === tab ? "page" : undefined}
              className={cn(
                buttonVariants({ variant: item === tab ? "primary" : "secondary", size: "sm" }),
                "rounded-full",
              )}
            >
              {tabLabels[item]}
            </Link>
          ))}
          <Link href="/dashboard/courseware/adapt" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "rounded-full")}>
            {t("tabAdapt")}
          </Link>
          <Link href="/dashboard/courseware/assets" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "rounded-full")}>
            {t("tabAssets")}
          </Link>
        </nav>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-line bg-card p-6 text-sm text-muted">{t("taskQueueEmpty")}</p>
      ) : (
        <>
          <div className="mt-5 hidden overflow-hidden rounded-2xl border border-line bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("taskFamilyVariant")}</TableHead>
                  <TableHead>{t("taskLecture")}</TableHead>
                  <TableHead>{t("taskTrack")}</TableHead>
                  <TableHead>{t("taskState")}</TableHead>
                  <TableHead>{t("taskLastEdited")}</TableHead>
                  <TableHead><span className="sr-only">{t("openWorkbench")}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((item) => (
                  <TaskRow key={`${item.lectureId}:${item.track}`} item={item} t={t} dateTime={dateTime} />
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-5 grid gap-3 md:hidden">
            {tasks.map((item) => (
              <article key={`${item.lectureId}:${item.track}`} className="rounded-2xl border border-line bg-card p-4">
                <p className="text-xs text-muted">{item.familyTitle}</p>
                <p className="mt-1 font-medium text-ink">{item.courseTitle} · {item.productCode ?? "—"}</p>
                <p className="mt-3 text-sm text-ink">{t("lectureTitle", { no: item.lectureNo, name: item.lectureName })}</p>
                <div className="mt-3 flex flex-wrap gap-2"><StateBadges item={item} t={t} /></div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><Clock3 className="size-3.5" />{lastEditedLabel(item, t, dateTime)}</p>
                <Link href={workbenchHref(item)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4 w-full")}>
                  {t("openWorkbench")}<ExternalLink className="size-4" />
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TaskRow({ item, t, dateTime }: { item: CoursewareTaskItem; t: Awaited<ReturnType<typeof getTranslations>>; dateTime: Intl.DateTimeFormat }) {
  return <TableRow>
    <TableCell>
      <p className="font-medium text-ink">{item.familyTitle}</p>
      <p className="mt-1 text-xs text-muted">{item.courseTitle} · {item.productCode ?? "—"}</p>
    </TableCell>
    <TableCell>{t("lectureTitle", { no: item.lectureNo, name: item.lectureName })}</TableCell>
    <TableCell><Badge variant="outline">{item.track === "adapted-4x3" ? t("trackAdapted") : t("trackNative")}</Badge></TableCell>
    <TableCell><StateBadges item={item} t={t} /></TableCell>
    <TableCell className="text-xs text-muted">{lastEditedLabel(item, t, dateTime)}</TableCell>
    <TableCell className="text-right"><Link href={workbenchHref(item)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("openWorkbench")}</Link></TableCell>
  </TableRow>;
}

function StateBadges({ item, t }: { item: CoursewareTaskItem; t: Awaited<ReturnType<typeof getTranslations>> }) {
  return <span className="flex flex-wrap gap-1.5">
    <Badge variant="outline">{t("pagesCount", { count: item.pageCount })}</Badge>
    {item.hasDraft && <Badge variant="secondary">{t("draftState")}</Badge>}
    {item.releaseNo === null ? <Badge variant="outline">{t("notReleased")}</Badge> : <Badge variant="secondary">{t("releaseNo", { no: item.releaseNo })}</Badge>}
  </span>;
}

function lastEditedLabel(item: CoursewareTaskItem, t: Awaited<ReturnType<typeof getTranslations>>, dateTime: Intl.DateTimeFormat) {
  if (!item.lastEditedAt) return t("notYetEdited");
  const when = dateTime.format(new Date(item.lastEditedAt));
  return item.lastEditorName ? t("editedByAt", { name: item.lastEditorName, time: when }) : when;
}
