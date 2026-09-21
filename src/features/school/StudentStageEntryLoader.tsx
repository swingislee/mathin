"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { StudentStageEntry } from "./StudentStageEntry";
import type { getStudentStageSubjectAction } from "./student-stage-actions";
import { readDashboardDetail } from "./dashboard-page/readDashboardDetail";
import { FollowupDetailLoading } from "./dashboard-page/FollowupInlineDetails";
import { studentStageMessages } from "./student-stage-messages";
import type { StudentStageRow } from "./student-stage-contract";

/** 完整事实到达后才初始化草稿；已访问的表单继续由工作区保留。 */
export function StudentStageEntryLoader(props: ComponentProps<typeof StudentStageEntry>) {
  const { row, locale } = props;
  const needsDetail = "detailLoaded" in row && row.detailLoaded === false;
  const [loaded, setLoaded] = useState<{ key: string; row: StudentStageRow } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const detail = needsDetail ? loaded?.key === row.key ? loaded.row : null : row;
  useEffect(() => {
    if (!needsDetail) return;
    let active = true;
    const controller = new AbortController();
    void readDashboardDetail<Awaited<ReturnType<typeof getStudentStageSubjectAction>>>(
      `/${locale}/dashboard/students/entry-detail`, { studentId: row.studentId, leadId: row.leadId }, controller.signal,
    ).then(result => {
      if (!active) return;
      if (result.ok) { setLoaded({ key: row.key, row: result.data }); setFailed(null); }
      else setFailed(row.key);
    }).catch(() => { if (active) setFailed(row.key); });
    return () => { active = false; controller.abort(); };
  }, [needsDetail, row.key, row.studentId, row.leadId, revision, locale]);
  if (detail) return <StudentStageEntry {...props} row={detail} />;
  const m = studentStageMessages(locale);
  return failed === row.key ? <div role="alert" className="space-y-2 text-sm text-muted">
    <p>{m.loadFailed}</p>
    <Button variant="secondary" size="sm" onClick={() => { setFailed(null); setRevision(value => value + 1); }}>{m.retry}</Button>
  </div> : <FollowupDetailLoading>{m.loading}</FollowupDetailLoading>;
}
