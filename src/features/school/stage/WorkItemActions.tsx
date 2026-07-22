"use client";

import { Bell, BellOff, Check, CheckCheck, Clock, Eye, Pin, PinOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "@/components/action-form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  acknowledgeWorkItemAction,
  markWorkItemSeenAction,
  pinWorkItemAction,
  snoozeWorkItemAction,
  watchWorkItemAction,
} from "../actions/work-items";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { WorkItemRow } from "./types";

const ICON_BUTTON = "rounded-lg border border-line bg-card p-1.5 text-muted transition hover:border-crater/50 hover:text-ink";

interface SnoozePreset {
  label: string;
  hours: number;
}

function snoozePresets(bucket: WorkItemRow["urgencyBucket"], t: ReturnType<typeof useTranslations>): SnoozePreset[] {
  if (bucket === "overdue" || bucket === "today") {
    return [
      { label: t("snooze_6h"), hours: 6 },
      { label: t("snooze_1d"), hours: 24 },
    ];
  }
  return [
    { label: t("snooze_1d"), hours: 24 },
    { label: t("snooze_3d"), hours: 72 },
    { label: t("snooze_1w"), hours: 168 },
    { label: t("snooze_2w"), hours: 336 },
  ];
}

/**
 * 今日工作单条事项的动作行（doc19 §6.6）：置顶/关注双向切换，已读/确认单向
 * 一次性（RPC 只支持置为 now()，没有撤销），稍后处理按 urgencyBucket 收紧
 * 预设档位——now 桶直接不渲染这个控件，RPC 本身也会拒绝。
 */
export function WorkItemActions({ item }: { item: WorkItemRow }) {
  const t = useTranslations("school.work");
  const router = useRouter();
  const onSuccess = () => router.refresh();

  const seen = useAction(markWorkItemSeenAction, { successMessage: t("action_seen"), errorMessage: { default: t("actionFailed") }, onSuccess });
  const pin = useAction(pinWorkItemAction, { successMessage: t("action_updated"), errorMessage: { default: t("actionFailed") }, onSuccess });
  const acknowledge = useAction(acknowledgeWorkItemAction, { successMessage: t("action_acknowledged"), errorMessage: { default: t("actionFailed") }, onSuccess });
  const watch = useAction(watchWorkItemAction, { successMessage: t("action_updated"), errorMessage: { default: t("actionFailed") }, onSuccess });
  const snooze = useAction(snoozeWorkItemAction, { successMessage: t("action_snooze"), errorMessage: { default: t("actionFailed") }, onSuccess });

  const pending = seen.pending || pin.pending || acknowledge.pending || watch.pending || snooze.pending;
  const isPinned = Boolean(item.pinnedAt);
  const isAcknowledged = Boolean(item.acknowledgedAt);
  const isSeen = Boolean(item.lastSeenAt);
  const presets = snoozePresets(item.urgencyBucket, t);

  return (
    <div className="flex items-center gap-1.5">
      {!isSeen ? (
        <button
          type="button"
          onClick={() => seen.run(item.workKey)}
          disabled={pending}
          aria-label={t("action_markSeen")}
          title={t("action_markSeen")}
          className={ICON_BUTTON}
        >
          <Eye size={14} />
        </button>
      ) : (
        <span aria-label={t("action_seen")} title={t("action_seen")} className="p-1.5 text-muted">
          <Eye size={14} className="opacity-40" />
        </span>
      )}

      {!isAcknowledged ? (
        <button
          type="button"
          onClick={() => acknowledge.run(item.workKey)}
          disabled={pending}
          aria-label={t("action_acknowledge")}
          title={t("action_acknowledge")}
          className={ICON_BUTTON}
        >
          <Check size={14} />
        </button>
      ) : (
        <span aria-label={t("action_acknowledged")} title={t("action_acknowledged")} className="p-1.5 text-leaf-deep">
          <CheckCheck size={14} />
        </span>
      )}

      <button
        type="button"
        onClick={() => pin.run(item.workKey, !isPinned)}
        disabled={pending}
        aria-label={isPinned ? t("action_unpin") : t("action_pin")}
        title={isPinned ? t("action_unpin") : t("action_pin")}
        className={cn(ICON_BUTTON, isPinned && "border-crater/50 text-crater")}
      >
        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
      </button>

      <button
        type="button"
        onClick={() => watch.run(item.workKey, !item.watching)}
        disabled={pending}
        aria-label={item.watching ? t("action_unwatch") : t("action_watch")}
        title={item.watching ? t("action_unwatch") : t("action_watch")}
        className={cn(ICON_BUTTON, item.watching && "border-crater/50 text-crater")}
      >
        {item.watching ? <BellOff size={14} /> : <Bell size={14} />}
      </button>

      {presets.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={pending}
              aria-label={t("action_snooze")}
              title={t("action_snooze")}
              className={ICON_BUTTON}
            >
              <Clock size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="end">
            <div className="flex flex-col gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.hours}
                  type="button"
                  disabled={pending}
                  onClick={() => snooze.run(item.workKey, new Date(Date.now() + preset.hours * 3600_000).toISOString())}
                  className="rounded-lg px-2 py-1.5 text-left text-sm text-ink transition hover:bg-line/30"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
