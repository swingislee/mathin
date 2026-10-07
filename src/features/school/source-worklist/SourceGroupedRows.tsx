'use client';

import { Fragment, type ReactNode } from 'react';
import { TableCell, TableRow } from '@/components/ui/table';
import type { SourcePlacement } from './contract';
import { sourceGroupPath } from './grouping';

/** 在数据库已排好的一页中延续原表层级；不重排、合并或截断业务行。 */
export function SourceGroupedRows<Row>({ rows, placementFor, rowKey, renderRow, allMonths, locale, colSpan }: {
  rows: readonly Row[]; placementFor: (row: Row) => SourcePlacement | undefined;
  rowKey: (row: Row) => string; renderRow: (row: Row) => ReactNode;
  allMonths: boolean; locale: string; colSpan: number;
}) {
  return rows.map((row, index) => {
    const placement = placementFor(row), previous = index ? placementFor(rows[index - 1]) : undefined;
    const path = placement ? sourceGroupPath(placement, allMonths, locale) : [];
    const before = previous ? sourceGroupPath(previous, allMonths, locale) : [];
    const changed = path.findIndex((group, depth) => group.key !== before[depth]?.key);
    return <Fragment key={rowKey(row)}>
      {path.map((group, depth) => changed !== -1 && depth >= changed ? <TableRow key={group.key} data-followup-group="true" className={depth === 0 ? 'bg-line/20' : 'bg-card'}>
        <TableCell colSpan={colSpan} className="py-1.5 font-medium"><span style={{ paddingInlineStart: depth * 18 }}>{group.label}</span></TableCell>
      </TableRow> : null)}
      {renderRow(row)}
    </Fragment>;
  });
}
