import { describe, expect, it } from 'vitest';
import { DEFAULT_RENEWAL_HEALTH_POLICY, isRenewalHealthPolicy } from '../src/features/school/renewal-health-policy';
import { renewalHealthLevel, renewalHealthSignals } from '../src/features/school/renewal-health-contract';
import { renewalHealthSamples } from '../src/features/school/renewal-health-samples';

const now = Date.parse('2026-09-05T00:00:00Z');
const samples = renewalHealthSamples(now);
const freshPolicy = () => structuredClone(DEFAULT_RENEWAL_HEALTH_POLICY);

describe('renewal health settings and sample data', () => {
  it('gives each sample the advertised result under default settings', () => {
    const attention = Object.fromEntries(samples.map(sample => [sample.key, renewalHealthSignals(sample.facts, now).filter(signal => signal.level === 'attention').map(signal => signal.key)]));
    expect(attention).toEqual({ healthy: [], communication: ['communication'], participation: ['participation'], homework: ['homework', 'accuracy', 'trend'], video: ['video'], attendance: ['attendance'], challenge: ['challenge'], plateau: ['trend'], declining: ['trend'], insufficient: [] });
    expect(renewalHealthLevel(renewalHealthSignals(samples[0].facts, now))).toBe('observed');
    expect(renewalHealthSignals(samples.at(-1)!.facts, now).every(signal => signal.level === 'unknown')).toBe(true);
  });

  it('changes classifications when a threshold changes or a signal is disabled', () => {
    const policy = freshPolicy();
    policy.rules.communication.threshold = 1;
    expect(renewalHealthLevel(renewalHealthSignals(samples[1].facts, now, policy))).toBe('observed');
    policy.rules.challenge.enabled = false;
    expect(renewalHealthSignals(samples[6].facts, now, policy).find(signal => signal.key === 'challenge')?.level).toBe('disabled');
    for (const rule of Object.values(policy.rules)) rule.enabled = false;
    expect(renewalHealthLevel(renewalHealthSignals(samples[0].facts, now, policy))).toBe('disabled');
  });

  it('respects minimum samples and exact percentage boundaries', () => {
    const policy = freshPolicy();
    const facts = structuredClone(samples[0].facts);
    facts.checks = facts.checks.map((check, index) => ({ ...check, status: index < 4 ? 'prompted' : null }));
    const participation = () => renewalHealthSignals(facts, now, policy).find(signal => signal.key === 'participation')?.level;
    expect(participation()).toBe('observed');
    policy.rules.participation.threshold = 51;
    expect(participation()).toBe('attention');
    policy.rules.participation.minSamples = 9;
    expect(participation()).toBe('unknown');
  });

  it('limits both trend windows and excludes future or older scores', () => {
    const policy = freshPolicy();
    policy.windowDays = 7;
    const facts = structuredClone(samples[0].facts);
    const scoreAt = (days: number) => ({ at: new Date(now - days * 86400000).toISOString(), submitted: true, score: 90 });
    facts.homework = [1, 2, 3, -1, -2, -3, 30, 31, 32].map(scoreAt);
    expect(renewalHealthSignals(facts, now, policy).find(signal => signal.key === 'trend')?.level).toBe('unknown');
    facts.homework.push(...[8, 9, 10].map(scoreAt));
    expect(renewalHealthSignals(facts, now, policy).find(signal => signal.key === 'trend')).toMatchObject({ level: 'attention', count: 0 });
  });

  it('rejects unsupported windows, missing rules and out-of-range values', () => {
    expect(isRenewalHealthPolicy(freshPolicy())).toBe(true);
    expect(isRenewalHealthPolicy({ ...freshPolicy(), windowDays: 56 })).toBe(false);
    expect(isRenewalHealthPolicy({ ...freshPolicy(), windowDays: '28' })).toBe(false);
    const policy = freshPolicy();
    policy.rules.participation.threshold = 101;
    expect(isRenewalHealthPolicy(policy)).toBe(false);
    policy.rules.participation.threshold = 50;
    policy.rules.trend.minSamples = 0;
    expect(isRenewalHealthPolicy(policy)).toBe(false);
    expect(isRenewalHealthPolicy({ ...freshPolicy(), rules: {} })).toBe(false);
  });

  it('keeps fictional sample dates relative and returns independent copies', () => {
    const tomorrow = renewalHealthSamples(now + 86400000);
    expect(Date.parse(tomorrow[0].facts.lessons[0].at) - Date.parse(samples[0].facts.lessons[0].at)).toBe(86400000);
    tomorrow[0].facts.contacts.length = 0;
    expect(renewalHealthSamples(now)[0].facts.contacts).toHaveLength(3);
  });
});
