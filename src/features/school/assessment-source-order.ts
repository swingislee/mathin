/** 保留 Supabase 的全局顺序；组合三种 DTO 时只按后端键取行，不做二次排序。 */
export function assessmentSourceOrder<Row extends { id: string }>(rows: Row[], keys: readonly { id: string }[]): Row[] {
  const byId = new Map<string, Row[]>();
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  const result: Row[] = [];
  for (const { id } of keys) {
    result.push(...(byId.get(id) ?? []));
    byId.delete(id);
  }
  if (byId.size) throw new Error("ASSESSMENT_SOURCE_ORDER_INCOMPLETE");
  return result;
}
