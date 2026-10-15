import { getNow, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getMyPerms, requireAnyPerm } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { studentStageRowSchema, studentStageRpc } from '../student-stage-data';
import { getOrganizationTimezoneV2 } from '../organization-locations';
import { listSchoolSupportOwners } from '../school-collaboration-data';
import { listLeadPool } from '../leads';
import { listInvitationOptions } from '../invitations';
import { InvitationCoordinationWorkbench } from '../InvitationCoordinationWorkbench';
import { CommunicationWorkSelectionProvider } from '../CommunicationWorkSelection';
import { parseWorkQuery, href } from './contract';
import { showsMultiplePeriods } from './period-selection';
import { Workspace } from './Workspace';
import { loadWorklistPage } from './data';
import { WorklistSelectionProvider } from './Selection';
import { DashboardRevisitFreshness } from '../dashboard-page/DashboardRevisitFreshness';
import { newId } from '@/lib/uuid';

export default async function SourceWorklistPage({ params, searchParams, firstContact = false }: {
  params: Promise<{ locale: string }>; searchParams: Promise<Record<string,string | string[] | undefined>>; firstContact?: boolean;
}) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ['followup.view']);
  const permissions = await getMyPerms(user.id);
  const query = parseWorkQuery(raw, permissions.has('student.view.all'), firstContact);
  const client = await createClient();
  let subjects = query.students ? query.students.split(',').map(id => 'student:' + id) : null;
  if (query.lead) {
    const focused = studentStageRowSchema.parse(await studentStageRpc(client, 'read_student_record_subject', { p_student_id: null, p_lead_id: query.lead }));
    if (focused.stage === 'awaiting_renewal') {
      redirect({ href: '/dashboard/classes', locale });
      return null;
    }
    if (firstContact !== (focused.stage === 'awaiting_first_contact')) redirect({ href: href(query, { stage: focused.stage, group: '', period: 'all', page: 1 }), locale });
    query.stage = focused.stage;
    query.scope = 'all'; query.group = 'all'; query.period = 'all'; query.marker = ''; query.q = ''; query.fields = ''; query.batch = ''; query.page = 1;
    subjects = [focused.key];
  } else if (!firstContact && (raw.stage === 'awaiting_first_contact' || raw.task === 'first_contact')) {
    redirect({ href: href(query, { stage: 'awaiting_first_contact' }), locale });
  } else if (!firstContact && raw.stage === 'awaiting_renewal') {
    redirect({ href: '/dashboard/classes', locale });
  }
  const canAssign = permissions.has('student.assign');
  const [page, timeZone, now, assignees] = await Promise.all([
    loadWorklistPage(client, query, locale, user.id, { subjects }), getOrganizationTimezoneV2(), getNow(),
    canAssign ? listSchoolSupportOwners() : Promise.resolve([]),
  ]);
  query.scope = page.scope;
  let firstContactContent;
  if (firstContact) {
    const leadIds = page.rows.flatMap(row => row.leadId ? [row.leadId] : []);
    const [{ leads }, options] = await Promise.all([
      leadIds.length ? listLeadPool(user.id, { scope: 'all', page: 1, pageSize: query.pageSize }, leadIds) : Promise.resolve({ leads: [] }),
      listInvitationOptions(),
    ]);
    const sessionKey = 'leads-first-contact:' + JSON.stringify(query);
    const currentLeads = leads.map(lead => {
      const current = page.rows.find(row => row.leadId === lead.id);
      return current ? { ...lead, provisionalStudentName: current.name, phone: current.phone, gradeHint: current.grade, gradeText: current.gradeText } : lead;
    });
    firstContactContent = <CommunicationWorkSelectionProvider key={sessionKey}>
      <InvitationCoordinationWorkbench firstContactOnly sessionKey={sessionKey} rows={[]} contactLeads={currentLeads} leadDetails={currentLeads}
        firstContactRows={page.rows}
        sourceLayout={{ rows: page.rows, allMonths: showsMultiplePeriods(page.period), query, fieldView: page.fieldView }}
        historicalFirstContacts={page.rows.flatMap(row => !row.leadId && row.studentId ? [{ studentId: row.studentId, name: row.name, phone: row.phone, grade: row.grade, context: row.note }] : [])}
        rowOrder={page.rows.map(row => row.leadId ? 'lead:' + row.leadId : 'student:' + row.studentId)}
        activities={options.activities} assessors={options.assessors} locale={locale} currentUserId={user.id}
        canAssign={canAssign} assignees={assignees}
        canManageInvitation={permissions.has('followup.write')} canContact={permissions.has('followup.write')}
        canManageIdentity={permissions.has('followup.write') && permissions.has('student.edit')} timeZone={timeZone} now={now.getTime()} />
    </CommunicationWorkSelectionProvider>;
  }
  return <WorklistSelectionProvider key={JSON.stringify(query)}><DashboardRevisitFreshness renderId={newId()} /><Workspace data={page} query={{ ...query, page: page.page, periodField: page.periodField, period: page.period, group: page.group }} locale={locale}
    currentUserId={user.id} canEnroll={permissions.has('enrollment.manage')}
    canAssess={permissions.has('review.write')} firstContactContent={firstContactContent}
    canAssign={canAssign} canImport={permissions.has('student.import')} assignees={assignees}
    timeZone={timeZone} now={now.getTime()} /></WorklistSelectionProvider>;
}
