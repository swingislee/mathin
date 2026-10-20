import type { StudentStageRow } from '../student-stage-contract';
import { communicationFactTags } from './communication-facts';
import { recordStatusFacets } from './stage-focus';

/** 保留名单字段、未知与冲突结论；不把未打开的逐条依据序列化进 HTML/RSC。 */
export function summarizeRecordStatus<Row extends StudentStageRow>(row: Row): Row {
  if (row.statusSummary && !row.statusEvidence) return row;
  if (!row.statusEvidence?.length) return row;
  const { statusEvidence, ...record } = row;
  const statusSummary = {
    facets: recordStatusFacets(row).map(({ facet, status }) => ({
      facet, value: status.value, review: status.review, stored: status.stored,
    })),
    communicationTags: communicationFactTags(statusEvidence),
  };
  // 没有依据或只有很短的事实时直接携带，避免摘要反而变大或增加无意义的点击请求。
  if (JSON.stringify(statusSummary).length >= JSON.stringify(statusEvidence).length) return row;
  return { ...record, statusSummary } as Row;
}
