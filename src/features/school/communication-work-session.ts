export interface CommunicationWorkSession<Row> {
  boundary: string;
  selection: string;
  keys: string[];
  facts: Map<string, Row>;
}

/** 本地回显只覆盖它所基于的服务器版本；新读取的事实优先。 */
export function communicationFactWithOverride<Row>(source: Row, override?: { base: Row; value: Row }): Row {
  return override?.base === source ? override.value : source;
}

/** 用户改变筛选、排序或工作范围时重选成员；刷新时按服务端可见范围清理旧事实。 */
export function reconcileCommunicationWorkSession<Row>(previous: CommunicationWorkSession<Row> | null, {
  boundary, selection, rows, selectedRows, authorizedKeys, keyOf, sameFact,
}: {
  boundary: string; selection: string; rows: readonly Row[]; selectedRows: readonly Row[];
  authorizedKeys?: readonly string[];
  keyOf(row: Row): string; sameFact(left: Row, right: Row): boolean;
}): CommunicationWorkSession<Row> {
  const allowed = authorizedKeys ? new Set(authorizedKeys) : null;
  const visibleRows = allowed ? rows.filter((row) => allowed.has(keyOf(row))) : rows;
  if (!previous || previous.boundary !== boundary || previous.selection !== selection) {
    const keys = [...new Set(selectedRows.map(keyOf))].filter((key) => !allowed || allowed.has(key));
    return { boundary, selection, keys, facts: new Map(visibleRows.map((row) => [keyOf(row), row])) };
  }
  let facts = previous.facts;
  const keys = allowed ? previous.keys.filter((key) => allowed.has(key)) : previous.keys;
  if (allowed) for (const key of facts.keys()) {
    if (allowed.has(key)) continue;
    if (facts === previous.facts) facts = new Map(facts);
    facts.delete(key);
  }
  for (const row of visibleRows) {
    const key = keyOf(row);
    const old = facts.get(key);
    if (old && sameFact(old, row)) continue;
    if (facts === previous.facts) facts = new Map(facts);
    facts.set(key, row);
  }
  return facts === previous.facts && keys.length === previous.keys.length ? previous : { ...previous, keys, facts };
}

export function nextUnprocessedCommunicationKey(keys: readonly string[], processed: ReadonlySet<string>, after: string): string | null {
  const index = keys.indexOf(after);
  return keys.slice(index + 1)
    .find((key) => key !== after && !processed.has(key)) ?? null;
}
