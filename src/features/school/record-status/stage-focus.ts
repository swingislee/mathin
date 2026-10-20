import type { StudentStageRow } from '../student-stage-contract';
import { studentStageMessages } from '../student-stage-messages';
import { resolveStatusEvidence, storedStatusValue, type StatusFacet } from './contract';
import type { RecordTone } from './tones';

const FACETS: Record<StudentStageRow['stage'], readonly StatusFacet[]> = {
  awaiting_first_contact: ['wechat','interest','visit'],
  awaiting_assessment: ['wechat','interest','visit'],
  awaiting_enrollment: ['assessment','wechat','interest'],
  awaiting_renewal: [],
  former_student: [],
};

export type ProgressGlyph = 'calendar' | 'calendarCheck' | 'calendarX' | 'teacher' | 'parent' | 'activity'
  | 'assessment' | 'message' | 'hourglass' | 'payment' | 'check' | 'pause' | 'class' | 'book'
  | 'phoneMissed' | 'phoneCallback' | 'phone' | 'phoneOff';
export interface StageProgressTag { key: string; label: string; glyph: ProgressGlyph; tone: RecordTone; context: string[] }
const DETAIL_MARKS: Record<string, [ProgressGlyph, RecordTone]> = {
  not_booked: ['calendar','neutral'], coordinating: ['calendar','progress'], booked: ['calendarCheck','agreed'],
  no_show: ['calendarX','negative'], cancelled: ['calendarX','review'], in_progress: ['assessment','progress'],
  attended_without_result: ['assessment','review'], assessed: ['assessment','positive'], awaiting_reply: ['message','progress'],
  considering: ['hourglass','progress'], ready_to_enroll: ['check','agreed'], payment_pending: ['payment','review'],
  not_enrolling: ['pause','negative'], nurturing: ['message','neutral'], awaiting_class: ['class','progress'], attending: ['book','positive'],
  renewal_considering: ['hourglass','progress'], renewal_committed: ['check','agreed'], renewal_confirmed: ['check','positive'],
  not_renewing: ['pause','negative'], withdrawn: ['pause','negative'], ended: ['book','neutral'],
  following: ['message','progress'], declined: ['pause','neutral'], promised: ['calendarCheck','agreed'],
  visited_untested: ['activity','positive'], assessed_no_band: ['assessment','progress'], prepaid_next: ['check','positive'],
  // 首联只画联系结果；尚未联系不画图标。
  unreachable: ['phoneMissed','progress'], callback: ['phoneCallback','progress'], attempted: ['phone','review'], invalid_number: ['phoneOff','negative'],
};

export function statusTone(facet: StatusFacet, value: string, review: boolean): RecordTone | null {
  if (review) return 'review';
  if (value === 'unknown') return null;
  if (['no', 'not_promised', 'C', 'x_plus', 'below_a'].includes(value)) return 'negative';
  if (value === 'B' || value === 'g_plus') return 'progress';
  if (facet === 'visit' && value === 'promised') return 'agreed';
  return 'positive';
}

/** 当前阶段的关注项以阶段表为准，与小状态同源：微信、意向、到访在阶段表没有记录时再看证据；
 *  测评等级只看阶段表（备注推断的等级只在依据里列出），没有等级即资料待补齐。tone 为空表示尚未记录。 */
export function recordStatusFacets(row: StudentStageRow) {
  if (row.statusSummary && !row.statusEvidence) {
    return row.statusSummary.facets.map(({ facet, ...summary }) => ({
      facet, status: { ...summary, facts: [], best: undefined },
      tone: statusTone(facet, summary.value, summary.review),
    }));
  }
  return FACETS[row.stage].flatMap(facet => {
    const evidence = resolveStatusEvidence(row.statusEvidence ?? [],facet), stored = storedStatusValue(row.lifecycle,facet);
    const status = stored ? { ...evidence, value: stored, review: false, stored: true }
      : facet === 'assessment' && row.lifecycle ? { ...evidence, value: 'unknown', review: false, stored: false } : { ...evidence, stored: false };
    // 首联只额外展示已有的诺访／到访事实。
    if (row.stage === 'awaiting_first_contact' && facet === 'visit' && !status.review && !['promised','arrived'].includes(status.value)) return [];
    return [{ facet, status, tone: statusTone(facet,status.value,status.review) }];
  });
}

/** 主阶段决定关注范围；中间状态来自已保存的邀约、测评、报名与课程关系。 */
export function recordStageFocus(row: StudentStageRow, locale: string): { facets: readonly StatusFacet[]; progress: StageProgressTag | null } {
  const facets = FACETS[row.stage];
  const en = locale.startsWith('en'), messages = studentStageMessages(locale);
  // 首联的联系结果用图标表示，原文在“最近备注”里，不再另写一遍文字标签。
  if (row.stage === 'awaiting_first_contact') {
    const mark = DETAIL_MARKS[row.detail], label = messages.details[row.detail];
    const count = row.communication?.count ?? 0;
    return { facets, progress: mark && label ? { key: row.detail, label, glyph: mark[0], tone: mark[1],
      context: [count ? (en ? `${count} contact record(s); the latest note is shown in the list.` : `共 ${count} 条联系记录，最近一次的原文见名单“最近备注”。`) : ''].filter(Boolean) } : null };
  }
  let key = row.detail, label = messages.details[key];
  let mark = DETAIL_MARKS[key];
  const invitation = row.stage === 'awaiting_assessment' ? row.invitation : null;
  const invitationLabels = en ? {
    coordinating_time: 'Coordinating time', awaiting_teacher: 'Awaiting teacher confirmation', awaiting_parent: 'Awaiting parent confirmation',
    waiting_activity: 'Waiting for a suitable activity', confirmed: invitation?.kind === 'activity' ? 'Activity booked' : 'Assessment booked',
  } : {
    coordinating_time: '协调时间中', awaiting_teacher: '待老师确认', awaiting_parent: '待家长确认',
    waiting_activity: '等待合适活动', confirmed: invitation?.kind === 'activity' ? '活动已约' : '已约待测',
  };
  const invitationMarks: Record<string, [ProgressGlyph, RecordTone]> = {
    coordinating_time: ['calendar','progress'], awaiting_teacher: ['teacher','progress'], awaiting_parent: ['parent','progress'],
    waiting_activity: ['activity','neutral'], confirmed: ['calendarCheck','agreed'],
  };
  if (invitation && invitation.state in invitationMarks && !['no_show','visited_untested'].includes(row.detail)) {
    key = invitation.state;
    label = invitationLabels[key as keyof typeof invitationLabels];
    mark = invitationMarks[key];
  }
  const context = row.stage === 'awaiting_assessment'
    ? [invitation ? (en ? 'Current invitation' : '当前邀约') : (en ? 'Current assessment progress' : '当前测评进展'), invitation?.locationText ?? '', row.sourceArrangement ?? '']
    : [row.stage === 'awaiting_enrollment' ? (en ? 'Enrollment follow-up' : '报名跟进') : (en ? 'Course / renewal record' : '课程／续班记录'), row.courseTitle, row.termName];
  return { facets, progress: mark && label ? { key, label, glyph: mark[0], tone: mark[1], context: context.filter(Boolean) } : null };
}
