import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { listClassrooms, parseClassroomFilters } from "@/features/school/classes";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function ClassesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["class.view.all", "class.view.mine"]);
  const [t, perms] = await Promise.all([getTranslations("school.classes"), getMyPerms(user.id)]);
  const filters = parseClassroomFilters(rawSearchParams);
  const { classrooms, count } = await listClassrooms(filters);
  const maxPage = count ? Math.max(1, Math.ceil(count / 20)) : filters.page;

  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (page > 1) query.set("page", String(page));
    const qs = query.toString();
    return `/dashboard/classes${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader
        title={t("title")}
        actions={
          perms.has("class.create") && (
            <Link href="/dashboard/classes/new" className={cn(buttonVariants({ size: "sm" }))}>
              {t("newClass")}
            </Link>
          )
        }
      >
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>

      <form className="mt-6 flex gap-3 rounded-xl border border-line bg-card p-4">
        <Input
          name="q"
          defaultValue={filters.q}
          placeholder={t("search")}
          className="min-w-0 flex-1"
        />
        <button className={cn(buttonVariants({ size: "sm" }), "h-10")} type="submit">{t("filter")}</button>
        <Link href="/dashboard/classes" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-10")}>{t("reset")}</Link>
      </form>

      {classrooms.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
          <Table className="w-full border-collapse text-left text-sm">
            <TableHeader className="border-b border-line text-xs text-muted">
              <TableRow>
                <TableHead className="px-4 py-3 font-medium">{t("name")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("course")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("size")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("sessionCount")}</TableHead>
                <TableHead className="px-4 py-3 font-medium">{t("status")}</TableHead>
                <TableHead className="px-4 py-3 font-medium"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {classrooms.map((classroom) => (
                <TableRow key={classroom.id}>
                  <TableCell className="px-4 py-3 font-medium">{classroom.name}</TableCell>
                  <TableCell className="px-4 py-3 text-muted">{classroom.courseTitle ?? t("freeClass")}</TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">{classroom.activeCount}{classroom.capacity ? ` / ${classroom.capacity}` : ""}</TableCell>
                  <TableCell className="px-4 py-3 tabular-nums">{classroom.sessionCount}</TableCell>
                  <TableCell className="px-4 py-3">{classroom.archivedAt ? t("archived") : t("active")}</TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <Link href={`/dashboard/classes/${classroom.id}`} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
                      {t("open")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        {filters.page > 1 && <Link href={pageHref(filters.page - 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("previous")}</Link>}
        {filters.page < maxPage && <Link href={pageHref(filters.page + 1)} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>{t("next")}</Link>}
      </div>
    </div>
  );
}
