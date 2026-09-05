import type { RenewalHealthFacts } from './renewal-health-contract';

export const HEALTH_SAMPLE_KEYS = ['healthy', 'communication', 'participation', 'homework', 'video', 'attendance', 'challenge', 'plateau', 'declining', 'insufficient'] as const;
export type HealthSampleKey = typeof HEALTH_SAMPLE_KEYS[number];

/** 设置面板与开发验收共用的虚构样例；时间相对本次读取，避免样例过期。 */
export function renewalHealthSamples(now: number): { key: HealthSampleKey; facts: RenewalHealthFacts }[] {
  const at = (days: number) => new Date(now - days * 86400000).toISOString();
  return HEALTH_SAMPLE_KEYS.map(key => {
    const facts: RenewalHealthFacts = {
      studentId: 'health-sample-' + key,
      hasLearningAccount: true,
      lessons: [2, 5, 10, 20].map(day => ({ id: key + day, at: at(day), attendance: 'present' })),
      checks: Array.from({ length: 8 }, (_, i) => ({ at: at(i + 1), status: i % 2 ? 'prompted' : 'independent' })),
      contacts: [2, 8, 18].map(at),
      homework: [2, 5, 10, 20, 30, 35, 40, 50].map((day, i) => ({ at: at(day), submitted: true, score: i < 4 ? 80 : 65 })),
      videos: [3, 12].map(day => ({ at: at(day), submitted: true })),
    };
    if (key === 'communication') facts.contacts = [at(18)];
    if (key === 'participation') facts.checks = facts.checks.map((check, i) => ({ ...check, status: i < 2 ? 'prompted' : null }));
    if (key === 'homework') facts.homework = facts.homework.map((item, i) => ({ ...item, submitted: i !== 0, score: i === 0 ? null : i < 4 ? 45 : 65 }));
    if (key === 'video') facts.videos = facts.videos.map(item => ({ ...item, submitted: false }));
    if (key === 'attendance') facts.lessons[0].attendance = 'leave';
    if (key === 'challenge') facts.checks = facts.checks.map(item => ({ ...item, status: 'independent' }));
    if (key === 'plateau') facts.homework = facts.homework.map(item => ({ ...item, score: 80 }));
    if (key === 'declining') facts.homework = facts.homework.map((item, i) => ({ ...item, score: i < 4 ? 70 : 90 }));
    if (key === 'insufficient') Object.assign(facts, { hasLearningAccount: false, lessons: [], checks: [], contacts: [], homework: [], videos: [] });
    return { key, facts };
  });
}
