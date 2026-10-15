const MONTH_KEY = /^(unknown|(\d{4}年)?([1-9]|1[0-2])月)$/;

/** 单月链接继续有效；多月以逗号连接，共享于地址、偏好和数据库查询。沟通名单的月份带年份（2026年10月）。 */
export function parsePeriodSelection(value: string): string {
  if (value === 'all' || value === '') return value;
  const months = value.split(',');
  if (months.length > 36 || months.some(month => !MONTH_KEY.test(month))) return '';
  return [...new Set(months)].join(',');
}

export function showsMultiplePeriods(value: string): boolean {
  return value === 'all' || value.includes(',');
}

/** 月份键的显示文字：中文原样，英文写成 2026-10；未填日期单独说明。 */
export function periodLabel(key: string, locale: string): string {
  const en = locale.startsWith('en');
  if (key === 'unknown') return en ? 'Date not recorded' : '日期未填';
  if (!en) return key;
  const match = key.match(/^(?:(\d{4})年)?(\d{1,2})月$/);
  return match ? match[1] ? `${match[1]}-${match[2].padStart(2, '0')}` : match[2] : key;
}
