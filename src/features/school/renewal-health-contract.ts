export interface RenewalHealthFacts {
  studentId: string;
  hasLearningAccount: boolean;
  lessons: { id: string; at: string; attendance: string | null }[];
  checks: { at: string; status: string | null }[];
  contacts: string[];
  homework: { at: string; submitted: boolean; score: number | null }[];
  videos: { at: string; submitted: boolean }[];
}
export type HealthLevel = 'attention' | 'observed' | 'unknown';
export interface RenewalHealthSignal { key: string; level: HealthLevel; count?: number; total?: number; }

/** 观察阈值用于人工复核，不输出续报概率；缺测与零值分别处理。 */
export function renewalHealthSignals(facts: RenewalHealthFacts | undefined, now: number): RenewalHealthSignal[] {
  if (!facts) return [{ key: 'unavailable', level: 'unknown' }];
  const recent = (at: string) => Date.parse(at) >= now - 28 * 86400000 && Date.parse(at) <= now;
  const lessons = facts.lessons.filter(row => recent(row.at));
  const checks = facts.checks.filter(row => recent(row.at));
  const results: RenewalHealthSignal[] = [];
  const add = (key: string, level: HealthLevel, count?: number, total?: number) => results.push({ key, level, count, total });
  const calls = facts.contacts.filter(recent).length;
  add('communication', lessons.length >= 2 ? (calls < 2 ? 'attention' : 'observed') : 'unknown', calls, lessons.length);
  const attendance = lessons.filter(row => row.attendance !== null);
  const leave = attendance.filter(row => ['leave','absent'].includes(row.attendance ?? '')).length;
  add('attendance', attendance.length ? (leave ? 'attention' : 'observed') : 'unknown', leave, attendance.length);
  const answered = checks.filter(row => row.status !== null && row.status !== 'not_observed');
  add('participation', checks.length >= 5 ? (answered.length / checks.length < .5 ? 'attention' : 'observed') : 'unknown', answered.length, checks.length);
  // 学习检查不是逐题答题日志；在数据说明中明确其范围。
  const correct = answered.filter(row => row.status === 'independent' || row.status === 'explained').length;
  add('challenge', answered.length >= 5 ? (correct === answered.length ? 'attention' : 'observed') : 'unknown', correct, answered.length);
  const homework = facts.homework.filter(row => recent(row.at));
  const missing = homework.filter(row => !row.submitted).length;
  add('homework', facts.hasLearningAccount && homework.length ? (missing ? 'attention' : 'observed') : 'unknown', missing, homework.length);
  const scores = homework.flatMap(row => row.score === null ? [] : [Number(row.score)]);
  const average = (values: number[]) => values.reduce((a,b)=>a+b,0)/values.length;
  add('accuracy', scores.length >= 3 ? (average(scores)<60 ? 'attention' : 'observed') : 'unknown', scores.length ? Math.round(average(scores)) : 0, scores.length);
  const videos = facts.videos.filter(row => recent(row.at));
  const pending = videos.filter(row => !row.submitted).length;
  add('video', videos.length ? (pending ? 'attention' : 'observed') : 'unknown', pending, videos.length);
  const before = facts.homework.filter(row => !recent(row.at)).flatMap(row => row.score === null ? [] : [Number(row.score)]);
  const comparable = scores.length >= 3 && before.length >= 3;
  const delta = comparable ? Math.round(average(scores)-average(before)) : 0;
  add('trend', comparable ? (delta<=0 ? 'attention' : 'observed') : 'unknown', delta, scores.length);
  return results;
}
