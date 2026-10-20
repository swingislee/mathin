'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudentStageRow } from '../student-stage-contract';
import type { StatusEvidence } from './contract';
import { getRecordStatusEvidenceAction } from './actions';

type EvidenceState = { row: StudentStageRow; facts?: StatusEvidence[]; error?: boolean };

/** 请求只由打开弹层触发，同一行的图标复用结果。新行快照不复用旧权限或旧依据。 */
export function useRecordStatusEvidence(row: StudentStageRow) {
  const [state, setState] = useState<EvidenceState>();
  const [open, setOpen] = useState(false);
  const pending = useRef<{ row: StudentStageRow; promise: Promise<void> } | null>(null);
  const snapshot = state?.row === row ? state : undefined;
  const facts = row.statusEvidence ?? snapshot?.facts;
  const deferred = Boolean(row.statusSummary && !row.statusEvidence);
  const load = useCallback(() => {
    if (!deferred || facts) return;
    if (pending.current?.row === row) return pending.current.promise;
    setState({ row });
    const request = getRecordStatusEvidenceAction({ studentId: row.studentId, leadId: row.leadId })
      .then(result => setState(current => current?.row === row
        ? result.ok ? { row, facts: result.data } : { row, error: true } : current))
      .catch(() => setState(current => current?.row === row ? { row, error: true } : current))
      .finally(() => {
        if (pending.current?.promise === request) pending.current = null;
      });
    pending.current = { row, promise: request };
    return request;
  }, [row, deferred, facts]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  return { facts: facts ?? (!deferred ? [] : undefined), error: snapshot?.error ?? false, load, onOpenChange: setOpen };
}
