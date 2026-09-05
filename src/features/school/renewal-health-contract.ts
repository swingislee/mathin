import { DEFAULT_RENEWAL_HEALTH_POLICY, type HealthRuleKey, type RenewalHealthPolicy } from './renewal-health-policy';

export interface RenewalHealthFacts {
  studentId: string;
  hasLearningAccount: boolean;
  lessons: { id: string; at: string; attendance: string | null }[];
  checks: { at: string; status: string | null }[];
  contacts: string[];
  homework: { at: string; submitted: boolean; score: number | null }[];
  videos: { at: string; submitted: boolean }[];
}
export type HealthLevel = 'attention' | 'observed' | 'unknown' | 'disabled';
export interface RenewalHealthSignal { key: string; level: HealthLevel; count?: number; total?: number; }

/** 观察阈值用于人工复核，不输出续报概率；缺测与零值分别处理。 */
export function renewalHealthSignals(facts: RenewalHealthFacts | undefined, now: number, policy: RenewalHealthPolicy = DEFAULT_RENEWAL_HEALTH_POLICY): RenewalHealthSignal[] {
  if (!facts) return [{ key: 'unavailable', level: 'unknown' }];
  const windowMs = policy.windowDays * 86400000;
  const recent = (at: string) => Date.parse(at) >= now - windowMs && Date.parse(at) <= now;
  const previous = (at: string) => Date.parse(at) >= now - 2 * windowMs && Date.parse(at) < now - windowMs;
  const lessons = facts.lessons.filter(row => recent(row.at));
  const checks = facts.checks.filter(row => recent(row.at));
  const results: RenewalHealthSignal[] = [];
  const add = (key: HealthRuleKey, available: boolean, attention: boolean, count: number, total: number) => results.push({
    key, level: !policy.rules[key].enabled ? 'disabled' : !available ? 'unknown' : attention ? 'attention' : 'observed', count, total,
  });
  const rules = policy.rules;
  const calls = facts.contacts.filter(recent).length;
  add('communication', lessons.length >= rules.communication.minSamples, calls < rules.communication.threshold, calls, lessons.length);
  const attendance = lessons.filter(row => row.attendance !== null);
  const leave = attendance.filter(row => ['leave','absent'].includes(row.attendance ?? '')).length;
  add('attendance', attendance.length >= rules.attendance.minSamples, leave >= rules.attendance.threshold, leave, attendance.length);
  const answered = checks.filter(row => row.status !== null && row.status !== 'not_observed');
  add('participation', checks.length >= rules.participation.minSamples, answered.length / checks.length * 100 < rules.participation.threshold, answered.length, checks.length);
  // 学习检查不是逐题答题日志；在数据说明中明确其范围。
  const correct = answered.filter(row => row.status === 'independent' || row.status === 'explained').length;
  add('challenge', answered.length >= rules.challenge.minSamples, correct / answered.length * 100 >= rules.challenge.threshold, correct, answered.length);
  const homework = facts.homework.filter(row => recent(row.at));
  const missing = homework.filter(row => !row.submitted).length;
  add('homework', facts.hasLearningAccount && homework.length >= rules.homework.minSamples, missing >= rules.homework.threshold, missing, homework.length);
  const scores = homework.flatMap(row => row.score === null ? [] : [Number(row.score)]);
  const average = (values: number[]) => values.reduce((a,b)=>a+b,0)/values.length;
  add('accuracy', scores.length >= rules.accuracy.minSamples, average(scores) < rules.accuracy.threshold, scores.length ? Math.round(average(scores)) : 0, scores.length);
  const videos = facts.videos.filter(row => recent(row.at));
  const pending = videos.filter(row => !row.submitted).length;
  add('video', videos.length >= rules.video.minSamples, pending >= rules.video.threshold, pending, videos.length);
  const before = facts.homework.filter(row => previous(row.at)).flatMap(row => row.score === null ? [] : [Number(row.score)]);
  const comparable = scores.length >= rules.trend.minSamples && before.length >= rules.trend.minSamples;
  const delta = comparable ? average(scores) - average(before) : 0;
  add('trend', comparable, delta <= rules.trend.threshold, Math.round(delta * 10) / 10, scores.length);
  return results;
}

export function renewalHealthLevel(signals: RenewalHealthSignal[]): HealthLevel {
  if (signals.some(signal => signal.level === 'attention')) return 'attention';
  if (signals.some(signal => signal.level === 'unknown')) return 'unknown';
  return signals.some(signal => signal.level === 'observed') ? 'observed' : 'disabled';
}
