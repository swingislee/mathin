import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leadHasCommittedVisit } from '@/features/school/lead-contract';
import { placementHealth, placementStudentBackground } from '@/features/school/enrollment-workflow-contract';

describe('followup completion surfaces', () => {
  it('uses explicit saved visit facts or a confirmed arrangement', () => {
    expect(leadHasCommittedVisit({ visitCommitted: true, activeInvitation: null })).toBe(true);
    expect(leadHasCommittedVisit({ visitCommitted: false, activeInvitation: null })).toBe(false);
    expect(leadHasCommittedVisit(null, { state: 'confirmed' })).toBe(true);
    expect(leadHasCommittedVisit(null, { state: 'completed' })).toBe(true);
    expect(leadHasCommittedVisit(null, { state: 'coordinating_time' })).toBe(false);
    expect(leadHasCommittedVisit(null, { state: 'cancelled' })).toBe(false);
    expect(leadHasCommittedVisit()).toBe(false);
  });

  it('keeps healthy and unknown students white, renewals pale green, and danger red', () => {
    const healthy = placementHealth([{ key: 'attendance', level: 'observed' }, { key: 'communication', level: 'observed' }]);
    const danger = placementHealth([{ key: 'attendance', level: 'attention' }, { key: 'communication', level: 'attention' }]);
    expect(healthy.tone).toBe('high');
    expect(healthy.background).toBe('var(--card)');
    expect(placementStudentBackground(healthy, false)).toBe('var(--card)');
    expect(placementStudentBackground(null, false)).toBe('var(--card)');
    expect(placementStudentBackground(healthy, true)).toContain('var(--leaf) 24%');
    expect(placementStudentBackground(null, true)).toContain('var(--leaf) 24%');
    expect(placementStudentBackground(danger, false)).toContain('var(--rose)');
    expect(placementStudentBackground(danger, true)).toBe(danger.background);
  });

  it('keeps active and selected yellow surfaces above completion while sticky cells inherit the row', () => {
    const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
    const success = css.indexOf('tr[data-followup-success="true"]');
    expect(success).toBeGreaterThan(0);
    expect(css.slice(success)).toContain('var(--leaf) 24%, var(--card)');
    expect(css.indexOf('tr[aria-selected="true"]', success)).toBeGreaterThan(success);
    expect(css.indexOf('tr[data-followup-active="true"]', success)).toBeGreaterThan(success);
    expect(css).toMatch(/tr > td\.sticky\s*\{\s*background-color: inherit;/);
  });
});
