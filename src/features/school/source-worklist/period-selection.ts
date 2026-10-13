const MONTH_KEY = /^(unknown|([1-9]|1[0-2])月)$/;

/** 单月链接继续有效；多月以逗号连接，共享于地址、偏好和数据库查询。 */
export function parsePeriodSelection(value: string): string {
  if (value === 'all' || value === '') return value;
  const months = value.split(',');
  if (months.length > 13 || months.some(month => !MONTH_KEY.test(month))) return '';
  return [...new Set(months)].join(',');
}

export function showsMultiplePeriods(value: string): boolean {
  return value === 'all' || value.includes(',');
}
