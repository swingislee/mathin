"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TeachingSessionRecords } from "./TeachingSessionRecords";
import { readTeachingInlineRecords, type TeachingRecordCache } from "./teaching-records-client";
import type { TeachingRecords } from "./teaching-records-contract";

export function TeachingInlineRecords({ sessionId, locale, timeZone, cache, replayId, replayFrom, replayTo }: {
  sessionId: string; locale: string; timeZone: string; cache: TeachingRecordCache; replayId?: "2026-09-07"; replayFrom?: string; replayTo?: string;
}) {
  const t = useTranslations("school.teachingWorkbench");
  const [contactPage, setContactPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20>(20);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: TeachingRecords } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const key = `${replayId ?? "live"}:${replayFrom ?? ""}:${replayTo ?? ""}:${locale}:${sessionId}:${contactPage}:${pageSize}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    void readTeachingInlineRecords(cache, locale, { sessionId, contactPage, pageSize, ...(replayId ? { replayId, replayFrom, replayTo } : {}) }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult({ key, data }); })
      .catch(() => { if (!controller.signal.aborted) setFailed(key); });
    return () => controller.abort();
  }, [cache, locale, sessionId, contactPage, pageSize, revision, key, replayId, replayFrom, replayTo]);
  if (failed === key) return <div role="alert" className="space-y-2 text-sm text-muted">
    <p>{t("records.loadFailed")}</p>
    <Button variant="secondary" size="sm" onClick={() => setRevision(value => value + 1)}>{t("records.retry")}</Button>
  </div>;
  if (result?.key !== key) return <p role="status" className="py-3 text-sm text-muted">{t("records.loading")}</p>;
  return <TeachingSessionRecords data={result.data} locale={locale} timeZone={timeZone} pageSize={pageSize} returnTo="" currentHref="" replay={Boolean(replayId)}
    inline={{ onPageChange: setContactPage, onPageSizeChange: size => { setPageSize(size); setContactPage(1); } }} />;
}
