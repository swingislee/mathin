"use client";

import { Bell } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { notificationValueKey, renderNotificationDetail, resolveNotificationDetail } from "./notification-copy";
import { markChangeFeedItemRead, markChangeFeedRead, type ChangeEvent } from "./notifications";
import { DesktopNotificationControls } from "./DesktopNotificationControls";

export function ChangeBell({
  initialEvents,
  userId,
  showWorkLink,
  desktopNotificationsEligible,
}: {
  initialEvents: ChangeEvent[];
  userId: string;
  showWorkLink: boolean;
  desktopNotificationsEligible: boolean;
}) {
  const t = useTranslations("changes");
  const locale = useLocale();
  const router = useRouter();
  const [dismissedEventIds, setDismissedEventIds] = useState<Set<string>>(() => new Set());
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const navigatingRef = useRef(false);
  const events = initialEvents.filter((event) => !dismissedEventIds.has(event.id));
  const unread = events.length;
  const latestVisibleEvent = events[0];

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let refreshTimer: number | undefined;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        () => {
          if (navigatingRef.current) return;
          if (refreshTimer) window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => router.refresh(), 80);
        },
      );

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      void supabase.realtime.setAuth(session?.access_token ?? null);
    });
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(session?.access_token ?? null);
      if (cancelled) return;
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      authListener.subscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  const openEvent = (event: ChangeEvent) => {
    navigatingRef.current = Boolean(event.link);
    setDismissedEventIds((current) => new Set(current).add(event.id));
    setPopoverOpen(false);
    if (event.link) {
      router.push(event.link);
      const hash = event.link.split("#")[1];
      if (hash) {
        window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 600);
      }
    }
    startTransition(async () => {
      try {
        await markChangeFeedItemRead(event.id);
      } catch {
        setDismissedEventIds((current) => {
          const next = new Set(current);
          next.delete(event.id);
          return next;
        });
        toast.error(t("markReadFailed"));
      }
    });
  };

  const markAllRead = () => {
    if (!latestVisibleEvent || unread === 0) return;
    startTransition(async () => {
      try {
        await markChangeFeedRead(latestVisibleEvent.id);
        setDismissedEventIds((current) => new Set([...current, ...events.map((event) => event.id)]));
        toast.success(t("markedAllRead"));
      } catch {
        toast.error(t("markReadFailed"));
      }
    });
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("label", { count: unread })}
          className="edge-control relative"
        >
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-rose px-1 text-[10px] leading-5 text-white">
              {Math.min(unread, 99)}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(94vw,420px)] p-0">
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <span className="font-medium">{t("title")}</span>
          {desktopNotificationsEligible ? <DesktopNotificationControls variant="toggle" /> : null}
        </div>
        <div data-notification-feed>
            {events.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">{t("empty")}</p>
            ) : (
              <ol className="max-h-80 divide-y divide-line overflow-y-auto">
                {events.map((event) => (
                  <li key={event.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending}
                      className="h-auto w-full justify-start rounded-none px-4 py-3 text-left"
                      onClick={() => openEvent(event)}
                    >
                      <Event event={event} />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {unread > 0 && (
              <div className="flex justify-end border-t border-line p-2">
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={markAllRead}>
                  {t("markAllRead")}
                </Button>
              </div>
            )}
        </div>
        {showWorkLink && (
          <div className="border-t border-line px-4 py-3 text-xs text-muted">
            <Link href="/dashboard?view=work" className="underline underline-offset-4" onClick={() => setPopoverOpen(false)}>
              {t("workMoved")}
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  function Event({ event }: { event: ChangeEvent }) {
    const key = event.type.replaceAll(".", "_");
    const resultKind = typeof event.payload.resultKind === "string" ? event.payload.resultKind : null;
    const specificKey = resultKind ? `${key}_${resultKind}` : null;
    const labelKey = specificKey && t.has(`types.${specificKey}`) ? specificKey : t.has(`types.${key}`) ? key : null;
    const detailDescriptor = resolveNotificationDetail(event.type, event.payload);
    const detail = detailDescriptor ? renderNotificationDetail(
      detailDescriptor,
      (detailKey, values) => t(`details.${detailKey}`, values),
      (group, value) => {
        const valueKey = notificationValueKey(group, value);
        return t.has(`values.${valueKey}`) ? t(`values.${valueKey}`) : value;
      },
    ) : null;
    return (
      <span className="block min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-rose" aria-hidden />
          <span className="truncate text-sm">{labelKey ? t(`types.${labelKey}`) : t("unknownType", { type: event.type })}</span>
        </span>
        {detail ? <span className="mt-1 block truncate pl-3.5 text-xs text-ink">{detail}</span> : null}
        <time className="mt-1 block pl-3.5 text-xs text-muted">
          {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}
        </time>
      </span>
    );
  }
}
