"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { loadRegistrationAnswers } from "../parent-registration-actions";
import type { FormAnswerSnapshot } from "../../../../contracts/participant-api/form-questions";
import { QuestionAnswersView } from "./QuestionsEditor";
export function ApplicationAnswers({ id, en }: { id: string; en: boolean }) {
  const [data, setData] = useState<FormAnswerSnapshot | null>(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  async function show() {
    if (busy) return;
    if (data) { setOpen(v => !v); return; }
    setBusy(true); setError(false);
    try { const result = await loadRegistrationAnswers(id); if (result.ok) { setData(result.data); setOpen(true); } else setError(true); }
    catch { setError(true); } finally { setBusy(false); }
  }
  return <div><Button size="sm" variant="ghost" disabled={busy} onClick={() => void show()}>{open ? en ? "Hide answers" : "收起报名回答" : en ? "View answers" : "查看报名回答"}</Button>{error && <p className="text-xs text-rose">{en ? "Could not load answers. Please retry." : "回答读取未完成，请重试。"}</p>}{open && data && <QuestionAnswersView fields={data.fields} answers={data.answers} en={en} />}</div>;
}
