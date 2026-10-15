import { describe, expect, it } from 'vitest';
import { sourceDateNote } from '../src/features/school/source-date-note';

describe('来源日期提示', () => {
  it('原表写全年月日或没有标注时不提示', () => {
    expect(sourceDateNote(null, 'zh')).toBeNull();
    expect(sourceDateNote({ basis: 'explicit', label: '2025/12/19' }, 'zh')).toBeNull();
  });
  it('补年与只记月份给出由来，待核对给出原因', () => {
    expect(sourceDateNote({ basis: 'registration_order', label: '10.11' }, 'zh')).toEqual({ review: false, short: '年份按登记补全', text: '原表记为“10.11”，年份按表内登记先后补全。' });
    expect(sourceDateNote({ basis: 'month_only', label: '一月' }, 'zh')).toMatchObject({ review: false, short: '只记月份' });
    expect(sourceDateNote({ basis: 'registration_order', review: 'month_conflict', label: '10.10' }, 'zh')).toMatchObject({ review: true, short: '日期待核对' });
    expect(sourceDateNote({ review: 'unparsed', label: '9，20' }, 'en')).toMatchObject({ review: true, short: 'Date to verify' });
    expect(sourceDateNote({ review: 'unknown_reason', basis: 'registration_order', label: '1.2' }, 'zh')).toMatchObject({ review: false });
  });
});
