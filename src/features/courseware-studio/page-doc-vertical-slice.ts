export const PAGE_DOC_VERTICAL_SLICE_SAMPLE = {
  lectureId: "ff04ee0e-2112-43c5-b4fd-27f0d853d3c3",
  pageDocId: "b58bbb24-e11a-418a-b269-92dde7009fbe",
  pageNo: 5,
  track: "native-16x9",
} as const;

export const PAGE_DOC_VERTICAL_SLICE_MODE = "page-doc";

/**
 * Step 3 is deliberately limited to one local E-series page. The explicit
 * query mode keeps normal release preview read-only, while this predicate
 * prevents a changed page query from widening the accepted audit sample.
 */
export function isPageDocVerticalSliceSample(input: {
  mode: string | undefined;
  lectureId: string;
  pageDocId: string | undefined;
  pageNo: number;
}) {
  return input.mode === PAGE_DOC_VERTICAL_SLICE_MODE
    && input.lectureId === PAGE_DOC_VERTICAL_SLICE_SAMPLE.lectureId
    && input.pageDocId === PAGE_DOC_VERTICAL_SLICE_SAMPLE.pageDocId
    && input.pageNo === PAGE_DOC_VERTICAL_SLICE_SAMPLE.pageNo;
}
