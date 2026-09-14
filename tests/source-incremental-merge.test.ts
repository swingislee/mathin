import { describe, expect, it } from 'vitest';
import { mergeSourceIncrement } from '../scripts/lib/source-incremental-merge.mjs';

describe('source incremental merge', () => {
  it('updates changed source fields while retaining independent production values', () => {
    const result = mergeSourceIncrement({ date: '2026-09-01', note: 'original' }, { date: '2026-09-14', note: 'original' }, { date: '2026-09-01', note: 'teacher edit', owner: 'staff' });
    expect(result).toEqual({ value: { date: '2026-09-14', note: 'teacher edit', owner: 'staff' }, conflicts: [] });
  });
  it('preserves conflicting production corrections', () => {
    expect(mergeSourceIncrement({ grade: 2 }, { grade: 3 }, { grade: 4 })).toEqual({ value: { grade: 4 }, conflicts: ['grade'] });
  });
  it('merges source statistics independently and retains a corrected assessment flag', () => {
    const result = mergeSourceIncrement({ facts: { month: '2026-08', assessed: true } }, { facts: { month: '2026-09', assessed: true } }, { facts: { month: '2026-08', assessed: false } });
    expect(result.value).toEqual({ facts: { month: '2026-09', assessed: false } });
  });
  it('handles source clearing, added fields, and idempotent reapplication', () => {
    const before = { note: 'old', staff: null };
    const next = { note: '', staff: 'new', date: '2026-09-14' };
    const once = mergeSourceIncrement(before, next, before);
    expect(once.value).toEqual(next);
    expect(mergeSourceIncrement(before, next, once.value)).toEqual(once);
  });
  it('treats arrays atomically and never drops extra production keys', () => {
    expect(mergeSourceIncrement({ tags: ['a'] }, { tags: ['b'] }, { tags: ['manual'], extra: true })).toEqual({ value: { tags: ['manual'], extra: true }, conflicts: ['tags'] });
  });
});
