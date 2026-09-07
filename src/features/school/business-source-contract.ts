/** 来源表达进入既有业务字段；无法唯一对应的值保留为备注。 */
export const CURRENT_ASSESSMENT_BANDS = ['x_plus', 'g_plus', 'a', 'a_plus', 's', 'c'] as const;
export type CurrentAssessmentBand = (typeof CURRENT_ASSESSMENT_BANDS)[number];

export function normalizeSourceAssessmentBand(value: unknown): CurrentAssessmentBand | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().replace(/\s+/g, '').replace(/＋/g, '+').toUpperCase();
  const values: Record<string, CurrentAssessmentBand> = {
    'X+': 'x_plus', X_PLUS: 'x_plus', 'G+': 'g_plus', G_PLUS: 'g_plus',
    A: 'a', 'A+': 'a_plus', A_PLUS: 'a_plus', S: 's', C: 'c',
  };
  return values[key] ?? null;
}

export function sourceAssessmentNote(value: unknown, field = '测评等级'): string {
  if (typeof value !== 'string' || !value.trim() || normalizeSourceAssessmentBand(value)) return '';
  return `原${field}：${value === 'below_a' ? '未达A' : value.trim()}`;
}

export function normalizeSourceBoolean(value: string, yes: readonly string[], no: readonly string[]): boolean | null {
  const text = value.trim();
  return yes.includes(text) ? true : no.includes(text) ? false : null;
}

export function normalizeSourceContact(value: string): {
  outcome: 'unreachable' | 'connected' | 'declined' | 'invalid_number' | null;
  wechatAdded: boolean | null;
  visitCommitted: boolean | null;
  note: string;
} {
  const parts = value.split(/[、,，]/).map(part => part.trim()).filter(Boolean);
  const connected = parts.some(part => ['加V', '诺访', '已沟通', '已联系'].includes(part));
  const unreachable = parts.some(part => ['未通', '未接通'].includes(part));
  const declined = parts.some(part => ['下期次再联系', '暂缓', '下次联系'].includes(part));
  const invalid = parts.some(part => ['号码无效', '无效号码'].includes(part));
  const contradictory = Number(connected) + Number(unreachable) + Number(declined) + Number(invalid) > 1;
  const outcome = contradictory ? null : connected ? 'connected' : unreachable ? 'unreachable' : declined ? 'declined' : invalid ? 'invalid_number' : null;
  return { outcome, wechatAdded: parts.includes('加V') ? true : null, visitCommitted: parts.includes('诺访') ? true : null,
    note: value.trim() && (!outcome || parts.some(part => !['加V', '诺访', '已沟通', '已联系', '未通', '未接通', '下期次再联系', '暂缓', '下次联系', '号码无效', '无效号码'].includes(part))) ? `原联系结果：${value.trim()}` : '' };
}

export function sourceScore(value: string): { score: number | null; maxScore: number | null; note: string } {
  const text = value.trim();
  if (!text) return { score: null, maxScore: null, note: '' };
  const match = /^(\d+(?:\.\d+)?)\s*(?:分)?(?:\s*[/／]\s*(\d+(?:\.\d+)?)\s*(?:分)?)?$/.exec(text);
  if (!match) return { score: null, maxScore: null, note: `原测评分数：${text}` };
  const score = Number(match[1]), maxScore = match[2] ? Number(match[2]) : null;
  if (score > 10000 || maxScore !== null && (maxScore <= 0 || score > maxScore)) return { score: null, maxScore: null, note: `原测评分数：${text}` };
  return { score, maxScore, note: '' };
}

export function mergeSourceNotes(...values: (string | null | undefined)[]): string {
  return [...new Set(values.flatMap(value => value?.split(/\r?\n/) ?? []).map(line => line.trim()).filter(Boolean))].join('\n');
}

export function resolveSourceStaffId(label: string, profiles: readonly {id:string;display_name:string;role:string;is_active:boolean;account_status?:string}[]): string | null {
  if(!label.trim())return null;
  const matches=profiles.filter(profile=>profile.display_name.trim()===label.trim()&&['staff','admin'].includes(profile.role)&&profile.is_active&&profile.account_status!=='locked');
  return matches.length===1?matches[0].id:null;
}

/** 独立登记的加微、诺访、意向可用于首联工作表；这些字段本身不表示发生过联系。 */
export function sourceLeadContactFacts(notes: string): {wechatAdded:boolean|null;visitCommitted:boolean|null;interestLevel:'A'|'B'|'C'|null} {
  const values=(field:string)=>[...new Set(notes.split(/\r?\n/u).filter(line=>line.startsWith(`${field}：`)).map(line=>line.slice(field.length+1).trim()).filter(Boolean))];
  const single=(field:string)=>{const all=values(field);return all.length===1?all[0]:'';};
  const interest=single('意向分类');
  return {wechatAdded:normalizeSourceBoolean(single('用户当下加V与否'),['是','已'],['否','未']),visitCommitted:normalizeSourceBoolean(single('诺访与否'),['是','已'],['否','未']),interestLevel:interest==='A'||interest==='B'||interest==='C'?interest:null};
}

export function sourceStaffLabel(notes:string,field:'学科老师'|'学服老师'):string {
  const values=[...new Set(notes.split(/\r?\n/u).filter(line=>line.startsWith(`${field}：`)).map(line=>line.slice(field.length+1).trim()).filter(Boolean))];
  return values.length===1?values[0]:'';
}

export function sourceVisitKinds(content:string,assessmentBand:string,learningBand:string,score:string):Array<'assessment_1v1'|'trial_class'|'competition'> {
  const kinds:Array<'assessment_1v1'|'trial_class'|'competition'>=[];
  if(/思闯|数独/u.test(content))kinds.push('competition');
  else if(/测评|散测|一对一沟通/u.test(content)||assessmentBand||learningBand||score)kinds.push('assessment_1v1');
  if(/体验|试听/u.test(content))kinds.push('trial_class');
  if(!kinds.length)kinds.push('assessment_1v1');
  return kinds;
}

/** 报名确认前序阶段；班型对应学生已知等级，所属测评场次另行核对。 */
export interface SourceEnrollmentFacts {
  version: 1;
  confirmed: true;
  assessmentBand: CurrentAssessmentBand | null;
  registeredOn: string | null;
}

export function sourceEnrollmentFacts(result: string, classBand: string, registeredOn: string | null): SourceEnrollmentFacts | null {
  if (!['已报名', '已报', '是', '已续', '新报', '已缴费'].includes(result.trim())) return null;
  return { version: 1, confirmed: true, assessmentBand: normalizeSourceAssessmentBand(classBand), registeredOn };
}

export function readSourceEnrollmentFacts(value: unknown): SourceEnrollmentFacts | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || row.confirmed !== true) return null;
  return { version: 1, confirmed: true, assessmentBand: normalizeSourceAssessmentBand(row.assessmentBand),
    registeredOn: typeof row.registeredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.registeredOn) ? row.registeredOn : null };
}

/** 明确到访/成绩优先；内容空白且没有到场证据的来源保留为一次未到预约。 */
export function sourceVisitParticipation(content: string, attendance: string, assessmentBand: string, learningBand: string, score: string): 'attended' | 'no_show' | 'booked' {
  if (['已到', '是', '已出勤', '出勤'].includes(attendance.trim())) return 'attended';
  if (['未到', '未出勤', '否'].includes(attendance.trim())) return 'no_show';
  if (assessmentBand.trim() || learningBand.trim() || score.trim()) return 'attended';
  return content.trim() ? 'booked' : 'no_show';
}

export function hasSourceAssessmentConclusion(assessment:{assessmentBand?:string|null;score?:number|null;strengths?:string}|null|undefined):boolean {
  return Boolean(assessment&&(assessment.assessmentBand||assessment.score!=null||/(原测评等级|学习力测评等级)：/u.test(assessment.strengths??'')));
}

export function businessDisplayDate(scheduledAt: string | null | undefined, occurredOn: string | null | undefined, locale: string, empty = '—'): string {
  if(scheduledAt && /^\d{4}-\d{2}-\d{2}$/.test(scheduledAt))return scheduledAt;
  if (scheduledAt && Number.isFinite(new Date(scheduledAt).getTime())) return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(scheduledAt));
  return occurredOn || empty;
}
