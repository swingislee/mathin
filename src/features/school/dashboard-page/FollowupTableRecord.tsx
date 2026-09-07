"use client";

import { memo, type ReactNode } from "react";

export interface FollowupRowState {
  active: boolean;
  expanded: boolean;
  selected?: boolean;
  pending?: boolean;
  retained?: boolean;
}

/** 每条记录独立复用渲染结果；调用方保持 render 稳定，单独传入行状态。 */
function TableRecord<Row>({ row, render, ...state }: FollowupRowState & {
  row: Row;
  render: (row: Row, state: FollowupRowState) => ReactNode;
}) {
  return render(row, state);
}

export const FollowupTableRecord = memo(TableRecord) as typeof TableRecord;
