"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { addStudentFollowUps } from "./actions/followups";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import type { QuickFollowUpSaved } from "./QuickFollowUpEntry";

export interface StudentFollowUpBatchEntry {
  content: string;
  onChange: (value: string) => void;
  pending: boolean;
  count: number;
  save: () => Promise<boolean>;
}

export function useStudentFollowUpBatch(onSaved: (rows: Record<string, QuickFollowUpSaved>) => void) {
  const t = useTranslations("school.quickFollowUp");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [feedback, setFeedback] = useState("");
  const count = Object.values(drafts).filter(content => content.trim()).length;
  useEffect(() => {
    if (!count) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);
  const save = async () => {
    const rows = Object.entries(drafts).filter(([, content]) => content.trim()).map(([studentId, content]) => ({ studentId, content: content.trim() }));
    if (!rows.length || submitting.current) return false;
    submitting.current = true; setPending(true); setFeedback("");
    try {
      const result = await addStudentFollowUps(rows);
      if (!result.ok) { setFeedback(t("saveFailed")); return false; }
      const createdAt = new Date().toISOString();
      onSaved(Object.fromEntries(rows.map(row => [row.studentId, { content: row.content, createdAt }])));
      setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id, content]) => !rows.some(row => row.studentId === id && row.content === content.trim()))));
      setFeedback(t("batchSaved", { count: rows.length }));
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      return true;
    } catch { setFeedback(t("saveFailed")); return false; }
    finally { submitting.current = false; setPending(false); }
  };
  return { feedback, entry: (studentId: string): StudentFollowUpBatchEntry => ({
    content: drafts[studentId] ?? "", count, pending, save,
    onChange: content => { setDrafts(current => ({ ...current, [studentId]: content })); setFeedback(""); },
  }) };
}
