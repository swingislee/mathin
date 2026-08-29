/** 爱学习课程族的难度顺序：X+ < G+ < A+。其他历史班型维持字典序。 */
const AIXUEXI_DIFFICULTY_ORDER = new Map([
  ["X+", 0],
  ["G+", 1],
  ["A+", 2],
]);

export function compareCourseDifficulty(left: string, right: string): number {
  const leftRank = AIXUEXI_DIFFICULTY_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = AIXUEXI_DIFFICULTY_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || left.localeCompare(right, "zh-Hans");
}

export function compareCourseVariant(
  left: { grade: number; courseSeason: number | null; classType: string; productCode?: string | null },
  right: { grade: number; courseSeason: number | null; classType: string; productCode?: string | null },
): number {
  return left.grade - right.grade
    || (left.courseSeason ?? Number.MAX_SAFE_INTEGER) - (right.courseSeason ?? Number.MAX_SAFE_INTEGER)
    || compareCourseDifficulty(left.classType, right.classType)
    || (left.productCode ?? "").localeCompare(right.productCode ?? "", "en");
}
