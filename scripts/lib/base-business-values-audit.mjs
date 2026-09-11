/** 原值明细只写入受控本地报告；共享报告使用字段名和汇总数量。 */
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const valueKey = value => JSON.stringify(canonical(value));
const businessValue = field => ({ section: field.section, key: field.key, kind: field.kind, value: field.value,
  projections: field.projections ?? [], review: field.review ?? [], status: field.status, label: field.label ?? null });
const reviewReasons = field => field?.review?.length ? field.review : field?.status === 'unparsed' ? ['unrecognized'] : [];
export function auditBaseBusinessValues(previousFacts, facts) {
  const previous = new Map(previousFacts.map(fact => [fact.source_record_id, new Map(fact.fields.map(field => [field.fieldId, field]))]));
  const semantics = new Map(), issues = [], changedRecords = new Set();
  let values = 0, changedValues = 0, changedDisplays = 0, reclassifiedValues = 0, resolvedReviewValues = 0, priorReviewValues = 0, projectedValues = 0;
  for (const fact of facts) for (const field of fact.fields) {
    values++;
    const key = `${field.section}.${field.key}`;
    if (!semantics.has(key)) semantics.set(key, { key, names: new Set(), values: 0, changedValues: 0, changedDisplays: 0, reviewValues: 0, canonical: new Map() });
    const group = semantics.get(key), before = previous.get(fact.source_record_id)?.get(field.fieldId);
    group.names.add(field.name); group.values++;
    if (before && (before.name !== field.name || before.originalText !== field.originalText)) throw new Error('BASE_AUDIT_ORIGINAL_CHANGED');
    if (before && valueKey(businessValue(before)) !== valueKey(businessValue(field))) { changedValues++; group.changedValues++; changedRecords.add(fact.source_record_id); }
    if (before && before.display !== field.display) { changedDisplays++; group.changedDisplays++; changedRecords.add(fact.source_record_id); }
    if (before && (before.section !== field.section || before.key !== field.key)) reclassifiedValues++;
    if (field.projections?.length) projectedValues++;
    const reasons = reviewReasons(field);
    if (reviewReasons(before).length) { priorReviewValues++; if (!reasons.length) resolvedReviewValues++; }
    if (reasons.length) { group.reviewValues++; issues.push({ sourceId: fact.source_record_id, fieldId: field.fieldId, field: field.name, semantic: key, originalText: field.originalText, display: field.display, reasons }); }
    if (field.status === 'normalized') {
      const canonicalKey = valueKey(field.value);
      if (!group.canonical.has(canonicalKey)) group.canonical.set(canonicalKey, { value: field.value, display: field.display, originals: new Map(), count: 0 });
      const canonical = group.canonical.get(canonicalKey);
      canonical.count++;
      canonical.originals.set(field.originalText, (canonical.originals.get(field.originalText) ?? 0) + 1);
    }
  }
  const rows = [...semantics.values()].sort((a, b) => a.key.localeCompare(b.key)).map(group => ({
    key: group.key, names: [...group.names], values: group.values, changedValues: group.changedValues, changedDisplays: group.changedDisplays, reviewValues: group.reviewValues,
    aliases: [...group.canonical.values()].filter(value => value.originals.size > 1).map(value => ({ ...value, originals: [...value.originals].map(([text, count]) => ({ text, count })) })),
  }));
  return { summary: { records: facts.length, values, semanticFields: rows.length, changedRecords: changedRecords.size, changedValues, changedDisplays,
    reclassifiedValues, projectedValues, priorReviewValues, resolvedReviewValues,
    synonymGroups: rows.reduce((count, row) => count + row.aliases.length, 0), synonymFields: rows.filter(row => row.aliases.length).length,
    reviewValues: issues.length, reviewRecords: new Set(issues.map(issue => issue.sourceId)).size,
    reviewReasons: issues.reduce((counts, issue) => { for (const reason of issue.reasons) counts[reason] = (counts[reason] ?? 0) + 1; return counts; }, {}) }, fields: rows, issues };
}
