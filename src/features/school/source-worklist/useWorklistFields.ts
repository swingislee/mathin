'use client';

import { useEffect, useRef, useState } from 'react';
import type { FollowupServerFields } from '../followup-table-page';
import { useFollowupServerFields } from '../useFollowupServerFields';
import { readDashboardDetail } from '../dashboard-page/readDashboardDetail';
import type { getWorklistFacetsAction } from './facets-action';
import type { WorkQuery } from './contract';

export function useWorklistFields(data: FollowupServerFields | undefined, query: WorkQuery | undefined, locale: string) {
  const key = JSON.stringify(query && { stage: query.stage, scope: query.scope, q: query.q, batch: query.batch, students: query.students });
  const [loaded, setLoaded] = useState<{ key: string | undefined; facets?: FollowupServerFields['facets']; status: 'loading' | 'error' | 'ready' } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [key]);
  const current = loaded?.key === key ? loaded : null;
  const server = useFollowupServerFields(data && current?.facets ? { ...data, facets: current.facets } : data);
  const onLoadFacets = async () => {
    if (!data || !query || current?.status === 'loading' || current?.status === 'ready') return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoaded({ key, status: 'loading' });
    try {
      const language = locale.startsWith('en') ? 'en' : 'zh';
      const result = await readDashboardDetail<Awaited<ReturnType<typeof getWorklistFacetsAction>>>(
        `/${language}/dashboard/communication/source-filter-options`,
        { locale: language, query: Object.fromEntries(Object.entries(query).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)])) }, request.signal);
      if (request.signal.aborted) return;
      if (!result.ok) throw new Error(result.code);
      setLoaded({ key, status: 'ready', facets: result.data });
    } catch { if (!request.signal.aborted) setLoaded({ key, status: 'error' }); }
  };
  return { server, onLoadFacets, facetsStatus: current?.status === 'ready' ? undefined : current?.status ?? 'loading' as const };
}
