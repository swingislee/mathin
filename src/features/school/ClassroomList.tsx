import { ArrowRight, CircleAlert, School, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardEmptyCard } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ClassroomListItem } from "./teaching-operations/classroom-queries";
import type { ClassroomScope } from "./teaching-operations/types";

const PRIMARY_ACTION_KEY: Record<ClassroomScope, string> = {
  teaching: "openTeaching",
  support: "openSupport",
  all: "openManagement",
  test: "openManagement",
};

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function courseLabel(classroom: ClassroomListItem, t: Translator) {
  return [classroom.courseFamilyTitle, classroom.courseTitle, classroom.courseProductCode].filter(Boolean).join(" · ") || t("freeClass");
}

function readinessLabel(classroom: ClassroomListItem, t: Translator) {
  if (classroom.anomalyCount > 0) return t("anomalyCount", { count: classroom.anomalyCount });
  return t(classroom.readiness === "incomplete" ? "readinessIssue" : "readinessComplete");
}

function ClassroomBadges({ classroom, t }: { classroom: ClassroomListItem; t: Translator }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge variant={classroom.operationalStatus === "active" ? "secondary" : "outline"}>
        {t(classroom.operationalStatus === "active" ? "operationalActive" : classroom.operationalStatus)}
      </Badge>
      <Badge variant="outline">{t(`offering_${classroom.offeringType}`)}</Badge>
      {classroom.purpose === "test" ? <Badge variant="outline">{t("test")}</Badge> : null}
    </span>
  );
}

function PersonalClassroomCards({
  classrooms,
  scope,
  t,
  formatSession,
}: {
  classrooms: ClassroomListItem[];
  scope: ClassroomScope;
  t: Translator;
  formatSession: (value: string) => string;
}) {
  return (
    <div className="grid gap-4 @4xl/page:grid-cols-2">
      {classrooms.map((classroom) => (
        <article key={classroom.id} className="flex min-w-0 flex-col rounded-2xl border border-line bg-card p-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-moon/30 text-crater" aria-hidden>
              <School className="size-5" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg text-ink">{classroom.name}</h2>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{courseLabel(classroom, t)}</p>
                </div>
                <ClassroomBadges classroom={classroom} t={t} />
              </div>
              <p className="mt-3 text-sm text-muted">
                {classroom.primaryTeacherName ?? t("noPrimaryTeacher")}
                {classroom.learningSupportNames.length > 0 && ` · ${t("learningSupport")}: ${classroom.learningSupportNames.join("、")}`}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-3 divide-x divide-line border-y border-line py-3 text-xs">
            <div className="px-3 first:pl-0">
              <dt className="flex items-center gap-1 text-muted"><Users className="size-3.5" />{t("size")}</dt>
              <dd className="mt-1 font-medium text-ink">{classroom.enrolledCount}{classroom.capacity ? ` / ${classroom.capacity}` : ""}</dd>
            </div>
            <div className="px-3">
              <dt className="text-muted">{t("sessionProgress")}</dt>
              <dd className="mt-1 font-medium text-ink">{classroom.sessionDoneCount}/{classroom.sessionTotalCount}</dd>
            </div>
            <div className="px-3 pr-0">
              <dt className="text-muted">{t("nextSession")}</dt>
              <dd className="mt-1 truncate font-medium text-ink">{classroom.nextSessionAt ? formatSession(classroom.nextSessionAt) : t("notApplicable")}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className={cn("flex items-center gap-1 text-xs", classroom.anomalyCount > 0 || classroom.readiness === "incomplete" ? "text-rose" : "text-leaf-deep")}>
              <CircleAlert className="size-3.5" />
              {readinessLabel(classroom, t)}
            </p>
            <Link href={`/dashboard/classes/${classroom.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0")}>
              {t(PRIMARY_ACTION_KEY[scope])}<ArrowRight className="size-4" />
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

function AllClassroomsTable({
  classrooms,
  scope,
  t,
  formatSession,
}: {
  classrooms: ClassroomListItem[];
  scope: ClassroomScope;
  t: Translator;
  formatSession: (value: string) => string;
}) {
  return (
    <div data-classroom-table="all" className="overflow-hidden rounded-2xl border border-line bg-card">
      <Table className="w-full min-w-[72rem] text-left text-sm">
        <TableHeader className="border-b border-line text-xs text-muted">
          <TableRow>
            <TableHead>{t("title")}</TableHead>
            <TableHead>{t("courseColumn")}</TableHead>
            <TableHead>{t("teachingTeam")}</TableHead>
            <TableHead>{t("size")}</TableHead>
            <TableHead>{t("sessionProgress")}</TableHead>
            <TableHead>{t("nextSession")}</TableHead>
            <TableHead>{t("statusColumn")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-line">
          {classrooms.map((classroom) => (
            <TableRow key={classroom.id}>
              <TableCell>
                <Link href={`/dashboard/classes/${classroom.id}`} className="font-medium text-ink hover:underline">{classroom.name}</Link>
                <div className="mt-1"><ClassroomBadges classroom={classroom} t={t} /></div>
              </TableCell>
              <TableCell className="max-w-72 text-muted"><p className="line-clamp-2">{courseLabel(classroom, t)}</p></TableCell>
              <TableCell className="text-muted">
                <p>{classroom.primaryTeacherName ?? t("noPrimaryTeacher")}</p>
                {classroom.learningSupportNames.length > 0 ? <p className="mt-1 text-xs">{t("learningSupport")}: {classroom.learningSupportNames.join("、")}</p> : null}
              </TableCell>
              <TableCell className="tabular-nums">{classroom.enrolledCount}{classroom.capacity ? ` / ${classroom.capacity}` : ""}</TableCell>
              <TableCell className="tabular-nums">{classroom.sessionDoneCount}/{classroom.sessionTotalCount}</TableCell>
              <TableCell className="whitespace-nowrap text-muted">{classroom.nextSessionAt ? formatSession(classroom.nextSessionAt) : t("notApplicable")}</TableCell>
              <TableCell>
                <span className={cn("inline-flex items-center gap-1 text-xs", classroom.anomalyCount > 0 || classroom.readiness === "incomplete" ? "text-rose" : "text-leaf-deep")}>
                  <CircleAlert className="size-3.5" />{readinessLabel(classroom, t)}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Link href={`/dashboard/classes/${classroom.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink hover:underline">
                  {t(PRIMARY_ACTION_KEY[scope])}<ArrowRight className="size-4" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export async function ClassroomList({
  classrooms,
  totalCount,
  scope,
  hasFilters,
  resetHref,
  locale,
  timeZone,
}: {
  classrooms: ClassroomListItem[];
  totalCount: number;
  scope: ClassroomScope;
  hasFilters: boolean;
  resetHref: string;
  locale: string;
  timeZone: string;
}) {
  const t = await getTranslations("school.classes");
  if (classrooms.length === 0) {
    return (
      <DashboardEmptyCard
        action={hasFilters ? <Link href={resetHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("clearFilters")}</Link> : undefined}
      >
        {t("empty")}
      </DashboardEmptyCard>
    );
  }

  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  const formatSession = (value: string) => dateTime.format(new Date(value));
  const list = scope === "all"
    ? <AllClassroomsTable classrooms={classrooms} scope={scope} t={t} formatSession={formatSession} />
    : <PersonalClassroomCards classrooms={classrooms} scope={scope} t={t} formatSession={formatSession} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("results", { count: totalCount })}</p>
      {list}
    </div>
  );
}
