"use client";

import { LoaderCircle, MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { addStudentFollowUp } from "./actions/followups";
import { type FollowUpKind } from "./actions/types";
import { fromSelectValue, inputClass, toSelectValue } from "./controls";

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

  const { run: submitRun, pending } = useAction(
    (input: { content: string; kind: FollowUpKind; nextFollowUpAt: string | null; statusAfter: string | null }) => addStudentFollowUp(studentId, input),
    {
      successMessage: t("followUpSaved"),
      errorMessage: { default: t("followUpFailed") },
      onSuccess: () => {
        setContent("");
        setNextAt("");
        setStatusAfter("");
        router.refresh();
        onSuccess?.();
      },
    },
  );
  const submit = () => {
    if (!content.trim()) return;
    submitRun({ content, kind, nextFollowUpAt: nextAt || null, statusAfter: statusAfter || null });
  };

  return (
    <div className="mt-4 rounded-xl border border-line bg-line/40 p-4">
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
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
        <Label className="flex items-center gap-1.5 text-xs font-normal text-muted">
          {t("nextFollowUp")}
          <Input type="datetime-local" value={nextAt} onChange={(event) => setNextAt(event.target.value)} className="h-9 w-auto" />
        </Label>
        <Select value={toSelectValue(statusAfter)} onValueChange={(value) => setStatusAfter(fromSelectValue(value))}>
          <SelectTrigger aria-label={t("followUpStatusAfter")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("followUpStatusKeep")}</SelectItem>
            {FOLLOW_UP_STATUSES.filter((status)=>FOLLOW_UP_TRANSITIONS[currentStatus].includes(status)).map((status) => (
              <SelectItem key={status} value={status}>
                {t(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="sm" className="ml-auto gap-1.5" disabled={pending || !content.trim()} onClick={submit}>
          {pending ? (
            <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <MessageSquarePlus size={15} />
          )}
          {t("addFollowUp")}
        </Button>
      </div>
    </div>
  );
}
