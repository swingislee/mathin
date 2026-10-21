import { Suspense } from "react";
import { getNow, setRequestLocale } from "next-intl/server";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { DashboardPage } from "../dashboard-page";
import { listSchoolTerms } from "../courses";
import { getOrganizationTimezoneV2 } from "../organization-locations";
import { workEntryMessages, type WorkEntryQuery } from "../work-entry-contract";
import { ClassRosterWorkspace } from "../ClassRosterWorkspace";
import { TEACHING_WORKBENCH_PERMISSIONS } from "./teaching-workbench-access";
import { getTeachingProgressMatrix } from "./teaching-progress-matrix-read";
import { teachingMatrixMessages } from "./teaching-progress-matrix-contract";
import { TeachingProgressMatrix } from "../ClassViewClients";

export default async function TeachingProgressPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<WorkEntryQuery>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<DashboardPage title={workEntryMessages(locale).classes}><p role="status" className="py-8 text-sm text-muted">{teachingMatrixMessages(locale).title}…</p></DashboardPage>}>
    <ProgressContent locale={locale} searchParams={searchParams} />
  </Suspense>;
}

async function ProgressContent({ locale, searchParams }: { locale: string; searchParams: Promise<WorkEntryQuery> }) {
  const user = await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const [query, permissions, terms, timeZone, now] = await Promise.all([searchParams, getMyPerms(user.id), listSchoolTerms(), getOrganizationTimezoneV2(), getNow()]);
  const requestedTerm = typeof query.term === "string" ? query.term : undefined;
  const termId = requestedTerm === "all" ? undefined : terms.find(term => term.id === requestedTerm)?.id ?? terms.find(term => term.isCurrent)?.id;
  let data;
  try { data = await getTeachingProgressMatrix({ userId: user.id, canViewTeam: permissions.has("class.view.all"), canReadCommunication: permissions.has("followup.view"), termId, now: now.getTime(), offeringType: "long_term_formal" }); }
  catch {
    return <ClassRosterWorkspace view="progress" query={query} canTeach>
      <p role="alert" className="py-6 text-sm text-muted">{teachingMatrixMessages(locale).failed}</p>
    </ClassRosterWorkspace>;
  }
  return <TeachingProgressMatrix key={`${termId ?? "all"}:${query.teacher ?? ""}`} data={data} terms={terms} termId={termId} query={query} locale={locale} timeZone={timeZone} now={now.getTime()} />;
}
