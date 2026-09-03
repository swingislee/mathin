interface LeadSelectionChange {
  current: ReadonlySet<string>;
  orderedIds: readonly string[];
  leadId: string;
  checked: boolean;
  anchorId: string | null;
  extendRange: boolean;
}

/** Apply a checkbox change, optionally extending it from the last plain click. */
export function updateLeadSelection({
  current,
  orderedIds,
  leadId,
  checked,
  anchorId,
  extendRange,
}: LeadSelectionChange): Set<string> {
  const next = new Set(current);
  const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1;
  const leadIndex = orderedIds.indexOf(leadId);
  const targets = extendRange && anchorIndex >= 0 && leadIndex >= 0
    ? orderedIds.slice(Math.min(anchorIndex, leadIndex), Math.max(anchorIndex, leadIndex) + 1)
    : [leadId];

  for (const id of targets) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}
