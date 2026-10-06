import { getNow, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import { getMyPerms, requireAnyPerm } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { studentStageRowSchema, studentStageRpc } from '../student-stage-data';
import { getOrganizationTimezoneV2 } from '../organization-locations';
import { listStaffMembers } from '../staff';
import { listLeadPool } from '../leads';
import { listInvitationOptions } from '../invitations';
import { InvitationCoordinationWorkbench } from '../InvitationCoordinationWorkbench';
import { CommunicationWorkSelectionProvider } from '../CommunicationWorkSelection';
import { markerSchema, placementSchema, parseWorkQuery, PERIOD_FIELDS, href } from './contract';
import { Workspace } from './Workspace';

const pageSchema = z.object({ rows: z.array(studentStageRowSchema.extend({ worklist: placementSchema })),
  count: z.number(), page: z.number(), pageSize: z.union([z.literal(20),z.literal(50),z.literal(100)]), totalPages: z.number(),
  periodField: z.union([z.enum(PERIOD_FIELDS),z.literal('')]), period: z.string(), group: z.string(), periods: z.array(z.object({ key: z.string(), count: z.number() })),
  groups: z.array(z.object({ key: z.string(), count: z.number(), subgroups: z.array(z.object({ key: z.string(), count: z.number() })) })), markers: z.array(markerSchema.extend({ count: z.number() })),
  counts: z.object({ awaiting_first_contact: z.number(), awaiting_assessment: z.number(), awaiting_enrollment: z.number(), awaiting_renewal: z.number(), former_student: z.number() }) });

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
    query.scope = 'all'; query.group = ''; query.period = 'all'; query.marker = ''; query.q = ''; query.page = 1;
    subjects = [focused.key];
  } else if (!firstContact && (raw.stage === 'awaiting_first_contact' || raw.task === 'first_contact')) {
    redirect({ href: href(query, { stage: 'awaiting_first_contact' }), locale });
  } else if (!firstContact && raw.stage === 'awaiting_renewal') {
    redirect({ href: '/dashboard/classes', locale });
  }
  const canAssign = permissions.has('student.assign');
  const [data, timeZone, now, staff] = await Promise.all([
    studentStageRpc(client, 'school_communication_page', { p_stage: query.stage, p_scope: query.scope, p_search: query.q,
      p_group: query.group, p_marker: query.marker, p_page: query.page, p_page_size: query.pageSize,
      p_period_field: query.periodField, p_period: query.period, p_subjects: subjects }), getOrganizationTimezoneV2(), getNow(),
    canAssign ? listStaffMembers() : Promise.resolve([]),
  ]);
  const page = pageSchema.parse(data);
  let firstContactContent;
  if (firstContact) {
    const leadIds = page.rows.flatMap(row => row.leadId ? [row.leadId] : []);
    const [{ leads }, options] = await Promise.all([
      leadIds.length ? listLeadPool(user.id, { scope: query.scope, page: 1, pageSize: query.pageSize }, leadIds) : Promise.resolve({ leads: [] }),
      listInvitationOptions(),
    ]);
    const sessionKey = 'leads-first-contact:' + JSON.stringify(query);
    firstContactContent = <CommunicationWorkSelectionProvider key={sessionKey}>
      <InvitationCoordinationWorkbench firstContactOnly sessionKey={sessionKey} rows={[]} contactLeads={leads} leadDetails={leads}
        firstContactRows={page.rows}
        historicalFirstContacts={page.rows.flatMap(row => !row.leadId && row.studentId ? [{ studentId: row.studentId, name: row.name, phone: row.phone, grade: row.grade, context: row.note }] : [])}
        rowOrder={page.rows.map(row => row.leadId ? 'lead:' + row.leadId : 'student:' + row.studentId)}
        activities={options.activities} assessors={options.assessors} locale={locale} currentUserId={user.id}
        canManageInvitation={permissions.has('followup.write')} canContact={permissions.has('followup.write')}
        canManageIdentity={permissions.has('followup.write') && permissions.has('student.edit')} timeZone={timeZone} now={now.getTime()} />
    </CommunicationWorkSelectionProvider>;
  }
  return <Workspace key={JSON.stringify(query)} data={page} query={{ ...query, page: page.page, periodField: page.periodField, period: page.period, group: page.group }} locale={locale}
    currentUserId={user.id} canEnroll={permissions.has('enrollment.manage')} canViewAll={permissions.has('student.view.all')}
    canAssess={permissions.has('review.write')} firstContactContent={firstContactContent}
    canAssign={canAssign} assignees={staff.filter(member => member.isActive && member.canFollowUp).map(({ userId, displayName }) => ({ userId, displayName }))}
    timeZone={timeZone} now={now.getTime()} />;
}
