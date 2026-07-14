"use client";

import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { useRouter } from "@/i18n/navigation";
import { restoreSessionAction } from "./actions/classes";
import type { DeletedSessionRow } from "./classes";

/**
 * 班级详情尾部回收站（P4C-2 §7）：列已软删课次，可一键恢复。仅 class.manage 页面渲染。
 * 直接从 props 渲染（服务端每次 refresh 重取 listDeletedSessions），不缓存本地列表——
 * 否则新软删的课次不会出现（useState 只吃首次挂载值）。
 */
export function SessionRecycleBin({ sessions }: { sessions: DeletedSessionRow[] }) {
  const t = useTranslations("school.classes");
  const router = useRouter();
  const { run: restore, pending } = useAction(restoreSessionAction, {
    successMessage: t("sessionRestored"),
    errorMessage: { default: t("actionFailed") },
    onSuccess: () => router.refresh(),
  });

  if (sessions.length === 0) return null;

  return (
    <details className="rounded-xl border border-line bg-card p-5">
      <summary className="cursor-pointer text-sm font-medium text-muted">{t("recycleBin", { count: sessions.length })}</summary>
      <ul className="mt-4 divide-y divide-line">
        {sessions.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <span className="w-10 shrink-0 font-mono text-xs text-muted">{row.no ?? "-"}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{row.name || t("untitledSession")}</span>
            {row.scheduledAt && (
              <time className="shrink-0 font-mono text-xs text-muted">
                {new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(row.scheduledAt))}
              </time>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => restore(row.id)}
              className="shrink-0 text-xs text-crater underline underline-offset-2 disabled:opacity-40"
            >
              {t("restore")}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
