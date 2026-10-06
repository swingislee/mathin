import { getNow, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { getMyPerms, requireAnyPerm } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { studentStageRowSchema, studentStageRpc } from '../student-stage-data';
import { getOrganizationTimezoneV2 } from '../organization-locations';
import { listStaffMembers } from '../staff';
import { markerSchema, placementSchema, parseWorkQuery, PERIOD_FIELDS } from './contract';
import { Workspace } from './Workspace';

const pageSchema = z.object({ rows: z.array(studentStageRowSchema.extend({ worklist: placementSchema })),
  count: z.number(), page: z.number(), pageSize: z.union([z.literal(20),z.literal(50),z.literal(100)]), totalPages: z.number(),
  periodField: z.union([z.enum(PERIOD_FIELDS),z.literal('')]), period: z.string(), group: z.string(), periods: z.array(z.object({ key: z.string(), count: z.number() })),
  groups: z.array(z.object({ key: z.string(), count: z.number(), subgroups: z.array(z.object({ key: z.string(), count: z.number() })) })), markers: z.array(markerSchema.extend({ count: z.number() })),
  counts: z.object({ first_contact: z.number(), followup: z.number(), assessment: z.number(), service: z.number() }) });

export default async function SourceWorklistPage({ params, searchParams }: {
  params: Promise<{ locale: string }>; searchParams: Promise<Record<string,string | string[] | undefined>>;
}) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ['followup.view']);
  const permissions = await getMyPerms(user.id);
  const query = parseWorkQuery(raw, permissions.has('student.view.all'));
  const client = await createClient();
  const canAssign = permissions.has('student.assign');
  const [data, timeZone, now, staff] = await Promise.all([
    studentStageRpc(client, 'school_source_worklist_page_v2', { p_task: query.task, p_scope: query.scope, p_search: query.q,
      p_group: query.group, p_marker: query.marker, p_page: query.page, p_page_size: query.pageSize,
      p_period_field: query.periodField, p_period: query.period }), getOrganizationTimezoneV2(), getNow(),
    canAssign ? listStaffMembers() : Promise.resolve([]),
  ]);
  const page = pageSchema.parse(data);
  return <Workspace key={JSON.stringify(query)} data={page} query={{ ...query, page: page.page, periodField: page.periodField, period: page.period, group: page.group }} locale={locale}
    currentUserId={user.id} canEnroll={permissions.has('enrollment.manage')} canViewAll={permissions.has('student.view.all')}
    canAssess={permissions.has('review.write')}
    canAssign={canAssign} assignees={staff.filter(member => member.isActive && member.canFollowUp).map(({ userId, displayName }) => ({ userId, displayName }))}
    timeZone={timeZone} now={now.getTime()} />;
}
