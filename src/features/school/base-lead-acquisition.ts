import type { LeadPoolRow } from "./lead-contract";
import type { BaseLeadAcquisition } from "./base-business-fields-contract";
import { parseSchoolGrade } from "@/lib/grade-format.mjs";

/** 原有来源仍作为原主行；Base 的每次获客分别保留，缺少原主行时才采用 Base 最近一条。 */
export function applyBaseLeadAcquisition(row: LeadPoolRow, sources: BaseLeadAcquisition["sources"]): LeadPoolRow {
  const parsedGrade = parseSchoolGrade(row.gradeText);
  if (parsedGrade !== null) {
    const gradeHint = row.gradeHint ?? parsedGrade;
    const gradeText = `${gradeHint}年级`;
    if (row.gradeHint !== gradeHint || row.gradeText !== gradeText) row = { ...row, gradeHint, gradeText };
  }
  if (!sources.length) return row;
  const latest = sources[0];
  return { ...row, baseAcquisitionSources: sources, sourceCount: row.sourceCount + sources.length,
    ...(row.sourceCount === 0 ? { acquiredAt: latest.acquiredAt, acquiredDateLabel: latest.dateLabel,
      acquisitionLocation: latest.location, acquisitionMethod: latest.method, acquisitionPromoter: latest.promoter } : {}) };
}
