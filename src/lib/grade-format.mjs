// 年级数字是业务值；汉字和学段简称只用于兼容外部输入。
const GRADE_WORDS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
const GRADE_ALIASES = new Map(GRADE_WORDS.map((word, index) => [`${word}年级`, index + 1]));
/** @type {Array<[string, number, number]>} */
const SCHOOL_STAGES = [["小", 0, 6], ["初", 6, 3], ["高", 9, 3]];
for (const [prefix, offset, count] of SCHOOL_STAGES) {
  for (let index = 0; index < count; index += 1) {
    GRADE_ALIASES.set(`${prefix}${GRADE_WORDS[index]}`, offset + index + 1);
  }
}

/** @param {string} value @returns {number | null} */
export function parseSchoolGrade(value) {
  const compact = value.normalize("NFKC").replace(/\s+/gu, "");
  const alias = GRADE_ALIASES.get(compact);
  if (alias !== undefined) return alias;
  const numeric = /^(?:第)?(\d{1,2})(?:年级)?$/u.exec(compact);
  if (!numeric) return null;
  const grade = Number(numeric[1]);
  return grade >= 1 && grade <= 12 ? grade : null;
}

// 只转换 1–7 年级及其范围；保留“同一年级”、更高年级和其他中文数字。
const GRADE_TEXT = /(?<![同这那每某另哪各任统上下一二三四五六七八九十百千万零〇两\d])([一二三四五六七1-7](?:\s*[至到、，,/／~～—–-]\s*[一二三四五六七1-7])*)\s*年级/gu;

/** @param {string} value @returns {string} */
export function normalizeGradeText(value) {
  return value.replace(GRADE_TEXT, (label) => label.replace(/[一二三四五六七]/gu,
    (word) => String(GRADE_WORDS.indexOf(word) + 1)));
}

/** 年级字段使用完整数字标签；无法识别的来源说明继续保留。
 * @param {string} value @returns {string} */
export function normalizeGradeLabel(value) {
  const grade = parseSchoolGrade(value);
  return grade !== null && grade <= 7 ? `${grade}年级` : normalizeGradeText(value);
}
