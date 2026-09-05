import { setRequestLocale } from "next-intl/server";
import { EnrollmentPlacementWorkbench } from "@/features/school/EnrollmentPlacementWorkbench";
import { loadEnrollmentPlacementBoard } from "@/features/school/enrollment-workflow-data";
import { getMyPerms, requirePerm } from "@/lib/auth";

export default async function CourseEnrollmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ term?: string; student?: string }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requirePerm(locale, "enrollment.manage");
  const [board, permissions] = await Promise.all([
    loadEnrollmentPlacementBoard(),
    getMyPerms(user.id),
  ]);

  return (
    <EnrollmentPlacementWorkbench
      initialBoard={board}
      initialTermId={query.term}
      focusStudentId={query.student}
      canCreateClass={permissions.has("class.create")}
    />
  );
}
