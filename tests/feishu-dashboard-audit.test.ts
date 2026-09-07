import { expect, it } from 'vitest';
import { matchesDashboardFilter, evaluateDashboardRange } from '../scripts/lib/feishu-dashboard-audit.mjs';

const fields = { month: { name: '月份' }, phone: { name: '电话' }, owner: { name: '负责人' } };
const month = { fieldId: 'month', operator: 'is', value: ['dec'] };
it('combines month option IDs and a nonempty phone exactly as the source card does', () => {
  const filter = { conjunction: 'and', conditions: [month, { fieldId: 'phone', operator: 'isNotEmpty' }] };
  expect(matchesDashboardFilter({ month: { value: 'dec' }, phone: { value: { fullPhoneNum: 'placeholder' } } }, filter, fields)).toBe(true);
  expect(matchesDashboardFilter({ month: { value: 'dec' }, phone: {} }, filter, fields)).toBe(false);
  expect(matchesDashboardFilter({ month: { value: 'jan' }, phone: { value: 'placeholder' } }, filter, fields)).toBe(false);
});
it('supports nested OR, user IDs and exclusion without matching display names', () => {
  const filter = { conjunction: 'or', conditions: [month, { fieldId: 'owner', operator: 'is', value: [{ userId: 'one', name: 'same' }] }] };
  expect(matchesDashboardFilter({ owner: { value: { users: [{ userId: 'one' }] } } }, filter, fields)).toBe(true);
  expect(matchesDashboardFilter({ owner: { value: { users: [{ userId: 'two', name: 'same' }] } } }, filter, fields)).toBe(false);
  expect(matchesDashboardFilter({ month: { value: 'jan' } }, { ...month, operator: 'isNot' }, fields)).toBe(true);
});
it('fails explicitly on unsupported date filters and operators', () => {
  expect(() => matchesDashboardFilter({}, { ...month, fieldType: 5 }, fields)).toThrow('DATE_FILTER');
  expect(() => matchesDashboardFilter({}, { ...month, operator: 'contains' }, fields)).toThrow('UNSUPPORTED_FILTER_OPERATOR');
});
it('returns source row IDs including separate rows sharing the same cell values', () => {
  const archive = { tables: new Map([['table', { table: { meta: { name: 'source' }, fieldMap: fields }, recordMap: { a: { month: { value: 'dec' } }, b: { month: { value: 'dec' } }, c: { month: { value: 'jan' } } } }]]) };
  const range = { refMap: { '#ref': 'table' }, dataCondition: { tableId: '#ref', source: { type: 'CUSTOM', filterInfo: month }, seriesArray: 'COUNTA' } };
  expect(evaluateDashboardRange(archive, range)).toMatchObject({ count: 2, recordIds: ['a', 'b'] });
});
