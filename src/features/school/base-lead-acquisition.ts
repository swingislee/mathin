import type { LeadPoolRow } from "./lead-contract";
import type { BaseLeadAcquisition } from "./base-business-fields-contract";

/** 原有来源仍作为原主行；Base 的每次获客分别保留，缺少原主行时才采用 Base 最近一条。 */
export function applyBaseLeadAcquisition(row: LeadPoolRow, sources: BaseLeadAcquisition["sources"]): LeadPoolRow {
  if (!sources.length) return row;
  const latest = sources[0];
  return { ...row, baseAcquisitionSources: sources, sourceCount: row.sourceCount + sources.length,
    ...(row.sourceCount === 0 ? { acquiredAt: latest.acquiredAt, acquiredDateLabel: latest.dateLabel,
      acquisitionLocation: latest.location, acquisitionMethod: latest.method, acquisitionPromoter: latest.promoter } : {}) };
}
