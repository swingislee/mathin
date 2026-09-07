import { getNow, getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { DashboardCommandState, DashboardPage } from "@/features/school/dashboard-page";
import { FollowupCommandPanel } from "@/features/school/FollowupCommandPanel";
import { FollowupTabs } from "@/features/school/FollowupTabs";
import { FollowupQueryMemory } from "@/features/school/FollowupQueryMemory";
import { InvitationCoordinationWorkbench } from "@/features/school/InvitationCoordinationWorkbench";
import { loadCommunicationWorkbench } from "@/features/school/communication-workbench-data";
import { communicationToday, parseCommunicationWorkQuery } from "@/features/school/communication-work-query";
import { CommunicationWorkToolbar } from "@/features/school/CommunicationWorkToolbar";
import { CommunicationWorkSelectionProvider } from "@/features/school/CommunicationWorkSelection";
import { listInvitationOptions } from "@/features/school/invitations";
import { parseLeadPoolFilters } from "@/features/school/leads";
import { LeadPoolPagination } from "@/features/school/LeadPoolPagination";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { businessRecordStateFilter } from '@/features/school/business-record-state-contract';
import { BusinessRecordStateQueryFilter } from '@/features/school/BusinessRecordStateQueryFilter';
import { communicationTableFields } from "@/features/school/communication-table-fields";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";

export default async function CommunicationPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ["followup.view", "review.write"]);
  const permissions = await getMyPerms(user.id);
  const parsedFocus = z.string().uuid().safeParse(raw.lead);
  const focusLeadId = parsedFocus.success ? parsedFocus.data : undefined;
  const today = communicationToday();
  const workOptions = parseCommunicationWorkQuery(raw, today, Boolean(focusLeadId));
  const { date } = workOptions;
  const filters = parseLeadPoolFilters({ ...raw, scope: raw.scope === "all" ? "all" : "mine", status: undefined, assignment: undefined }, permissions.has("student.view.all"));
  const recordState=businessRecordStateFilter(raw.state);
  const [workspaceT, t, leadT, enrollmentT, tableT, workT, timeZone, now] = await Promise.all([
    getTranslations("school.followupWorkspace"), getTranslations("school.invitations"), getTranslations("school.leads"),
    getTranslations("school.enrollmentWorkflow"), getTranslations("school.table"), getTranslations("school.communicationWorkday"), getOrganizationTimezoneV2(), getNow(),
  ]);
  const [data, options] = await Promise.all([
    loadCommunicationWorkbench(user.id, filters, permissions.has("followup.view"), focusLeadId, workOptions, {
      rawQuery: raw.fields, context: { locale, timeZone, now: now.getTime() },
      createFields: (leads, workday) => communicationTableFields({ locale, t, leadT, enrollmentT, tableT, workT, leads, workday, recordsMode: workOptions.view === "records" }),
    }), listInvitationOptions(),
  ]);
  const fieldQuery = JSON.stringify(data.fieldView?.query);
  const sessionKey = [workOptions.view, date, workOptions.worklistId ?? "", filters.scope, filters.q ?? "", data.page, data.pageSize, focusLeadId ?? "", recordState].join(":");
  const actionableKeys = new Set([
    ...data.contactLeads.filter((row) => row.ownerId && row.status !== "invalid" && row.status !== "converted").map((row) => `lead:${row.id}`),
    ...data.invitations.filter((row) => row.state !== "completed" && row.state !== "cancelled").map((row) => `lead:${row.leadId}`),
    ...data.postActivityRows.filter((row) => row.eligible && !row.enrollmentId && row.route !== "closed").map((row) => `post:${row.registrationId}`),
  ]);
  return <CommunicationWorkSelectionProvider key={sessionKey}><FollowupQueryMemory keys={["scope", "pageSize", "fields"]} /><DashboardPage title={workspaceT("communication")} density="compact" bodyClassName="gap-1.5" commandPanel={<FollowupCommandPanel>
    <DashboardCommandState><FollowupTabs /></DashboardCommandState>
    <CommunicationWorkToolbar options={workOptions} scope={filters.scope} canViewAll={permissions.has("student.view.all")} canManage={permissions.has("followup.write")} worklist={data.worklist} worklists={data.worklists} pageKeys={data.rowOrder.filter((key) => actionableKeys.has(key))} count={data.count} today={today} query={focusLeadId ? "" : filters.q}
      secondaryFilters={<BusinessRecordStateQueryFilter presentation="followup" value={recordState} locale={locale} query={Object.fromEntries(Object.entries(raw).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))}/>} />
  </FollowupCommandPanel>} footer={<LeadPoolPagination currentPage={data.page} totalPages={Math.max(1, Math.ceil(data.count / data.pageSize))} totalCount={data.count} pageSize={data.pageSize} scope={focusLeadId ? "all" : filters.scope} q={focusLeadId ? undefined : filters.q} focusLeadId={focusLeadId} baseHref="/dashboard/followups/communication" extraQuery={{ view: workOptions.view, date, state: recordState, ...(fieldQuery ? { fields: fieldQuery } : {}), ...(workOptions.worklistId ? { worklist: workOptions.worklistId } : {}) }} />}>
    <InvitationCoordinationWorkbench fieldView={data.fieldView} timeZone={timeZone} now={now.getTime()} sessionKey={sessionKey} workMode={workOptions.view} workday={data.workday} worklist={data.worklist ?? undefined} selectionEnabled={permissions.has("followup.write") && workOptions.view !== "worklist"} rows={data.invitations} contactLeads={data.contactLeads} leadDetails={data.leadDetails} rowOrder={data.rowOrder} invitationHistory={data.invitationHistory} focusLeadId={focusLeadId} activities={options.activities} assessors={options.assessors} locale={locale} currentUserId={user.id} canManageInvitation={permissions.has("followup.write")} canContact={permissions.has("followup.write")} canManageIdentity={permissions.has("followup.write") && permissions.has("student.edit")} postActivityRows={data.postActivityRows} />
  </DashboardPage></CommunicationWorkSelectionProvider>;
}
