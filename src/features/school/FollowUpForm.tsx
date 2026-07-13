"use client";

import { LoaderCircle, MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { addStudentFollowUp, type FollowUpKind } from "./actions";
import { inputClass } from "./controls";

const KINDS: FollowUpKind[] = ["note", "call", "class", "visit"];
// 与 students.ts 的 FOLLOW_UP_STATUSES 同步（该模块引 server supabase，客户端不可 import）
const FOLLOW_UP_STATUSES = ["pending", "following", "invited", "trialed", "signed", "lost"] as const;
type FollowUpStatus=(typeof FOLLOW_UP_STATUSES)[number];
const FOLLOW_UP_TRANSITIONS:Record<FollowUpStatus,readonly FollowUpStatus[]>={pending:["following","lost"],following:["invited","lost"],invited:["following","trialed","lost"],trialed:["following","signed","lost"],signed:[],lost:["following"]};

/** 360° 档案页跟进快捷添加表单（10-§8：交互要轻，提交后刷新时间线）。 */
export function FollowUpForm({ studentId, currentStatus, onSuccess }: { studentId: string; currentStatus: FollowUpStatus; onSuccess?: () => void }) {
  const t = useTranslations("school.students");
  const router = useRouter();
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<FollowUpKind>("note");
  const [nextAt, setNextAt] = useState("");
  const [statusAfter, setStatusAfter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved,setSaved]=useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!content.trim()) return;
    startTransition(async () => {
      try {
        await addStudentFollowUp(studentId, {
          content,
          kind,
          nextFollowUpAt: nextAt || null,
          statusAfter: statusAfter || null,
        });
        setContent("");
        setNextAt("");
        setStatusAfter("");
        setError(null);
        setSaved(true);
        router.refresh();
        onSuccess?.();
      } catch {
        setSaved(false);
        setError(t("followUpFailed"));
      }
    });
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-line/40 p-4">
      <Textarea
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          setError(null); setSaved(false);
        }}
        rows={2}
        maxLength={2000}
        placeholder={t("followUpPlaceholder")}
        aria-label={t("followUpPlaceholder")}
        className={`w-full resize-y ${inputClass}`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t("followUpKind")}>
          {KINDS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                kind === value ? "border-crater bg-crater/10 text-ink" : "border-line text-muted hover:text-ink"
              }`}
            >
              {t(`followUpKind_${value}`)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t("nextFollowUp")}
          <Input type="datetime-local" value={nextAt} onChange={(event) => setNextAt(event.target.value)} className="h-9 w-auto" />
        </label>
        <select
          value={statusAfter}
          onChange={(event) => setStatusAfter(event.target.value)}
          aria-label={t("followUpStatusAfter")}
          className={inputClass}
        >
          <option value="">{t("followUpStatusKeep")}</option>
          {FOLLOW_UP_STATUSES.filter((status)=>FOLLOW_UP_TRANSITIONS[currentStatus].includes(status)).map((status) => (
            <option key={status} value={status}>
              {t(status)}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" className="ml-auto gap-1.5" disabled={pending || !content.trim()} onClick={submit}>
          {pending ? (
            <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <MessageSquarePlus size={15} />
          )}
          {t("addFollowUp")}
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose">{error}</p>}
      {saved && <p role="status" className="mt-2 text-xs text-leaf-deep">{t("followUpSaved")}</p>}
    </div>
  );
}
