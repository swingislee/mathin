'use client';

import type { ReactNode } from 'react';
import type { StatusEvidence } from './contract';
import type { useRecordStatusEvidence } from './useRecordStatusEvidence';

export function RecordStatusEvidenceContent({ evidence, locale, children }: {
  evidence: ReturnType<typeof useRecordStatusEvidence>;
  locale: string;
  children: (facts: StatusEvidence[]) => ReactNode;
}) {
  const en = locale.startsWith('en');
  if (evidence.facts) return children(evidence.facts);
  if (evidence.error) return <div className="text-xs text-muted" role="alert">
    <p>{en ? 'Could not load the evidence. Please try again.' : '依据读取失败，请重试。'}</p>
    <button type="button" className="mt-2 underline underline-offset-2" onClick={evidence.load}>
      {en ? 'Retry' : '重新读取'}
    </button>
  </div>;
  return <p className="text-xs text-muted" role="status">{en ? 'Loading evidence…' : '正在读取依据…'}</p>;
}
