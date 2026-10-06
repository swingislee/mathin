import { getNow, setRequestLocale } from "next-intl/server";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DashboardCommandActions, DashboardCommandFilters, DashboardCommandPanel, DashboardPage } from "../dashboard-page";
import { selectClass } from "../controls";
import { getOrganizationTimezoneV2 } from "../organization-locations";
import { listShortCourses } from "./data";
import { shortCourseFilters, shortCourseListHref, SHORT_COURSES_HREF } from "./contract";
import { shortCourseMessages } from "./messages";
import { ShortCourseMatrix } from "./ShortCourseMatrix";

export default async function ShortCoursesPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const { user } = await requireDashboardEnvironment(locale, ["staff"]);
  const filters = shortCourseFilters(query), m = shortCourseMessages(locale);
  const [data, permissions, timeZone, now] = await Promise.all([listShortCourses(filters), getMyPerms(user.id), getOrganizationTimezoneV2(), getNow()]);
  return <DashboardPage title={m.title} meta={m.total(data.total)} commandPanel={<DashboardCommandPanel>
    <DashboardCommandFilters><form className="flex flex-wrap items-center gap-2" method="get">
      <Input name="q" aria-label={m.search} placeholder={m.search} defaultValue={filters.q} maxLength={80} className="w-56" />
      <select name="batch" aria-label={m.batch} defaultValue={filters.batchId} className={selectClass}><option value="">{m.allBatches}</option>{data.batches.map(batch => <option key={batch.id} value={batch.id}>{batch.topic} · {batch.name}</option>)}</select>
      <select name="status" aria-label={m.status} defaultValue={filters.status} className={selectClass}><option value="">{m.allStates}</option>{(["planning", "active", "completed"] as const).map(status => <option key={status} value={status}>{m[status]}</option>)}</select>
      <Button type="submit" size="sm" variant="secondary">{m.filter}</Button>
      {(filters.q || filters.batchId || filters.status) && <Link href={SHORT_COURSES_HREF} className={buttonVariants({ size: "sm", variant: "ghost" })}>{m.clear}</Link>}
    </form></DashboardCommandFilters>
    {permissions.has("class.create") && <DashboardCommandActions><Link href={`${SHORT_COURSES_HREF}/new`} className={buttonVariants({ size: "sm" })}>{m.newBatch}</Link></DashboardCommandActions>}
  </DashboardCommandPanel>}>
    <ShortCourseMatrix rows={data.classes} total={data.total} filters={filters} locale={locale} timeZone={timeZone} now={now.getTime()} returnTo={shortCourseListHref(filters)} />
  </DashboardPage>;
}
