import { ArrowRight, CircleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardEmptyCard, DashboardTableShell } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ClassroomListItem } from "./teaching-operations/classroom-queries";
import { PersonalClassroomTable } from "./PersonalClassroomTable";
import { getClassroomWorkSessions } from "./classroom-workbench-read";
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
    <DashboardTableShell data-classroom-table="all">
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
        <TableBody>
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
    </DashboardTableShell>
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
    : <PersonalClassroomTable classrooms={classrooms} sessions={await getClassroomWorkSessions(classrooms.map(row => row.id))} locale={locale} timeZone={timeZone} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("results", { count: totalCount })}</p>
      {list}
    </div>
  );
}
