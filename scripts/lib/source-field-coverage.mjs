/** 记录导入器实际查询过的字段；来源 ID 和整行覆盖不作为字段映射完成的证据。 */
export function observeSourceFields(sourceRecords) {
  const used = new Map();
  const records = sourceRecords.map(record => ({ ...record, record_data: { ...record.record_data,
    cells: new Proxy(record.record_data.cells, { get(cells, key) {
      if (key === 'find') return predicate => {
        const cell = cells.find(predicate);
        if (cell?.text?.trim()) {
          if (!used.has(record.id)) used.set(record.id, new Set());
          used.get(record.id).add(cell.fieldId);
        }
        return cell;
      };
      return Reflect.get(cells, key);
    } }),
  } }));
  function report() {
    const fields = new Map();
    for (const record of sourceRecords) for (const cell of record.record_data.cells) {
      if (cell.kind === 'system') continue;
      const key = JSON.stringify([record.source_sha256 ?? record.source_data.filename, record.source_table_id ?? record.record_data.tableName, cell.fieldId]);
      if (!fields.has(key)) fields.set(key, { source: record.source_data.filename, table: record.record_data.tableName,
        fieldId: cell.fieldId, field: cell.fieldName, nonemptyCells: 0, lookedUpCells: 0, notLookedUpCells: 0 });
      const item = fields.get(key);
      if (!cell.text?.trim()) continue;
      item.nonemptyCells++;
      if (used.get(record.id)?.has(cell.fieldId)) item.lookedUpCells++; else item.notLookedUpCells++;
    }
    const items = [...fields.values()];
    return { version: 1, semantics: 'lookup_only_not_storage_or_display_proof',
      fieldCount: items.length, nonemptyCells: items.reduce((sum,item) => sum + item.nonemptyCells,0),
      notLookedUpCells: items.reduce((sum,item) => sum + item.notLookedUpCells,0), fields: items };
  }
  return { records, report };
}
