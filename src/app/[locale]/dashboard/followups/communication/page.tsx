import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { DashboardCommandPanel, DashboardCommandState, DashboardPage } from "@/features/school/dashboard-page";
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
import { loadHistoricalFirstContactRows } from '@/features/school/historical-first-contact-data';
import { businessRecordStateFilter } from '@/features/school/business-record-state-contract';
import { BusinessRecordStateQueryFilter } from '@/features/school/BusinessRecordStateQueryFilter';

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
  const filters = parseLeadPoolFilters({ ...raw, scope: raw.scope === "all" ? "all" : "mine", pageSize: raw.pageSize ?? "20", status: undefined }, permissions.has("student.view.all"));
  const recordState=businessRecordStateFilter(raw.state);
  const historicalFirstContacts=recordState!=='current'&&!focusLeadId&&(workOptions.view==='all'||!!filters.q||recordState==='historical')?await loadHistoricalFirstContactRows(locale,filters.q):[];
  const [workspaceT, data, options] = await Promise.all([
    getTranslations("school.followupWorkspace"),
    loadCommunicationWorkbench(user.id, filters, permissions.has("followup.view"), focusLeadId, workOptions), listInvitationOptions(),
  ]);
  const sessionKey = [workOptions.view, date, workOptions.worklistId ?? "", filters.scope, filters.q ?? "", data.page, data.pageSize, focusLeadId ?? "", recordState].join(":");
  if(recordState==='historical'){
    data.invitations=[];data.contactLeads=[];data.leadDetails=[];data.postActivityRows=[];data.rowOrder=[];data.count=0;
  }
  const actionableKeys = new Set([
    ...data.contactLeads.filter((row) => row.ownerId && row.status !== "invalid" && row.status !== "converted").map((row) => `lead:${row.id}`),
    ...data.invitations.filter((row) => row.state !== "completed" && row.state !== "cancelled").map((row) => `lead:${row.leadId}`),
    ...data.postActivityRows.filter((row) => row.eligible && !row.enrollmentId && row.route !== "closed").map((row) => `post:${row.registrationId}`),
  ]);
  return <CommunicationWorkSelectionProvider key={sessionKey}><FollowupQueryMemory keys={["scope", "pageSize"]} /><DashboardPage title={workspaceT("communication")} commandPanel={<DashboardCommandPanel>
    <DashboardCommandState><FollowupTabs /><BusinessRecordStateQueryFilter value={recordState} locale={locale} query={Object.fromEntries(Object.entries(raw).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))}/></DashboardCommandState>
    <CommunicationWorkToolbar options={workOptions} scope={filters.scope} canViewAll={permissions.has("student.view.all")} canManage={permissions.has("followup.write")} workday={data.workday} worklist={data.worklist} worklists={data.worklists} pageKeys={data.rowOrder.filter((key) => actionableKeys.has(key))} count={data.count+historicalFirstContacts.length} today={today} query={focusLeadId ? "" : filters.q} />
  </DashboardCommandPanel>} footer={data.count > 0 ? <LeadPoolPagination currentPage={data.page} totalPages={Math.max(1, Math.ceil(data.count / data.pageSize))} totalCount={data.count} pageSize={data.pageSize} scope={focusLeadId ? "all" : filters.scope} q={focusLeadId ? undefined : filters.q} focusLeadId={focusLeadId} baseHref="/dashboard/followups/communication" extraQuery={{ view: workOptions.view, date, state: recordState, ...(workOptions.worklistId ? { worklist: workOptions.worklistId } : {}) }} /> : null}>
    <InvitationCoordinationWorkbench historicalFirstContacts={historicalFirstContacts} sessionKey={sessionKey} workMode={workOptions.view} workday={data.workday} worklist={data.worklist ?? undefined} selectionEnabled={permissions.has("followup.write") && workOptions.view !== "worklist"} rows={data.invitations} contactLeads={data.contactLeads} leadDetails={data.leadDetails} rowOrder={data.rowOrder} invitationHistory={data.invitationHistory} focusLeadId={focusLeadId} activities={options.activities} assessors={options.assessors} locale={locale} currentUserId={user.id} canManageInvitation={permissions.has("followup.write")} canContact={permissions.has("followup.write")} canManageIdentity={permissions.has("followup.write") && permissions.has("student.edit")} postActivityRows={data.postActivityRows} />
  </DashboardPage></CommunicationWorkSelectionProvider>;
}
