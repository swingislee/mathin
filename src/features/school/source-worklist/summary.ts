import { normalizeGradeLabel } from '@/lib/grade-format.mjs';

const supportNames = new Set(['章润', '王晓妹', '邱玮', '汪婷婷']);
export const isSourceSupport = (name: string) => supportNames.has(name.trim());

const identityFields = /^(?:.*年级.*|姓名|学员姓名|学生姓名|家长姓名|家长电话|联系电话|手机号|电话|获取渠道|来源渠道|渠道|获取人员(?:兼职)?|推广兼职|推广员|跟进人(?:员)?|确认人员|沟通人员|学服老师|主线服务老师|报名服务老师|非在读-学服|获取时间|获取日期|获取地点|获取方式|来源批次|来源年级|就读学校)$/u;
const noteFields = /^(?:跟进信息|确认信息备注|沟通情况|来源备注|获取信息|备注|特别备注说明|用户沟通情况（授课老师填写项）|用户运营情况（学服老师填写项）|续&未报家长情况说明)$/u;
const factFields = /^(?:跟进结果|确认结果|意向分类|用户当下加V与否|诺访与否|到访与否|报名与否|当下状态)$/u;

/** 主行只摘要原文；原始记录继续在展开详情保留。 */
export function communicationNoteSummary(note: string | null | undefined): string {
  const narrative: string[] = [], facts: string[] = [];
  for (const line of (note ?? '').split(/\r?\n/u).map(value => value.trim()).filter(Boolean)) {
    const field = /^([^：:\n]{1,48})[：:]\s*(.*)$/u.exec(line);
    if (!field) { narrative.push(line); continue; }
    const [, label, value] = field;
    if (!value.trim() || identityFields.test(label)) continue;
    if (factFields.test(label)) { facts.push(`${label}：${value.trim()}`); continue; }
    narrative.push(noteFields.test(label) ? value.trim() : line);
  }
  return [...new Set(narrative.length ? narrative : facts)].join('；');
}

export function worklistGrade(row: { grade: number | null; gradeText: string }, locale: string): string {
  if (row.grade != null) return locale.startsWith('en') ? `Grade ${row.grade}` : `${row.grade}年级`;
  return normalizeGradeLabel(row.gradeText);
}
