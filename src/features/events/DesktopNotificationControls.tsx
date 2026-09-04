"use client";

import { BellRing, MonitorCog, Send, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getMyWebPushSnapshotAction,
  reconcileMyWebPushSubscriptionAction,
  registerMyWebPushSubscriptionAction,
  revokeMyWebPushSubscriptionAction,
  sendMyWebPushTestAction,
} from "./web-push-actions";
import {
  detectBrowserFamily,
  detectPlatformFamily,
  serializePushSubscription,
  urlBase64ToUint8Array,
  WEB_PUSH_SERVICE_WORKER_PATH,
  WEB_PUSH_SERVICE_WORKER_SCOPE,
  type WebPushCapability,
  type WebPushDevice,
  type WebPushDeviceMode,
} from "./web-push-contract";

type BrowserCapability = "loading" | "unsupported" | "insecure" | "ready";

function browserCapability(): BrowserCapability {
  if (typeof window === "undefined") return "loading";
  if (!window.isSecureContext) return "insecure";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return "ready";
}

async function currentBrowserSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(WEB_PUSH_SERVICE_WORKER_SCOPE);
  return registration?.pushManager.getSubscription() ?? null;
}

export function DesktopNotificationControls({
  variant = "toggle",
}: {
  variant?: "toggle" | "full";
}) {
  const t = useTranslations("changes.desktopNotifications");
  const locale = useLocale() === "en" ? "en" : "zh";
  const [pending, startTransition] = useTransition();
  const [capability, setCapability] = useState<WebPushCapability | null>(null);
  const [devices, setDevices] = useState<WebPushDevice[]>([]);
  const [currentSubscriptionId, setCurrentSubscriptionId] = useState<string | null>(null);
  const [browser, setBrowser] = useState<BrowserCapability>("loading");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [deviceMode, setDeviceMode] = useState<WebPushDeviceMode>("shared");
  const [deviceLabel, setDeviceLabel] = useState(() => locale === "zh" ? "Mathin 桌面设备" : "Mathin desktop");
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (reconcile: boolean) => {
    const nextBrowser = browserCapability();
    setBrowser(nextBrowser);
    if (nextBrowser === "ready") setPermission(Notification.permission);

    const result = await getMyWebPushSnapshotAction();
    if (!result.ok) {
      setMessage(t("operationFailed", { code: result.code }));
      return;
    }
    setCapability(result.data.capability);
    setDevices(result.data.devices);
    if (nextBrowser !== "ready") {
      setCurrentSubscriptionId(null);
      return;
    }

    const subscription = await currentBrowserSubscription();
    if (!subscription || !reconcile) {
      if (!subscription) setCurrentSubscriptionId(null);
      return;
    }
    const reconciliation = await reconcileMyWebPushSubscriptionAction(subscription.endpoint);
    if (reconciliation.ok) {
      setCurrentSubscriptionId(reconciliation.data.subscriptionId);
    } else if (reconciliation.code !== "WEB_PUSH_ORIGIN_NOT_ALLOWED" && reconciliation.code !== "WEB_PUSH_SECRETS_UNAVAILABLE") {
      setMessage(t("operationFailed", { code: reconciliation.code }));
    }
  }, [t]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(true), 0);

    const subscriptionChanged = (event: MessageEvent) => {
      if (event.data?.type === "MATHIN_WEB_PUSH_SUBSCRIPTION_CHANGED") void refresh(true);
    };
    navigator.serviceWorker?.addEventListener("message", subscriptionChanged);
    return () => {
      window.clearTimeout(initialRefresh);
      navigator.serviceWorker?.removeEventListener("message", subscriptionChanged);
    };
  }, [refresh]);

  const currentDevice = useMemo(
    () => devices.find((device) => device.id === currentSubscriptionId) ?? null,
    [currentSubscriptionId, devices],
  );

  const unavailableReason = useMemo(() => {
    if (browser === "loading" || !capability) return t("loading");
    if (browser === "unsupported") return t("unsupported");
    if (browser === "insecure") return t("insecure");
    if (permission === "denied") return t("permissionDenied");
    if (!capability.roleEligible) return t("roleUnavailable");
    if (!capability.rolloutEligible || !capability.featureEnabled) return t("notInRollout");
    if (!capability.channelEnabled || !capability.vapidPublicKey) return t("channelDisabled");
    if (currentDevice) return t("activeUntil", {
      time: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
        .format(new Date(currentDevice.leaseExpiresAt)),
    });
    return t("ready");
  }, [browser, capability, currentDevice, locale, permission, t]);

  const canEnable = browser === "ready"
    && permission !== "denied"
    && Boolean(capability?.roleEligible)
    && Boolean(capability?.rolloutEligible)
    && Boolean(capability?.featureEnabled)
    && Boolean(capability?.channelEnabled)
    && Boolean(capability?.vapidPublicKey)
    && !currentDevice;

  const enable = () => startTransition(async () => {
    setMessage(null);
    if (!canEnable || !capability?.vapidPublicKey) return;
    let createdSubscription: PushSubscription | null = null;
    try {
      const nextPermission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        setMessage(nextPermission === "denied" ? t("permissionDenied") : t("permissionDefault"));
        return;
      }
      const registration = await navigator.serviceWorker.register(WEB_PUSH_SERVICE_WORKER_PATH, {
        scope: WEB_PUSH_SERVICE_WORKER_SCOPE,
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(capability.vapidPublicKey),
        });
        createdSubscription = subscription;
      }
      const userAgent = navigator.userAgent;
      const result = await registerMyWebPushSubscriptionAction({
        subscription: serializePushSubscription(subscription),
        deviceLabel,
        deviceMode,
        browserFamily: detectBrowserFamily(userAgent),
        platformFamily: detectPlatformFamily(userAgent),
        locale,
      });
      if (!result.ok) {
        if (createdSubscription) await createdSubscription.unsubscribe();
        setMessage(t("operationFailed", { code: result.code }));
        return;
      }
      setCurrentSubscriptionId(result.data.subscriptionId);
      setMessage(t("enabled"));
      await refresh(false);
    } catch {
      if (createdSubscription) await createdSubscription.unsubscribe().catch(() => false);
      setMessage(t("enableFailed"));
    }
  });

  const revoke = (device: WebPushDevice) => startTransition(async () => {
    setMessage(null);
    const result = await revokeMyWebPushSubscriptionAction(device.id);
    if (!result.ok) {
      setMessage(t("operationFailed", { code: result.code }));
      return;
    }
    if (device.id === currentSubscriptionId && browser === "ready") {
      const subscription = await currentBrowserSubscription();
      await subscription?.unsubscribe().catch(() => false);
      setCurrentSubscriptionId(null);
    }
    setMessage(t("disabled"));
    await refresh(false);
  });

  const sendTest = (subscriptionId: string) => startTransition(async () => {
    setMessage(null);
    const result = await sendMyWebPushTestAction(subscriptionId);
    setMessage(result.ok ? t("testAccepted") : t("operationFailed", { code: result.code }));
  });

  if (capability && !capability.roleEligible) return null;

  if (variant === "toggle") {
    const active = Boolean(currentDevice);

    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        role="switch"
        aria-checked={active}
        aria-label={t("title")}
        disabled={pending || (!active && !canEnable)}
        title={unavailableReason}
        className="h-8 shrink-0 gap-2 rounded-lg px-2 text-xs font-medium text-muted hover:text-ink"
        onClick={() => active && currentDevice ? revoke(currentDevice) : enable()}
      >
        <span>{t("title")}</span>
        <span
          aria-hidden
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full bg-muted/30 p-0.5 transition-colors",
            active && "bg-rose",
          )}
        >
          <span
            className={cn(
              "block size-4 rounded-full bg-card shadow-sm transition-transform",
              active && "translate-x-4",
            )}
          />
        </span>
        {message ? <span className="sr-only" role="status" aria-live="polite">{message}</span> : null}
      </Button>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-moon/45 text-ink" aria-hidden>
          <BellRing size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-ink">{t("title")}</h3>
          <p className="mt-1 text-xs text-muted">{unavailableReason}</p>
        </div>
      </div>

      {!currentDevice && capability?.roleEligible ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Label className="grid gap-1.5">
            <span>{t("deviceLabel")}</span>
            <Input value={deviceLabel} maxLength={80} onChange={(event) => setDeviceLabel(event.target.value)} />
          </Label>
          <Label className="grid gap-1.5">
            <span>{t("deviceMode")}</span>
            <Select value={deviceMode} onValueChange={(value) => setDeviceMode(value as WebPushDeviceMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">{t("shared")}</SelectItem>
                <SelectItem value="personal">{t("personal")}</SelectItem>
              </SelectContent>
            </Select>
          </Label>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {currentDevice ? (
          <>
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => sendTest(currentDevice.id)}>
              <Send size={14} />{t("sendTest")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => revoke(currentDevice)}>
              <X size={14} />{t("disable")}
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" disabled={!canEnable || pending || !deviceLabel.trim()} onClick={enable}>
            <BellRing size={14} />{pending ? t("enabling") : t("enable")}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted">{t("backgroundHint")}</p>
      {message ? <p role="status" aria-live="polite" className="mt-2 text-xs text-muted">{message}</p> : null}

      <div className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium"><MonitorCog size={16} />{t("devicesTitle")}</h3>
        {devices.length === 0 ? <p className="text-sm text-muted">{t("noDevices")}</p> : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-card/60">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{device.deviceLabel}{device.id === currentSubscriptionId ? ` · ${t("thisDevice")}` : ""}</p>
                  <p className="mt-1 text-xs text-muted">
                    {t(device.deviceMode)} · {device.browserFamily}/{device.platformFamily} · {t(`status_${device.status}`)}
                  </p>
                </div>
                {device.status === "active" ? (
                  <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => revoke(device)}>
                    {t("revokeDevice")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
