import { setRequestLocale } from "next-intl/server";
import { EnrollmentPlacementWorkbench } from "@/features/school/EnrollmentPlacementWorkbench";
import { loadEnrollmentPlacementBoard } from "@/features/school/enrollment-workflow-data";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { loadStudentBusinessHistory } from '@/features/school/student-business-history-data';
import { businessRecordStateFilter } from '@/features/school/business-record-state-contract';

export default async function CourseEnrollmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ term?: string; student?: string; q?:string; state?:string }>;
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
      history={await loadStudentBusinessHistory(locale,{kind:'enrollment'})}
      initialQuery={query.q?.slice(0,100)}
      initialRecordState={businessRecordStateFilter(query.state)}
      initialTermId={query.term}
      focusStudentId={query.student}
      canCreateClass={permissions.has("class.create")}
    />
  );
}
