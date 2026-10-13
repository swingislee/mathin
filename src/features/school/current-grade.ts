export function currentGradeLabel(grade: number | null, locale: string): string {
  const en = locale.startsWith('en');
  if (grade == null) return en ? 'To confirm' : '待确认';
  const early: Record<number, string> = en ? { '-3': 'Nursery', '-2': 'Junior kindergarten', '-1': 'Middle kindergarten', 0: 'Senior kindergarten', 13: 'Graduated' }
    : { '-3': '托班', '-2': '小班', '-1': '中班', 0: '大班', 13: '已毕业' };
  return early[grade] ?? (en ? `Grade ${grade}` : `${grade}年级`);
}

export function currentGradeOptions(locale: string) {
  return [{ value: '', label: currentGradeLabel(null, locale) }, ...Array.from({ length: 17 }, (_, index) => index - 3)
    .map(grade => ({ value: String(grade), label: currentGradeLabel(grade, locale) }))];
}
